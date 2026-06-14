/**
 * mcp-omitted-only-skip.test.ts
 *
 * TDD for f-m13-omitted-only-skip:
 * The host-relevance check in runMcpSync / collectMcpPlanLines must use
 * isIntendedForHost() instead of only the `hosts` allowlist.
 *
 * A host is RELEVANT iff:
 *   (some canonical server passes isIntendedForHost(host))
 *   OR (it has managed names to clean up).
 *
 * "Omitted-only" hosts — where every canonical server would be omitted by the
 * adapter (disabled on an omitsDisabled adapter, or a remote server on a
 * stdio-only adapter like claude-desktop) — must be skipped BEFORE parsing.
 * A malformed config on such a host must not cause sync to exit 1.
 *
 * Test matrix:
 *   A. remote-only canonical + malformed claude-desktop (no managed) → exit 0
 *   B. disabled-only canonical + malformed cursor (no managed) → exit 0
 *   C. malformed + pending managed removal → exit 1 (M12-A5 regression guard)
 *   D. normal intended server on well-formed host → exit 0 (no regression)
 *   E. hub dry-run parity: collectMcpPlanLines skips omitted-only hosts too
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectMcpPlanLines, runMcpSync } from "../src/commands/mcp.js";
import { type CanonicalMcpConfig, saveMcpConfig } from "../src/lib/mcp/schema.js";
import { saveMcpManagedNames } from "../src/lib/mcp/state.js";

const runClaudeDesktopAvailable =
  process.platform === "darwin" || process.platform === "win32" ? it : it.skip;

// ── Environment setup ─────────────────────────────────────────────────────────

let skddTmp: string;
let homeTmp: string;
let prevSkddHome: string | undefined;
let prevHome: string | undefined;

beforeEach(() => {
  skddTmp = mkdtempSync(join(tmpdir(), "skdd-omit-only-skdd-"));
  homeTmp = mkdtempSync(join(tmpdir(), "skdd-omit-only-home-"));
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

/**
 * Place a malformed (invalid JSON) claude-desktop config.
 * Also creates the directory so available() returns true on macOS.
 */
function placeMalformedClaudeDesktop(): void {
  const dir = join(homeTmp, "Library", "Application Support", "Claude");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "claude_desktop_config.json"), "THIS IS NOT JSON <<<");
}

/** Place a malformed cursor config. */
function placeMalformedCursor(): void {
  mkdirSync(join(homeTmp, ".cursor"), { recursive: true });
  writeFileSync(join(homeTmp, ".cursor/mcp.json"), "THIS IS NOT JSON <<<");
}

/** Place a well-formed (empty) cursor config. */
function placeWellFormedCursor(): void {
  mkdirSync(join(homeTmp, ".cursor"), { recursive: true });
  writeFileSync(join(homeTmp, ".cursor/mcp.json"), JSON.stringify({ mcpServers: {} }, null, 2));
}

// ── A: remote-only canonical + malformed claude-desktop (no managed) → exit 0 ─

describe("A: remote-only server + malformed claude-desktop (no managed) → exit 0", () => {
  it("exits 0 when canonical has only a remote server and claude-desktop config is malformed with no managed names", async () => {
    // claude-desktop doesn't accept remote servers (acceptsRemote=false).
    // A remote-only canonical is "omitted-only" for claude-desktop.
    // Malformed config must NOT block sync when there is nothing to do there.
    placeMalformedClaudeDesktop();
    placeClaudeCode(); // provide at least one well-formed host so sync does real work

    writeCanonical({
      "remote-srv": {
        url: "https://mcp.example.com/sse",
        type: "sse",
        // No hosts filter: targets all hosts; but claude-desktop omits it anyway
      },
    });

    const code = await runMcpSync();
    expect(code).toBe(0);
  });

  it("exits 0 when ALL canonical servers are remote and claude-desktop config is malformed (no managed)", async () => {
    placeMalformedClaudeDesktop();
    placeClaudeCode();

    writeCanonical({
      "remote-a": { url: "https://a.example.com/mcp", type: "http" },
      "remote-b": { url: "https://b.example.com/mcp", type: "sse" },
    });

    const code = await runMcpSync();
    expect(code).toBe(0);
  });
});

// ── B: disabled-only canonical + malformed cursor (no managed) → exit 0 ───────

