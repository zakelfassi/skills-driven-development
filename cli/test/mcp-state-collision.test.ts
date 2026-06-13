/**
 * mcp-state-collision.test.ts
 *
 * Tests for two MCP managed-state + hub status edge cases:
 *
 * Fix 1 (mcp.ts): When a previously-managed server becomes intentionally omitted
 * by the adapter (disabled:true, remote on claude-desktop, etc.) AND the host entry
 * is already gone, the adapter plan has no remove change. Previously, `activeForHost`
 * (allowlist-only) kept the name in .skdd-sync.json; a later user-authored same-name
 * entry would get clobbered on the next sync.
 * Fix: use the plan's new `omitted[]` field to drop managed state for servers the
 * adapter decided NOT to write (intentionally omitted).
 *
 * Fix 2 (hub/state.ts): When a canonical server targets a host that already has an
 * UNMANAGED entry of the same name, the adapter returns no add/update + a warning.
 * Previously the hub showed this as `excluded` (looks intentional); it's really a
 * conflict the user must resolve.
 * Fix: surface present-but-unmanaged collision as `drift`, not `excluded`.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMcpSync } from "../src/commands/mcp.js";
import { buildMcpRows, type McpRowAdapter } from "../src/hub/state.js";
import type { HostReadResult, HostSyncPlan, ServerChange } from "../src/lib/mcp/adapters/types.js";
import { type CanonicalMcpConfig, saveMcpConfig } from "../src/lib/mcp/schema.js";
import { loadMcpManagedNames, saveMcpManagedNames } from "../src/lib/mcp/state.js";

// ── Setup ────────────────────────────────────────────────────────────────────

let skddTmp: string;
let homeTmp: string;
let prevSkddHome: string | undefined;
let prevHome: string | undefined;

beforeEach(() => {
  skddTmp = mkdtempSync(join(tmpdir(), "skdd-collision-skdd-"));
  homeTmp = mkdtempSync(join(tmpdir(), "skdd-collision-home-"));
  prevSkddHome = process.env.SKDD_HOME;
  prevHome = process.env.HOME;
  process.env.SKDD_HOME = skddTmp;
  process.env.HOME = homeTmp;
});

afterEach(() => {
  if (prevSkddHome === undefined) delete process.env.SKDD_HOME;
  else process.env.SKDD_HOME = prevSkddHome;
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  rmSync(skddTmp, { recursive: true, force: true });
  rmSync(homeTmp, { recursive: true, force: true });
});

function writeCanonical(servers: CanonicalMcpConfig["servers"]): void {
  mkdirSync(join(skddTmp, "skills"), { recursive: true });
  saveMcpConfig(skddTmp, { version: 1, servers });
}

function writeClaudeCodeHost(servers: Record<string, unknown>): void {
  const doc = { mcpServers: servers };
  writeFileSync(join(homeTmp, ".claude.json"), JSON.stringify(doc, null, 2));
}

function readClaudeCodeHost(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(homeTmp, ".claude.json"), "utf8")) as Record<string, unknown>;
}

// ── Fix 1: managed→disabled / omitted, host entry already gone ───────────────

describe("Fix 1 — managed state cleared for intentionally omitted servers", () => {
  it("server previously managed then disabled (host entry already gone): managed-state is cleared after sync", async () => {
    // 1. Seed managed state: claude-code has "myserver" managed
    mkdirSync(join(skddTmp, "skills"), { recursive: true });
    saveMcpManagedNames(skddTmp, "claude-code", ["myserver"]);

    // 2. Canonical has "myserver" with disabled:true (adapter intentionally omits it)
    writeCanonical({
      myserver: { command: "npx", args: ["mypkg"], disabled: true },
    });

    // 3. Host config exists but "myserver" is already absent (previously removed)
    writeClaudeCodeHost({}); // no myserver entry

    // 4. Sync runs: adapter finds managed "myserver" is disabled + absent → no remove needed
    const code = await runMcpSync();
    expect(code).toBe(0);

    // 5. Managed state must be cleared: "myserver" should NOT remain in managed
    const managed = loadMcpManagedNames(skddTmp, "claude-code");
    expect(managed).not.toContain("myserver");
  });

  it("server disabled with host entry still present: entry is removed and managed-state cleared", async () => {
    // 1. Seed managed state
    mkdirSync(join(skddTmp, "skills"), { recursive: true });
    saveMcpManagedNames(skddTmp, "claude-code", ["myserver"]);

    // 2. Canonical: disabled
    writeCanonical({
      myserver: { command: "npx", args: ["mypkg"], disabled: true },
    });

    // 3. Host config still has the entry
    writeClaudeCodeHost({ myserver: { command: "npx", args: ["mypkg"] } });

    // 4. Sync
    const code = await runMcpSync();
    expect(code).toBe(0);

    // 5. Host entry should be removed
    const host = readClaudeCodeHost();
    const servers = host.mcpServers as Record<string, unknown>;
    expect(servers["myserver"]).toBeUndefined();

    // 6. Managed state cleared
    const managed = loadMcpManagedNames(skddTmp, "claude-code");
    expect(managed).not.toContain("myserver");
  });

  it("managed-state cleared so a user-authored same-name entry survives on the next sync", async () => {
    // Setup: managed→disabled with host entry gone → managed state cleared
    mkdirSync(join(skddTmp, "skills"), { recursive: true });
    saveMcpManagedNames(skddTmp, "claude-code", ["myserver"]);
    writeCanonical({
      myserver: { command: "npx", args: ["mypkg"], disabled: true },
    });
    writeClaudeCodeHost({});

    await runMcpSync();

    // Verify managed cleared
    expect(loadMcpManagedNames(skddTmp, "claude-code")).not.toContain("myserver");

    // Now user adds their own entry for "myserver" in the host config
    writeClaudeCodeHost({ myserver: { command: "user-cmd" } });

    // On the next sync (still disabled in canonical), the user entry must NOT be removed
    const code2 = await runMcpSync();
    expect(code2).toBe(0);

    const host = readClaudeCodeHost();
    const servers = host.mcpServers as Record<string, unknown>;
    // User-authored entry must survive
    expect(servers["myserver"]).toBeDefined();
    expect((servers["myserver"] as Record<string, unknown>).command).toBe("user-cmd");
  });

  it("active managed server (no disabled flag, host entry present and correct) stays managed", async () => {
    // Regression: make sure we don't accidentally drop active managed servers
    mkdirSync(join(skddTmp, "skills"), { recursive: true });
    saveMcpManagedNames(skddTmp, "claude-code", ["active-srv"]);
    writeCanonical({
      "active-srv": { command: "npx", args: ["active-pkg"] },
    });
    writeClaudeCodeHost({ "active-srv": { command: "npx", args: ["active-pkg"] } });

    const code = await runMcpSync();
    expect(code).toBe(0);

    // Must remain managed
    const managed = loadMcpManagedNames(skddTmp, "claude-code");
    expect(managed).toContain("active-srv");
  });
});

// ── Fix 2: hub shows drift (not excluded) for unmanaged collision ─────────────

describe("Fix 2 — hub shows drift for unmanaged name collision", () => {
  /** Helper to build a McpRowAdapter that simulates a collision:
   * - The server IS present in the host file (serverNames contains name)
   * - The server is NOT managed
   * - The adapter emits a warning when plan() is called (unmanaged collision)
   * - plan() returns no add/update for the colliding server
   */
  function makeCollisionAdapter(name: string): McpRowAdapter {
    return {
      available: () => true,
      read: (): HostReadResult => ({
        ok: true,
        serverNames: [name],
        rawDoc: {},
      }),
      plan: (_canonical: CanonicalMcpConfig, _managed: string[]): HostSyncPlan => ({
        ok: true,
        changes: [], // adapter decided not to write (unmanaged collision)
        filePath: "/fake",
        finalDoc: {},
        warnings: [
          `Skipping "${name}": an unmanaged entry with this name already exists; remove it manually to let skdd manage it.`,
        ],
      }),
    };
  }

  function makeCleanAdapter(serverNames: string[] = []): McpRowAdapter {
    return {
      available: () => true,
      read: (): HostReadResult => ({ ok: true, serverNames, rawDoc: {} }),
      plan: (): HostSyncPlan => ({
        ok: true,
        changes: [],
        filePath: "/fake",
        finalDoc: {},
        warnings: [],
      }),
    };
  }

  it("server present-but-unmanaged collision shows as drift, not excluded", () => {
    const globalRoot = mkdtempSync(join(tmpdir(), "skdd-hub-fix2-"));
    try {
      const config: CanonicalMcpConfig = {
        version: 1,
        servers: {
          "my-mcp": { command: "npx", args: ["my-pkg"] },
        },
      };
      writeFileSync(join(globalRoot, "mcp.json"), JSON.stringify(config, null, 2));

      const adapter = makeCollisionAdapter("my-mcp");

      const rows = buildMcpRows(globalRoot, {
        adapters: { "claude-code": adapter },
        loadManaged: () => [], // not managed
      });

      expect(rows).toHaveLength(1);
      // Collision must show as drift, not excluded
      expect(rows[0].hosts["claude-code"]).toBe("drift");
    } finally {
      rmSync(globalRoot, { recursive: true, force: true });
    }
  });

  it("server with allowlist exclusion (hosts field) still shows as excluded, not drift", () => {
    const globalRoot = mkdtempSync(join(tmpdir(), "skdd-hub-fix2b-"));
    try {
      const config: CanonicalMcpConfig = {
        version: 1,
        servers: {
          "cursor-only": { command: "npx", args: ["my-pkg"], hosts: ["cursor"] },
        },
      };
      writeFileSync(join(globalRoot, "mcp.json"), JSON.stringify(config, null, 2));

      // claude-code adapter: server not present, plan no-op (allowlist excluded)
      const adapter = makeCleanAdapter([]);

      const rows = buildMcpRows(globalRoot, {
        adapters: { "claude-code": adapter },
        loadManaged: () => [],
      });

      expect(rows).toHaveLength(1);
      // Should remain excluded (canonical allowlist intent)
      expect(rows[0].hosts["claude-code"]).toBe("excluded");
    } finally {
      rmSync(globalRoot, { recursive: true, force: true });
    }
  });

  it("disabled server with no host entry shows as excluded, not drift", () => {
    const globalRoot = mkdtempSync(join(tmpdir(), "skdd-hub-fix2c-"));
    try {
      const config: CanonicalMcpConfig = {
        version: 1,
        servers: {
          "disabled-srv": { command: "npx", args: ["pkg"], disabled: true },
        },
      };
      writeFileSync(join(globalRoot, "mcp.json"), JSON.stringify(config, null, 2));

      // Adapter: server not in host, plan no-op (disabled)
      const adapter = makeCleanAdapter([]);

      const rows = buildMcpRows(globalRoot, {
        adapters: { "claude-code": adapter },
        loadManaged: () => [],
      });

      expect(rows).toHaveLength(1);
      // Disabled + absent = intentionally excluded
      expect(rows[0].hosts["claude-code"]).toBe("excluded");
    } finally {
      rmSync(globalRoot, { recursive: true, force: true });
    }
  });

  it("collision on one host does not affect status on other hosts", () => {
    const globalRoot = mkdtempSync(join(tmpdir(), "skdd-hub-fix2d-"));
    try {
      const config: CanonicalMcpConfig = {
        version: 1,
        servers: {
          "my-mcp": { command: "npx", args: ["my-pkg"] },
        },
      };
      writeFileSync(join(globalRoot, "mcp.json"), JSON.stringify(config, null, 2));

      // claude-code: collision (drift)
      const collisionAdapter = makeCollisionAdapter("my-mcp");
      // cursor: managed + synced (no collision)
      const syncedAdapter: McpRowAdapter = {
        available: () => true,
        read: (): HostReadResult => ({ ok: true, serverNames: ["my-mcp"], rawDoc: {} }),
        plan: (): HostSyncPlan => ({
          ok: true,
          changes: [],
          filePath: "/fake",
          finalDoc: {},
          warnings: [],
        }),
      };

      const rows = buildMcpRows(globalRoot, {
        adapters: { "claude-code": collisionAdapter, cursor: syncedAdapter },
        loadManaged: (hostId) => (hostId === "cursor" ? ["my-mcp"] : []),
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].hosts["claude-code"]).toBe("drift"); // collision
      expect(rows[0].hosts["cursor"]).toBe("synced"); // managed + present + no-op
    } finally {
      rmSync(globalRoot, { recursive: true, force: true });
    }
  });
});
