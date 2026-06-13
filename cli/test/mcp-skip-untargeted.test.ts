/**
 * mcp-skip-untargeted.test.ts
 *
 * TDD for two related fixes:
 *
 * Fix 1 (mcp.ts): Before calling adapter.plan(), skip a host if it has NO
 * intended servers (none allowlisted to it) AND NO managed names to clean up.
 * A malformed config on an untargeted host should not block sync (exit 1).
 *
 * Fix 2 (hub/state.ts): When a host is excluded by allowlist BUT still has a
 * managed entry AND the host config is malformed, surface it as "drift" rather
 * than "excluded". This matches what sync will actually do (block on that config
 * to remove the stale entry).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMcpSync } from "../src/commands/mcp.js";
import { buildMcpRows, type McpRowAdapter } from "../src/hub/state.js";
import type { HostReadResult, HostSyncPlan } from "../src/lib/mcp/adapters/types.js";
import type { CanonicalMcpConfig } from "../src/lib/mcp/schema.js";
import { saveMcpConfig } from "../src/lib/mcp/schema.js";
import { saveMcpManagedNames } from "../src/lib/mcp/state.js";

// ── Environment setup ─────────────────────────────────────────────────────────

let skddTmp: string;
let homeTmp: string;
let prevSkddHome: string | undefined;
let prevHome: string | undefined;

beforeEach(() => {
  skddTmp = mkdtempSync(join(tmpdir(), "skdd-skip-skdd-"));
  homeTmp = mkdtempSync(join(tmpdir(), "skdd-skip-home-"));
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function writeCanonical(servers: CanonicalMcpConfig["servers"]): void {
  mkdirSync(join(skddTmp, "skills"), { recursive: true });
  saveMcpConfig(skddTmp, { version: 1, servers });
}

/** Place a valid claude-code config so that host is available and well-formed. */
function placeClaudeCode(): void {
  writeFileSync(join(homeTmp, ".claude.json"), JSON.stringify({ mcpServers: {} }, null, 2));
}

/** Place a malformed (invalid JSON) cursor config. */
function placeMalformedCursor(): void {
  mkdirSync(join(homeTmp, ".cursor"), { recursive: true });
  writeFileSync(join(homeTmp, ".cursor/mcp.json"), "THIS IS NOT JSON <<<");
}

/** Place a well-formed but empty cursor config. */
function placeWellFormedCursor(): void {
  mkdirSync(join(homeTmp, ".cursor"), { recursive: true });
  writeFileSync(join(homeTmp, ".cursor/mcp.json"), JSON.stringify({ mcpServers: {} }, null, 2));
}

// ── Hub helpers ───────────────────────────────────────────────────────────────

let hubTmp: string;
beforeEach(() => {
  hubTmp = mkdtempSync(join(tmpdir(), "skdd-skip-hub-"));
});
afterEach(() => {
  rmSync(hubTmp, { recursive: true, force: true });
});

function writeHubConfig(dir: string, config: CanonicalMcpConfig): void {
  writeFileSync(join(dir, "mcp.json"), JSON.stringify(config, null, 2));
}

function okPlan(changes: HostSyncPlan["changes"] = []): HostSyncPlan {
  return { ok: true, changes: changes ?? [], filePath: "/fake", finalDoc: {}, warnings: [] };
}

function malformedReadAdapter(opts?: {
  omitsDisabled?: boolean;
  managed?: string[];
}): McpRowAdapter {
  return {
    omitsDisabled: opts?.omitsDisabled ?? true,
    available: () => true,
    read: (): HostReadResult => ({ ok: false, reason: "THIS IS NOT JSON <<<: invalid JSON" }),
    plan: (_c, _m) => ({ ok: false, reason: "THIS IS NOT JSON <<<: invalid JSON" }),
  };
}

function okReadAdapter(opts?: { serverNames?: string[]; omitsDisabled?: boolean }): McpRowAdapter {
  return {
    omitsDisabled: opts?.omitsDisabled ?? true,
    available: () => true,
    read: (): HostReadResult => ({
      ok: true,
      serverNames: opts?.serverNames ?? [],
      rawDoc: {},
    }),
    plan: (_c, _m) => okPlan(),
  };
}

// ── Fix 1: sync skips untargeted hosts with malformed configs ─────────────────