describe("B: disabled-only server + malformed cursor (omitsDisabled=true) (no managed) → exit 0", () => {
  it("exits 0 when canonical has only disabled servers and cursor config is malformed with no managed names", async () => {
    // cursor has omitsDisabled=true. A disabled-only canonical is "omitted-only"
    // for cursor. Malformed config must not block sync.
    placeClaudeCode();
    placeMalformedCursor();

    writeCanonical({
      "my-server": {
        command: "my-mcp",
        disabled: true,
        // No hosts filter: targets all hosts including cursor
      },
    });

    const code = await runMcpSync();
    expect(code).toBe(0);
  });

  it("exits 0 when ALL canonical servers are disabled and cursor config is malformed (no managed)", async () => {
    placeClaudeCode();
    placeMalformedCursor();

    writeCanonical({
      "srv-a": { command: "cmd-a", disabled: true },
      "srv-b": { command: "cmd-b", disabled: true },
    });

    const code = await runMcpSync();
    expect(code).toBe(0);
  });
});

// ── C: malformed + pending managed removal → exit 1 (M12-A5 regression guard) ─

describe("C: malformed config + pending managed removal → exit 1 (M12-A5 regression guard)", () => {
  it("exits 1 when cursor has a managed entry pending removal and its config is malformed", async () => {
    // Even though all new canonical servers would be omitted, the host has a
    // managed entry to clean up. It is still relevant and must be parsed.
    placeClaudeCode();
    placeMalformedCursor();

    // Seed: cursor previously managed "old-server"
    saveMcpManagedNames(skddTmp, "cursor", ["old-server"]);

    writeCanonical({
      "my-server": {
        command: "my-mcp",
        disabled: true, // would be omitted — but managed removal is still needed
      },
    });

    const code = await runMcpSync();
    expect(code).toBe(1);
  });

  runClaudeDesktopAvailable(
    "exits 1 when claude-desktop has a managed entry pending removal and its config is malformed",
    async () => {
      // Claude Desktop adapter is unavailable on Linux, so this regression is
      // covered only on platforms where a malformed config can be parsed.
      placeMalformedClaudeDesktop();
      placeClaudeCode();

      // Seed: claude-desktop previously managed "old-server"
      saveMcpManagedNames(skddTmp, "claude-desktop", ["old-server"]);

      writeCanonical({
        "remote-srv": {
          url: "https://mcp.example.com/sse",
          type: "sse",
          // remote-only → omitted by claude-desktop, but managed cleanup is still needed
        },
      });

      const code = await runMcpSync();
      // claude-desktop must be parsed to remove "old-server"; malformed → exit 1
      expect(code).toBe(1);
    },
  );
});

// ── D: well-formed host with intended server → exit 0 (no regression) ─────────

describe("D: normal intended server on well-formed host → unaffected (no regression)", () => {
  it("well-formed cursor with an intended (enabled stdio) server exits 0", async () => {
    placeClaudeCode();
    placeWellFormedCursor();

    writeCanonical({
      "my-server": { command: "my-mcp" },
    });

    const code = await runMcpSync();
    expect(code).toBe(0);
  });

  it("claude-code with intended server is processed even when claude-desktop is omitted-only + malformed", async () => {
    placeMalformedClaudeDesktop();
    placeClaudeCode();

    writeCanonical({
      "remote-srv": { url: "https://mcp.example.com/sse", type: "sse" },
    });

    // claude-code accepts remote servers; it should process the server fine.
    // claude-desktop is omitted-only → skipped. Overall exit 0.
    const code = await runMcpSync();
    expect(code).toBe(0);
  });
});

// ── E: hub dry-run parity — collectMcpPlanLines skips omitted-only hosts ──────

describe("E: hub dry-run parity — collectMcpPlanLines skips omitted-only + malformed hosts", () => {
  it("no 'blocked' line for claude-desktop when it is remote-only and config is malformed", async () => {
    placeMalformedClaudeDesktop();
    placeClaudeCode();

    writeCanonical({
      "remote-srv": { url: "https://mcp.example.com/sse", type: "sse" },
    });

    const lines = await collectMcpPlanLines();
    // claude-desktop must NOT appear as "blocked" — it should be silently skipped
    expect(lines.some((l) => l.includes("claude-desktop") && l.includes("blocked"))).toBe(false);
  });

  it("no 'blocked' line for cursor when all servers are disabled and config is malformed", async () => {
    placeClaudeCode();
    placeMalformedCursor();

    writeCanonical({
      srv: { command: "my-mcp", disabled: true },
    });

    const lines = await collectMcpPlanLines();
    expect(lines.some((l) => l.includes("cursor") && l.includes("blocked"))).toBe(false);
  });

  it("still shows 'blocked' for cursor when it has a managed removal pending + malformed config", async () => {
    placeClaudeCode();
    placeMalformedCursor();

    saveMcpManagedNames(skddTmp, "cursor", ["old-server"]);

    writeCanonical({
      srv: { command: "my-mcp", disabled: true },
    });

    const lines = await collectMcpPlanLines();
    // cursor has managed cleanup → relevant → blocked line must appear
    expect(lines.some((l) => l.includes("cursor") && l.includes("blocked"))).toBe(true);
  });
});