describe("runMcpSync — skip untargeted host with malformed config (fix 1)", () => {
  it("exits 0 when server is allowlisted to claude-code only and cursor config is malformed", async () => {
    // Canonical: server only targets claude-code
    placeClaudeCode();
    placeMalformedCursor();
    writeCanonical({
      "my-server": {
        command: "my-cmd",
        hosts: ["claude-code"],
      },
    });

    // Cursor has no intended servers (hosts excludes it) and no managed names.
    // Malformed cursor config must NOT block sync.
    const code = await runMcpSync();
    expect(code).toBe(0);
  });

  it("exits 0 when ALL servers exclude cursor and cursor config is malformed (no managed)", async () => {
    placeClaudeCode();
    placeMalformedCursor();
    writeCanonical({
      "srv-a": { command: "cmd-a", hosts: ["claude-code"] },
      "srv-b": { command: "cmd-b", hosts: ["claude-code"] },
    });

    const code = await runMcpSync();
    expect(code).toBe(0);
  });

  it("exits 1 when cursor has a managed entry pending removal and its config is malformed", async () => {
    // Place malformed cursor config (no well-formed cursor file)
    placeMalformedCursor();

    // Seed managed state: cursor previously managed "old-server"
    saveMcpManagedNames(skddTmp, "cursor", ["old-server"]);

    // Canonical no longer includes "old-server" on cursor (e.g., it was removed or hosts narrowed)
    writeCanonical({
      "my-server": {
        command: "my-cmd",
        hosts: ["claude-code"],
      },
    });

    // Cursor has managed cleanup pending + malformed config → sync must fail with error
    const code = await runMcpSync();
    expect(code).toBe(1);
  });

  it("well-formed untargeted cursor is silently skipped without error", async () => {
    placeClaudeCode();
    placeWellFormedCursor();
    writeCanonical({
      "my-server": {
        command: "my-cmd",
        hosts: ["claude-code"],
      },
    });

    const code = await runMcpSync();
    expect(code).toBe(0);
  });
});

// ── Fix 2: hub surfaces malformed excluded-host with pending managed entry ────

describe("buildMcpRows — malformed excluded host with managed entry (fix 2)", () => {
  it("shows 'drift' (not 'excluded') when excluded host has managed entry and malformed config", () => {
    // Server is allowlisted only to claude-code → cursor is excluded
    writeHubConfig(hubTmp, {
      version: 1,
      servers: {
        "my-server": {
          command: "my-cmd",
          hosts: ["claude-code"],
        },
      },
    });

    const rows = buildMcpRows(hubTmp, {
      adapters: {
        "claude-code": okReadAdapter({ serverNames: ["my-server"] }),
        // cursor: excluded by allowlist, malformed config, managed entry present
        cursor: malformedReadAdapter(),
      },
      loadManaged: (hostId) => {
        if (hostId === "cursor") return ["my-server"]; // pending cleanup
        if (hostId === "claude-code") return ["my-server"];
        return [];
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].hosts["cursor"]).toBe("drift");
  });

  it("shows 'excluded' (not 'drift') when excluded host is NOT managed (nothing to clean up)", () => {
    writeHubConfig(hubTmp, {
      version: 1,
      servers: {
        "my-server": {
          command: "my-cmd",
          hosts: ["claude-code"],
        },
      },
    });

    const rows = buildMcpRows(hubTmp, {
      adapters: {
        "claude-code": okReadAdapter({ serverNames: ["my-server"] }),
        cursor: malformedReadAdapter(), // malformed, but NOT managed
      },
      loadManaged: (hostId) => {
        if (hostId === "claude-code") return ["my-server"];
        return []; // cursor: not managed → nothing to clean up
      },
    });

    expect(rows).toHaveLength(1);
    // No managed entry on cursor → excluded is correct (nothing to do there)
    expect(rows[0].hosts["cursor"]).toBe("excluded");
  });

  it("shows 'drift' when excluded host has managed entry and readable config with server present", () => {
    // This is the existing behavior (present managed on excluded host → drift)
    writeHubConfig(hubTmp, {
      version: 1,
      servers: {
        "my-server": {
          command: "my-cmd",
          hosts: ["claude-code"],
        },
      },
    });

    const rows = buildMcpRows(hubTmp, {
      adapters: {
        "claude-code": okReadAdapter({ serverNames: ["my-server"] }),
        cursor: okReadAdapter({ serverNames: ["my-server"] }), // still present on cursor
      },
      loadManaged: (hostId) => {
        if (hostId === "cursor") return ["my-server"]; // pending removal
        if (hostId === "claude-code") return ["my-server"];
        return [];
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].hosts["cursor"]).toBe("drift");
  });

  it("shows 'excluded' when excluded host has managed entry that was already cleaned up (readable config, absent)", () => {
    // managed but entry absent and config readable → already cleaned up → excluded
    writeHubConfig(hubTmp, {
      version: 1,
      servers: {
        "my-server": {
          command: "my-cmd",
          hosts: ["claude-code"],
        },
      },
    });

    const rows = buildMcpRows(hubTmp, {
      adapters: {
        "claude-code": okReadAdapter({ serverNames: ["my-server"] }),
        cursor: okReadAdapter({ serverNames: [] }), // readable, but entry absent
      },
      loadManaged: (hostId) => {
        if (hostId === "cursor") return ["my-server"]; // was managed, now cleaned up
        if (hostId === "claude-code") return ["my-server"];
        return [];
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].hosts["cursor"]).toBe("excluded");
  });
});
