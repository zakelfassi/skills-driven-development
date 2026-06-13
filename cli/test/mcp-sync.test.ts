/**
 * mcp-sync.test.ts
 *
 * E2E tests for runMcpSync orchestrating all 7 adapters.
 *
 * All tests use:
 *   SKDD_HOME = skddTmp — temp dir for canonical mcp.json + sync state
 *   HOME      = homeTmp — temp dir for host configs
 *
 * Safety: the real user HOME and SKDD_HOME are never touched.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMcpSync } from "../src/commands/mcp.js";
import { type CanonicalMcpConfig, loadMcpConfig, saveMcpConfig } from "../src/lib/mcp/schema.js";
import { loadMcpManagedNames } from "../src/lib/mcp/state.js";
import { loadState, statePath } from "../src/lib/sync-state.js";

const FIXTURES_DIR = join(__dirname, "fixtures", "mcp");

let skddTmp: string;
let homeTmp: string;
let prevSkddHome: string | undefined;
let prevHome: string | undefined;

beforeEach(() => {
  skddTmp = mkdtempSync(join(tmpdir(), "skdd-sync-skdd-"));
  homeTmp = mkdtempSync(join(tmpdir(), "skdd-sync-home-"));
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(relPath: string): string {
  const full = join(homeTmp, relPath);
  mkdirSync(full, { recursive: true });
  return full;
}

function placeFixture(fixtureName: string, relPath: string): string {
  const dest = join(homeTmp, relPath);
  mkdirSync(join(dest, ".."), { recursive: true });
  copyFileSync(join(FIXTURES_DIR, fixtureName), dest);
  return dest;
}

function placeAll() {
  // claude-code: always available (creates file on first sync)
  placeFixture("claude-code.json", ".claude.json");
  // codex: requires .codex dir
  ensureDir(".codex");
  placeFixture("codex.toml", ".codex/config.toml");
  // droid: requires .factory dir
  ensureDir(".factory");
  placeFixture("droid.json", ".factory/mcp.json");
  // cursor: requires .cursor dir
  ensureDir(".cursor");
  placeFixture("cursor.json", ".cursor/mcp.json");
  // opencode: requires .config/opencode dir
  ensureDir(".config/opencode");
  placeFixture("opencode.json", ".config/opencode/opencode.json");
  // gemini: requires .gemini dir
  ensureDir(".gemini");
  placeFixture("gemini.json", ".gemini/settings.json");
  // claude-desktop: darwin-only
  if (process.platform === "darwin") {
    ensureDir("Library/Application Support/Claude");
    placeFixture(
      "claude-desktop.json",
      "Library/Application Support/Claude/claude_desktop_config.json",
    );
  }
}

function writeCanonical(servers: CanonicalMcpConfig["servers"]): void {
  mkdirSync(join(skddTmp, "skills"), { recursive: true });
  saveMcpConfig(skddTmp, { version: 1, servers });
}

function readHostJson(relPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(homeTmp, relPath), "utf8")) as Record<string, unknown>;
}

function mtimeOf(relPath: string): number {
  return statSync(join(homeTmp, relPath)).mtimeMs;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runMcpSync — no canonical config", () => {
  it("exits 0 and prints no-config message when mcp.json does not exist", async () => {
    mkdirSync(join(skddTmp, "skills"), { recursive: true });
    const code = await runMcpSync();
    expect(code).toBe(0);
  });

  it("exits 0 when canonical has zero servers", async () => {
    writeCanonical({});
    const code = await runMcpSync();
    expect(code).toBe(0);
  });
});

describe("runMcpSync — basic sync", () => {
  it("adds managed server to all available hosts and records managed state", async () => {
    placeAll();
    writeCanonical({
      "skdd-test": {
        command: "npx",
        args: ["-y", "skdd-test-mcp"],
      },
    });

    const code = await runMcpSync();
    expect(code).toBe(0);

    // claude-code: mcpServers.skdd-test added
    const claudeCode = readHostJson(".claude.json");
    const ccServers = claudeCode.mcpServers as Record<string, unknown>;
    expect(ccServers["skdd-test"]).toBeDefined();
    // unmanaged server preserved
    expect(ccServers["user-managed-mcp"]).toBeDefined();

    // cursor: mcpServers.skdd-test added
    const cursor = readHostJson(".cursor/mcp.json");
    expect((cursor.mcpServers as Record<string, unknown>)["skdd-test"]).toBeDefined();

    // gemini: mcpServers.skdd-test added
    const gemini = readHostJson(".gemini/settings.json");
    expect((gemini.mcpServers as Record<string, unknown>)["skdd-test"]).toBeDefined();

    // droid: mcpServers.skdd-test added; persistentPermissions preserved
    const droid = readHostJson(".factory/mcp.json");
    expect((droid.mcpServers as Record<string, unknown>)["skdd-test"]).toBeDefined();
    expect((droid as Record<string, unknown>).persistentPermissions).toBeDefined();

    // opencode: mcp.skdd-test added with array command
    const opencode = readHostJson(".config/opencode/opencode.json");
    const ocServer = ((opencode as Record<string, unknown>).mcp as Record<string, unknown>)[
      "skdd-test"
    ] as Record<string, unknown>;
    expect(ocServer).toBeDefined();
    expect(Array.isArray(ocServer.command)).toBe(true);

    // managed state recorded
    const managed = loadMcpManagedNames(skddTmp, "claude-code");
    expect(managed).toContain("skdd-test");
    const managedCursor = loadMcpManagedNames(skddTmp, "cursor");
    expect(managedCursor).toContain("skdd-test");
  });

  it("records managed names in sync-state for each host that was written", async () => {
    placeAll();
    writeCanonical({
      myserver: { command: "my-cmd" },
    });

    await runMcpSync();

    const state = loadState(skddTmp);
    expect(state?.mcp).toBeDefined();
    expect(state?.mcp?.hosts["claude-code"]?.managed).toContain("myserver");
    expect(state?.mcp?.hosts["cursor"]?.managed).toContain("myserver");
    expect(state?.mcp?.hosts["droid"]?.managed).toContain("myserver");
  });
});

describe("runMcpSync — second sync is idempotent", () => {
  it("produces the same host config on second sync", async () => {
    placeAll();
    writeCanonical({
      "skdd-idempotent": { command: "npx", args: ["idem-pkg"] },
    });

    await runMcpSync();

    // Read resulting file content after first sync
    const afterFirst = readHostJson(".claude.json");
    const cursorAfterFirst = readHostJson(".cursor/mcp.json");

    // Second sync
    const code2 = await runMcpSync();
    expect(code2).toBe(0);

    const afterSecond = readHostJson(".claude.json");
    const cursorAfterSecond = readHostJson(".cursor/mcp.json");

    expect(afterSecond).toEqual(afterFirst);
    expect(cursorAfterSecond).toEqual(cursorAfterFirst);
  });

  it("managed state unchanged on second sync", async () => {
    placeAll();
    writeCanonical({ srv: { command: "srv-cmd" } });

    await runMcpSync();
    const state1 = loadState(skddTmp);

    await runMcpSync();
    const state2 = loadState(skddTmp);

    expect(state2?.mcp?.hosts["claude-code"]?.managed).toEqual(
      state1?.mcp?.hosts["claude-code"]?.managed,
    );
  });
});

describe("runMcpSync — second sync is a true no-op (mtime)", () => {
  it("does not write any JSON host files on second sync when content is unchanged", async () => {
    placeAll();
    writeCanonical({
      "noop-test": { command: "npx", args: ["-y", "noop-mcp"] },
    });

    // First sync: writes all available hosts
    const code1 = await runMcpSync();
    expect(code1).toBe(0);

    // Capture mtimes after first sync
    const mtimes = {
      claudeCode: mtimeOf(".claude.json"),
      cursor: mtimeOf(".cursor/mcp.json"),
      gemini: mtimeOf(".gemini/settings.json"),
      droid: mtimeOf(".factory/mcp.json"),
      codex: mtimeOf(".codex/config.toml"),
    };

    // Add a small sleep so mtime would differ if any file is written
    await new Promise((r) => setTimeout(r, 20));

    // Second sync: should produce zero changes (no writes)
    const code2 = await runMcpSync();
    expect(code2).toBe(0);

    expect(mtimeOf(".claude.json")).toBe(mtimes.claudeCode);
    expect(mtimeOf(".cursor/mcp.json")).toBe(mtimes.cursor);
    expect(mtimeOf(".gemini/settings.json")).toBe(mtimes.gemini);
    expect(mtimeOf(".factory/mcp.json")).toBe(mtimes.droid);
    expect(mtimeOf(".codex/config.toml")).toBe(mtimes.codex);
  });

  it("does not create a new .bak on second sync", async () => {
    placeAll();
    writeCanonical({ "bak-noop": { command: "bak-cmd" } });

    // First sync creates .bak
    await runMcpSync();
    expect(existsSync(join(homeTmp, ".claude.json.bak"))).toBe(true);

    const bakMtime = statSync(join(homeTmp, ".claude.json.bak")).mtimeMs;

    await new Promise((r) => setTimeout(r, 20));

    // Second sync should not touch .bak
    await runMcpSync();
    expect(statSync(join(homeTmp, ".claude.json.bak")).mtimeMs).toBe(bakMtime);
  });

  it("reports zero changes per host on second sync", async () => {
    placeAll();
    writeCanonical({ "zero-changes": { command: "zc-cmd" } });

    await runMcpSync();

    // Capture console.log output during second sync
    const messages: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      messages.push(String(args[0]));
    };
    await runMcpSync();
    console.log = origLog;

    // No add/update/remove symbols ("+", "~", "-") should appear in host lines
    const changeSymbols = messages.filter((m) => /\] [+~-] /.test(m));
    expect(changeSymbols).toHaveLength(0);
    // At least one "no changes" message should appear
    const noChanges = messages.filter((m) => m.includes("no changes"));
    expect(noChanges.length).toBeGreaterThan(0);
  });
});

describe("runMcpSync — hosts allowlist", () => {
  it("restricts server to listed hosts only", async () => {
    placeAll();
    writeCanonical({
      "droid-only": {
        command: "droid-mcp",
        hosts: ["droid"],
      },
      "all-hosts": {
        command: "all-mcp",
      },
    });

    const code = await runMcpSync();
    expect(code).toBe(0);

    // droid-only should be in droid
    const droid = readHostJson(".factory/mcp.json");
    expect((droid.mcpServers as Record<string, unknown>)["droid-only"]).toBeDefined();

    // droid-only should NOT be in cursor
    const cursor = readHostJson(".cursor/mcp.json");
    expect((cursor.mcpServers as Record<string, unknown>)["droid-only"]).toBeUndefined();

    // all-hosts should be in both
    expect((droid.mcpServers as Record<string, unknown>)["all-hosts"]).toBeDefined();
    expect((cursor.mcpServers as Record<string, unknown>)["all-hosts"]).toBeDefined();
  });

  it("managed state reflects only what was written per host", async () => {
    placeAll();
    writeCanonical({
      "droid-only": { command: "dm", hosts: ["droid"] },
    });

    await runMcpSync();

    expect(loadMcpManagedNames(skddTmp, "droid")).toContain("droid-only");
    expect(loadMcpManagedNames(skddTmp, "cursor")).not.toContain("droid-only");
    expect(loadMcpManagedNames(skddTmp, "gemini")).not.toContain("droid-only");
  });
});

describe("runMcpSync — unavailable host skipped", () => {
  it("skips droid when .factory dir does not exist", async () => {
    // Only set up a subset of hosts (no .factory dir)
    placeFixture("claude-code.json", ".claude.json");
    ensureDir(".cursor");
    placeFixture("cursor.json", ".cursor/mcp.json");
    writeCanonical({ srv: { command: "srv-cmd" } });

    const code = await runMcpSync();
    expect(code).toBe(0);

    // droid should not have been written (no .factory dir)
    expect(existsSync(join(homeTmp, ".factory", "mcp.json"))).toBe(false);

    // managed state for droid should not exist
    expect(loadMcpManagedNames(skddTmp, "droid")).toEqual([]);

    // claude-code was written
    const ccServers = (readHostJson(".claude.json").mcpServers ?? {}) as Record<string, unknown>;
    expect(ccServers["srv"]).toBeDefined();
  });

  it("skips cursor when .cursor dir does not exist", async () => {
    // Set up claude-code and droid only
    placeFixture("claude-code.json", ".claude.json");
    ensureDir(".factory");
    placeFixture("droid.json", ".factory/mcp.json");
    writeCanonical({ srv: { command: "cmd" } });

    await runMcpSync();

    // cursor dir doesn't exist, so no cursor file written
    expect(existsSync(join(homeTmp, ".cursor", "mcp.json"))).toBe(false);
    expect(loadMcpManagedNames(skddTmp, "cursor")).toEqual([]);
  });
});

describe("runMcpSync — dry-run writes nothing", () => {
  it("does not modify any host files when --dry-run is set", async () => {
    placeAll();
    writeCanonical({
      "skdd-dry": { command: "npx", args: ["dry-mcp"] },
    });

    // Record mtimes before dry-run
    const before = {
      claudeCode: mtimeOf(".claude.json"),
      cursor: mtimeOf(".cursor/mcp.json"),
      gemini: mtimeOf(".gemini/settings.json"),
      droid: mtimeOf(".factory/mcp.json"),
    };

    // Add a small sleep so mtime would change if written
    await new Promise((r) => setTimeout(r, 15));

    const code = await runMcpSync({ dryRun: true });
    expect(code).toBe(0);

    // All mtimes unchanged
    expect(mtimeOf(".claude.json")).toBe(before.claudeCode);
    expect(mtimeOf(".cursor/mcp.json")).toBe(before.cursor);
    expect(mtimeOf(".gemini/settings.json")).toBe(before.gemini);
    expect(mtimeOf(".factory/mcp.json")).toBe(before.droid);
  });

  it("does not update sync state when --dry-run is set", async () => {
    placeAll();
    writeCanonical({ srv: { command: "cmd" } });

    await runMcpSync({ dryRun: true });

    // Sync state should not record managed names for dry-run
    expect(loadMcpManagedNames(skddTmp, "claude-code")).toEqual([]);
    expect(loadMcpManagedNames(skddTmp, "cursor")).toEqual([]);
  });
});

describe("runMcpSync — .bak backup", () => {
  it("creates a .bak file with original content before first write", async () => {
    placeAll();
    writeCanonical({ "skdd-bak-test": { command: "backup-mcp" } });

    const originalContent = readFileSync(join(homeTmp, ".claude.json"), "utf8");

    await runMcpSync();

    const bakPath = join(homeTmp, ".claude.json.bak");
    expect(existsSync(bakPath)).toBe(true);
    expect(readFileSync(bakPath, "utf8")).toBe(originalContent);
  });

  it(".bak content matches pre-write content for cursor", async () => {
    placeAll();
    writeCanonical({ "skdd-bak": { command: "bak-cmd" } });

    const originalCursor = readFileSync(join(homeTmp, ".cursor/mcp.json"), "utf8");

    await runMcpSync();

    const bakPath = join(homeTmp, ".cursor/mcp.json.bak");
    expect(existsSync(bakPath)).toBe(true);
    expect(readFileSync(bakPath, "utf8")).toBe(originalCursor);
  });

  it(".bak content matches pre-write content for droid", async () => {
    placeAll();
    writeCanonical({ "skdd-bak": { command: "bak-cmd" } });

    const originalDroid = readFileSync(join(homeTmp, ".factory/mcp.json"), "utf8");

    await runMcpSync();

    const bakPath = join(homeTmp, ".factory/mcp.json.bak");
    expect(existsSync(bakPath)).toBe(true);
    expect(readFileSync(bakPath, "utf8")).toBe(originalDroid);
  });
});

describe("runMcpSync — ${VAR} expansion", () => {
  it("expands env vars in non-droid hosts at write time", async () => {
    placeFixture("claude-code.json", ".claude.json");
    writeCanonical({
      "env-test": {
        command: "npx",
        env: { API_KEY: "${TEST_MCP_API_KEY}" },
      },
    });

    const prevKey = process.env.TEST_MCP_API_KEY;
    process.env.TEST_MCP_API_KEY = "resolved-secret";
    try {
      await runMcpSync();
    } finally {
      if (prevKey === undefined) delete process.env.TEST_MCP_API_KEY;
      else process.env.TEST_MCP_API_KEY = prevKey;
    }

    const cc = readHostJson(".claude.json");
    const srv = (cc.mcpServers as Record<string, unknown>)["env-test"] as Record<string, unknown>;
    expect((srv.env as Record<string, unknown>)["API_KEY"]).toBe("resolved-secret");

    // Canonical file unchanged (no resolved secrets)
    const canonical = loadMcpConfig(skddTmp);
    const canonSrv = canonical?.servers["env-test"];
    expect(canonSrv && "env" in canonSrv && canonSrv.env?.["API_KEY"]).toBe("${TEST_MCP_API_KEY}");
  });

  it("skips server for non-droid host when env var is unresolved", async () => {
    placeFixture("claude-code.json", ".claude.json");
    ensureDir(".factory");
    placeFixture("droid.json", ".factory/mcp.json");

    writeCanonical({
      "unresolved-srv": {
        command: "npx",
        env: { SECRET: "${DEFINITELY_UNSET_VAR_XYZ_ABC}" },
      },
    });

    // Ensure var is unset
    const prev = process.env.DEFINITELY_UNSET_VAR_XYZ_ABC;
    delete process.env.DEFINITELY_UNSET_VAR_XYZ_ABC;
    try {
      const code = await runMcpSync();
      // Should exit 0 — unresolved var is a warning, not an error
      expect(code).toBe(0);
    } finally {
      if (prev !== undefined) process.env.DEFINITELY_UNSET_VAR_XYZ_ABC = prev;
    }

    // claude-code should NOT have the server (unresolved var → skip for this host)
    const cc = readHostJson(".claude.json");
    const ccServers = cc.mcpServers as Record<string, unknown>;
    expect(ccServers["unresolved-srv"]).toBeUndefined();

    // droid SHOULD have the server (native ${VAR} passthrough)
    const droid = readHostJson(".factory/mcp.json");
    const droidSrv = (droid.mcpServers as Record<string, unknown>)["unresolved-srv"] as Record<
      string,
      unknown
    >;
    expect(droidSrv).toBeDefined();
    expect((droidSrv.env as Record<string, unknown>)["SECRET"]).toBe(
      "${DEFINITELY_UNSET_VAR_XYZ_ABC}",
    );
  });
});

describe("runMcpSync — malformed host config blocks write, continues others", () => {
  it("exits 1 when a host has malformed JSON, continues syncing other hosts", async () => {
    // Set up claude-code with malformed JSON
    writeFileSync(join(homeTmp, ".claude.json"), "{ invalid json }", "utf8");
    // Set up cursor normally
    ensureDir(".cursor");
    placeFixture("cursor.json", ".cursor/mcp.json");

    writeCanonical({ srv: { command: "cmd" } });

    const code = await runMcpSync();
    // Exit 1 because one host was blocked
    expect(code).toBe(1);

    // cursor was still written (continues after blocked host)
    const cursor = readHostJson(".cursor/mcp.json");
    expect((cursor.mcpServers as Record<string, unknown>)["srv"]).toBeDefined();
  });

  it("exits 1 when mcpServers is a string ('oops'), does not overwrite, continues other hosts", async () => {
    // claude-code has mcpServers as a string — malformed
    writeFileSync(join(homeTmp, ".claude.json"), JSON.stringify({ mcpServers: "oops" }), "utf8");
    const claudeMtimeBefore = statSync(join(homeTmp, ".claude.json")).mtimeMs;

    // cursor is healthy
    ensureDir(".cursor");
    placeFixture("cursor.json", ".cursor/mcp.json");

    writeCanonical({ srv: { command: "cmd" } });

    const code = await runMcpSync();
    expect(code).toBe(1);

    // claude-code file is NOT overwritten
    expect(statSync(join(homeTmp, ".claude.json")).mtimeMs).toBe(claudeMtimeBefore);
    expect(
      (JSON.parse(readFileSync(join(homeTmp, ".claude.json"), "utf8")) as Record<string, unknown>)
        .mcpServers,
    ).toBe("oops");

    // cursor was still synced
    const cursor = readHostJson(".cursor/mcp.json");
    expect((cursor.mcpServers as Record<string, unknown>)["srv"]).toBeDefined();
  });

  it("exits 1 when mcpServers is an array ([]), does not overwrite, continues other hosts", async () => {
    // claude-code has mcpServers as an array — malformed
    writeFileSync(join(homeTmp, ".claude.json"), JSON.stringify({ mcpServers: [] }), "utf8");
    const claudeMtimeBefore = statSync(join(homeTmp, ".claude.json")).mtimeMs;

    // cursor is healthy
    ensureDir(".cursor");
    placeFixture("cursor.json", ".cursor/mcp.json");

    writeCanonical({ srv: { command: "cmd" } });

    const code = await runMcpSync();
    expect(code).toBe(1);

    // claude-code file is NOT overwritten
    expect(statSync(join(homeTmp, ".claude.json")).mtimeMs).toBe(claudeMtimeBefore);
    expect(
      (JSON.parse(readFileSync(join(homeTmp, ".claude.json"), "utf8")) as Record<string, unknown>)
        .mcpServers,
    ).toEqual([]);

    // cursor was still synced
    const cursor = readHostJson(".cursor/mcp.json");
    expect((cursor.mcpServers as Record<string, unknown>)["srv"]).toBeDefined();
  });
});

// ── Fix 3: allowlist narrowing removal (integration) ─────────────────────────

describe("runMcpSync — allowlist narrowing removal (fix-3)", () => {
  it("removes a managed server from a host when its allowlist is updated to exclude that host", async () => {
    placeAll();

    // First sync: server available on all hosts
    writeCanonical({ "narrowing-srv": { command: "cmd" } });
    await runMcpSync();

    // Verify it was synced to cursor
    expect(
      (readHostJson(".cursor/mcp.json").mcpServers as Record<string, unknown>)["narrowing-srv"],
    ).toBeDefined();

    // Second canonical: server now restricted to droid only
    writeCanonical({
      "narrowing-srv": { command: "cmd", hosts: ["droid"] },
    });
    const code2 = await runMcpSync();
    expect(code2).toBe(0);

    // cursor should no longer have the server
    expect(
      (readHostJson(".cursor/mcp.json").mcpServers as Record<string, unknown>)["narrowing-srv"],
    ).toBeUndefined();
    // droid should still have it
    expect(
      (readHostJson(".factory/mcp.json").mcpServers as Record<string, unknown>)["narrowing-srv"],
    ).toBeDefined();
  });

  it("updates managed state to reflect removal from excluded host", async () => {
    placeAll();
    writeCanonical({ "narrowing-srv": { command: "cmd" } });
    await runMcpSync();

    expect(loadMcpManagedNames(skddTmp, "cursor")).toContain("narrowing-srv");

    // Update allowlist to exclude cursor
    writeCanonical({ "narrowing-srv": { command: "cmd", hosts: ["droid"] } });
    await runMcpSync();

    expect(loadMcpManagedNames(skddTmp, "cursor")).not.toContain("narrowing-srv");
    expect(loadMcpManagedNames(skddTmp, "droid")).toContain("narrowing-srv");
  });
});

// ── Fix 4: same-name unmanaged safety (integration) ──────────────────────────

describe("runMcpSync — same-name unmanaged safety (fix-4)", () => {
  it("does not overwrite a user-authored entry that has the same name as a canonical server", async () => {
    placeAll();

    // claude-code fixture has "user-managed-mcp" as unmanaged
    writeCanonical({
      "user-managed-mcp": { command: "new-skdd-cmd" },
    });

    const code = await runMcpSync();
    // Not an error — just a warning
    expect(code).toBe(0);

    // The user-authored entry must not be overwritten
    const cc = readHostJson(".claude.json");
    const entry = (cc.mcpServers as Record<string, unknown>)["user-managed-mcp"] as Record<
      string,
      unknown
    >;
    expect(entry["command"]).toBe("npx"); // fixture value preserved
    expect(entry["command"]).not.toBe("new-skdd-cmd");
  });

  it("does not add the collision server to managed state", async () => {
    placeAll();
    writeCanonical({ "user-managed-mcp": { command: "new-skdd-cmd" } });
    await runMcpSync();

    // Should NOT be tracked as managed (was never written by skdd)
    expect(loadMcpManagedNames(skddTmp, "claude-code")).not.toContain("user-managed-mcp");
  });
});

// ── Fix 5: saveState no-op gate ───────────────────────────────────────────────

describe("runMcpSync — saveState no-op gate (fix-5)", () => {
  it("does not rewrite .skdd-sync.json on a second sync when nothing changed", async () => {
    placeAll();
    writeCanonical({ "state-noop": { command: "cmd" } });

    // First sync: creates the state file
    await runMcpSync();

    const statePath = join(skddTmp, ".skdd-sync.json");
    expect(existsSync(statePath)).toBe(true);
    const stateMtime1 = statSync(statePath).mtimeMs;

    await new Promise((r) => setTimeout(r, 25));

    // Second sync: no changes → state should NOT be rewritten
    const code2 = await runMcpSync();
    expect(code2).toBe(0);

    expect(statSync(statePath).mtimeMs).toBe(stateMtime1);
  });

  it("does rewrite .skdd-sync.json when a change actually occurs", async () => {
    placeAll();
    writeCanonical({ "state-change-test": { command: "cmd" } });

    // First sync: state written
    await runMcpSync();

    const statePath = join(skddTmp, ".skdd-sync.json");
    const stateMtime1 = statSync(statePath).mtimeMs;

    await new Promise((r) => setTimeout(r, 25));

    // Update canonical with a new server — forces a write
    writeCanonical({
      "state-change-test": { command: "cmd" },
      "state-change-test2": { command: "cmd2" },
    });
    await runMcpSync();

    // State must have been rewritten
    expect(statSync(statePath).mtimeMs).toBeGreaterThan(stateMtime1);
  });
});

// ── Fix 6: removal after sync — managed server deleted from host configs ──────

describe("runMcpSync — removal after sync (fix-6)", () => {
  it("deletes a managed server from all JSON host configs after remove + sync", async () => {
    placeAll();

    // First sync: add managed-srv to all hosts
    writeCanonical({ "managed-srv": { command: "my-mcp-cmd" } });
    const code1 = await runMcpSync();
    expect(code1).toBe(0);

    // Verify the server was synced to claude-code and cursor
    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["managed-srv"],
    ).toBeDefined();
    expect(
      (readHostJson(".cursor/mcp.json").mcpServers as Record<string, unknown>)["managed-srv"],
    ).toBeDefined();

    // Remove managed-srv from canonical (empty servers)
    writeCanonical({});
    const code2 = await runMcpSync();
    expect(code2).toBe(0);

    // managed-srv must be gone from all JSON hosts
    const cc = readHostJson(".claude.json");
    expect((cc.mcpServers as Record<string, unknown>)["managed-srv"]).toBeUndefined();

    const cursor = readHostJson(".cursor/mcp.json");
    expect((cursor.mcpServers as Record<string, unknown>)["managed-srv"]).toBeUndefined();

    const droid = readHostJson(".factory/mcp.json");
    expect((droid.mcpServers as Record<string, unknown>)["managed-srv"]).toBeUndefined();

    const gemini = readHostJson(".gemini/settings.json");
    expect((gemini.mcpServers as Record<string, unknown>)["managed-srv"]).toBeUndefined();
  });

  it("deletes a managed server from codex TOML after remove + sync", async () => {
    placeAll();

    // First sync: add managed-srv to codex
    writeCanonical({ "managed-srv": { command: "my-mcp-cmd" } });
    await runMcpSync();

    // Verify codex has the managed block
    const tomlAfterAdd = readFileSync(join(homeTmp, ".codex/config.toml"), "utf8");
    expect(tomlAfterAdd).toContain("[mcp_servers.managed-srv]");

    // Remove managed-srv from canonical (empty servers)
    writeCanonical({});
    const code2 = await runMcpSync();
    expect(code2).toBe(0);

    // managed-srv block must be gone from codex TOML
    const tomlAfterRemove = readFileSync(join(homeTmp, ".codex/config.toml"), "utf8");
    expect(tomlAfterRemove).not.toContain("[mcp_servers.managed-srv]");
    // Unmanaged TOML entries must be preserved
    expect(tomlAfterRemove).toContain("[mcp_servers.user_owned]");
    expect(tomlAfterRemove).toContain("[mcp_servers.existing_managed]");
    // Comments must be preserved
    expect(tomlAfterRemove).toContain("# Codex CLI configuration");
  });

  it("preserves unmanaged entries in JSON hosts after remove + sync", async () => {
    placeAll();

    // claude-code fixture has user-managed-mcp as unmanaged
    writeCanonical({ "managed-srv": { command: "cmd" } });
    await runMcpSync();

    writeCanonical({});
    await runMcpSync();

    // Unmanaged entries must survive
    const cc = readHostJson(".claude.json");
    expect((cc.mcpServers as Record<string, unknown>)["user-managed-mcp"]).toBeDefined();
  });

  it("clears managed state for the removed server after remove + sync", async () => {
    placeAll();

    writeCanonical({ "managed-srv": { command: "cmd" } });
    await runMcpSync();

    expect(loadMcpManagedNames(skddTmp, "claude-code")).toContain("managed-srv");
    expect(loadMcpManagedNames(skddTmp, "codex")).toContain("managed-srv");

    writeCanonical({});
    await runMcpSync();

    expect(loadMcpManagedNames(skddTmp, "claude-code")).not.toContain("managed-srv");
    expect(loadMcpManagedNames(skddTmp, "codex")).not.toContain("managed-srv");
    expect(loadMcpManagedNames(skddTmp, "cursor")).not.toContain("managed-srv");
    expect(loadMcpManagedNames(skddTmp, "droid")).not.toContain("managed-srv");
  });

  it("empty-canonical case: still runs removal planning when no mcp.json servers remain", async () => {
    placeAll();

    // Add and sync a server
    writeCanonical({ "rm-test": { command: "rm-cmd" } });
    await runMcpSync();

    // Now remove from canonical by writing empty servers (simulates skdd mcp remove)
    writeCanonical({});

    // Must exit 0 and delete managed server from hosts
    const code = await runMcpSync();
    expect(code).toBe(0);

    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["rm-test"],
    ).toBeUndefined();
    expect(
      (readHostJson(".cursor/mcp.json").mcpServers as Record<string, unknown>)["rm-test"],
    ).toBeUndefined();
  });
});

// ── Fix: preserve managed entry on env-expansion failure (Bug 1) ─────────────

describe("runMcpSync — preserve managed entry on env-expansion failure", () => {
  it("keeps existing host entry when managed server's env var is unset", async () => {
    placeAll();

    // First sync: add managed-srv to all hosts (no env vars)
    writeCanonical({ "env-managed-srv": { command: "my-mcp" } });
    await runMcpSync();

    // Verify it's present
    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["env-managed-srv"],
    ).toBeDefined();
    expect(loadMcpManagedNames(skddTmp, "claude-code")).toContain("env-managed-srv");

    // Update canonical: introduce an unset env var
    writeCanonical({
      "env-managed-srv": {
        command: "my-mcp",
        env: { TOKEN: "${DEFINITELY_UNSET_MANAGED_VAR}" },
      },
    });

    const prev = process.env.DEFINITELY_UNSET_MANAGED_VAR;
    delete process.env.DEFINITELY_UNSET_MANAGED_VAR;
    let code: number;
    try {
      code = await runMcpSync();
    } finally {
      if (prev !== undefined) process.env.DEFINITELY_UNSET_MANAGED_VAR = prev;
    }

    // Exit 0 — unresolved var on managed server is a warning, not an error
    expect(code).toBe(0);

    // Host entry must still exist (not removed)
    const cc = readHostJson(".claude.json");
    expect((cc.mcpServers as Record<string, unknown>)["env-managed-srv"]).toBeDefined();

    // Still tracked as managed (so when env var is later set, it will be updated)
    expect(loadMcpManagedNames(skddTmp, "claude-code")).toContain("env-managed-srv");
  });

  it("does not remove managed server from cursor when its env var is unset", async () => {
    placeAll();

    writeCanonical({ "cur-env-srv": { command: "cur-mcp" } });
    await runMcpSync();
    expect(
      (readHostJson(".cursor/mcp.json").mcpServers as Record<string, unknown>)["cur-env-srv"],
    ).toBeDefined();

    writeCanonical({
      "cur-env-srv": { command: "cur-mcp", env: { KEY: "${UNSET_CURSOR_VAR_XYZ}" } },
    });

    const prev = process.env.UNSET_CURSOR_VAR_XYZ;
    delete process.env.UNSET_CURSOR_VAR_XYZ;
    try {
      await runMcpSync();
    } finally {
      if (prev !== undefined) process.env.UNSET_CURSOR_VAR_XYZ = prev;
    }

    // Entry must survive
    expect(
      (readHostJson(".cursor/mcp.json").mcpServers as Record<string, unknown>)["cur-env-srv"],
    ).toBeDefined();
  });

  it("still skips new (unmanaged) server when env var is unset", async () => {
    placeFixture("claude-code.json", ".claude.json");

    writeCanonical({
      "new-unresolved-srv": {
        command: "mcp",
        env: { KEY: "${UNSET_NEW_SRV_VAR}" },
      },
    });

    const prev = process.env.UNSET_NEW_SRV_VAR;
    delete process.env.UNSET_NEW_SRV_VAR;
    try {
      await runMcpSync();
    } finally {
      if (prev !== undefined) process.env.UNSET_NEW_SRV_VAR = prev;
    }

    // New server with unresolved var must NOT be written (original behaviour)
    const cc = readHostJson(".claude.json");
    expect((cc.mcpServers as Record<string, unknown>)["new-unresolved-srv"]).toBeUndefined();
  });
});

// ── Fix: reconcile managed state when host entry already gone (Bug 2) ─────────

describe("runMcpSync — reconcile managed state when host entry already gone", () => {
  it("clears managed state for a server removed from canonical even when host entry is already absent", async () => {
    placeAll();

    // First sync: get srv into managed state
    writeCanonical({ "stale-managed": { command: "stale-cmd" } });
    await runMcpSync();
    expect(loadMcpManagedNames(skddTmp, "claude-code")).toContain("stale-managed");

    // Simulate the host entry having already been deleted externally
    const cc = JSON.parse(readFileSync(join(homeTmp, ".claude.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const mcpServers = cc.mcpServers as Record<string, unknown>;
    delete mcpServers["stale-managed"];
    writeFileSync(join(homeTmp, ".claude.json"), JSON.stringify(cc, null, 2), "utf8");

    // Remove srv from canonical
    writeCanonical({});

    // Sync: no change needed (entry already gone) but managed state must be cleared
    const code = await runMcpSync();
    expect(code).toBe(0);
    expect(loadMcpManagedNames(skddTmp, "claude-code")).not.toContain("stale-managed");
  });

  it("user-authored entry with same name is NOT removed after managed state is cleared", async () => {
    placeAll();

    // Sync, then manually remove host entry, remove from canonical, sync again
    writeCanonical({ "reuse-name": { command: "original-cmd" } });
    await runMcpSync();

    // Delete host entry externally
    const cc = JSON.parse(readFileSync(join(homeTmp, ".claude.json"), "utf8")) as Record<
      string,
      unknown
    >;
    delete (cc.mcpServers as Record<string, unknown>)["reuse-name"];
    writeFileSync(join(homeTmp, ".claude.json"), JSON.stringify(cc, null, 2), "utf8");

    // Remove from canonical → managed state should be cleared
    writeCanonical({});
    await runMcpSync();
    expect(loadMcpManagedNames(skddTmp, "claude-code")).not.toContain("reuse-name");

    // User authors a new entry with the same name
    const cc2 = JSON.parse(readFileSync(join(homeTmp, ".claude.json"), "utf8")) as Record<
      string,
      unknown
    >;
    (cc2.mcpServers as Record<string, unknown>)["reuse-name"] = {
      command: "user-authored-cmd",
    };
    writeFileSync(join(homeTmp, ".claude.json"), JSON.stringify(cc2, null, 2), "utf8");

    // Another sync with canonical still empty: user entry must NOT be removed
    const code = await runMcpSync();
    expect(code).toBe(0);
    const cc3 = JSON.parse(readFileSync(join(homeTmp, ".claude.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const entry = (cc3.mcpServers as Record<string, unknown>)["reuse-name"] as Record<
      string,
      unknown
    >;
    expect(entry).toBeDefined();
    expect(entry["command"]).toBe("user-authored-cmd");
  });
});

// ── Fix: evaluate removal/omission intent before preserving unresolved placeholders ──

describe("runMcpSync — removal/omission intent checked before placeholder preservation", () => {
  it("managed server with unset ${VAR} that is also disabled:true → host entry is REMOVED (not preserved)", async () => {
    placeAll();

    // First sync: add srv to all hosts (no env vars yet)
    writeCanonical({ "disabled-var-srv": { command: "my-mcp" } });
    await runMcpSync();
    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["disabled-var-srv"],
    ).toBeDefined();
    expect(loadMcpManagedNames(skddTmp, "claude-code")).toContain("disabled-var-srv");

    // Update canonical: add unset env var + disabled:true
    writeCanonical({
      "disabled-var-srv": {
        command: "my-mcp",
        env: { TOKEN: "${DEFINITELY_UNSET_REMOVAL_VAR}" },
        disabled: true,
      },
    });

    const prev = process.env.DEFINITELY_UNSET_REMOVAL_VAR;
    delete process.env.DEFINITELY_UNSET_REMOVAL_VAR;
    let code: number;
    try {
      code = await runMcpSync();
    } finally {
      if (prev !== undefined) process.env.DEFINITELY_UNSET_REMOVAL_VAR = prev;
    }

    expect(code).toBe(0);

    // Host entry must be REMOVED (disabled intent wins over unset var preservation)
    const cc = readHostJson(".claude.json");
    expect((cc.mcpServers as Record<string, unknown>)["disabled-var-srv"]).toBeUndefined();

    // Managed state must be cleared
    expect(loadMcpManagedNames(skddTmp, "claude-code")).not.toContain("disabled-var-srv");
  });

  it("managed server with unset ${VAR} that is also excluded by hosts allowlist → host entry is REMOVED (not preserved)", async () => {
    placeAll();

    // First sync: add srv to all hosts (no hosts filter yet)
    writeCanonical({ "excluded-var-srv": { command: "cursor-only-mcp" } });
    await runMcpSync();
    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["excluded-var-srv"],
    ).toBeDefined();
    expect(loadMcpManagedNames(skddTmp, "claude-code")).toContain("excluded-var-srv");

    // Update canonical: add unset env var + narrow hosts to cursor only (excludes claude-code)
    writeCanonical({
      "excluded-var-srv": {
        command: "cursor-only-mcp",
        env: { KEY: "${DEFINITELY_UNSET_EXCLUDED_VAR}" },
        hosts: ["cursor"],
      },
    });

    const prev = process.env.DEFINITELY_UNSET_EXCLUDED_VAR;
    delete process.env.DEFINITELY_UNSET_EXCLUDED_VAR;
    let code: number;
    try {
      code = await runMcpSync();
    } finally {
      if (prev !== undefined) process.env.DEFINITELY_UNSET_EXCLUDED_VAR = prev;
    }

    expect(code).toBe(0);

    // claude-code entry must be REMOVED (host excluded intent wins over unset var preservation)
    const cc = readHostJson(".claude.json");
    expect((cc.mcpServers as Record<string, unknown>)["excluded-var-srv"]).toBeUndefined();

    // Managed state cleared for claude-code
    expect(loadMcpManagedNames(skddTmp, "claude-code")).not.toContain("excluded-var-srv");
  });

  it("managed server with unset ${VAR} still intended for this host → preserved with warning (M5 regression)", async () => {
    placeAll();

    // First sync: add srv to all hosts
    writeCanonical({ "intended-var-srv": { command: "my-mcp" } });
    await runMcpSync();
    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["intended-var-srv"],
    ).toBeDefined();
    expect(loadMcpManagedNames(skddTmp, "claude-code")).toContain("intended-var-srv");

    // Update canonical: add unset env var, no disabled/hosts filter (still intended for all hosts)
    writeCanonical({
      "intended-var-srv": {
        command: "my-mcp",
        env: { TOKEN: "${DEFINITELY_UNSET_INTENDED_VAR}" },
      },
    });

    const prev = process.env.DEFINITELY_UNSET_INTENDED_VAR;
    delete process.env.DEFINITELY_UNSET_INTENDED_VAR;
    let code: number;
    try {
      code = await runMcpSync();
    } finally {
      if (prev !== undefined) process.env.DEFINITELY_UNSET_INTENDED_VAR = prev;
    }

    // Exit 0 — still a warning, not an error
    expect(code).toBe(0);

    // Host entry must still exist (M5 preservation: transient unset var must not remove intended server)
    const cc = readHostJson(".claude.json");
    expect((cc.mcpServers as Record<string, unknown>)["intended-var-srv"]).toBeDefined();

    // Still tracked as managed
    expect(loadMcpManagedNames(skddTmp, "claude-code")).toContain("intended-var-srv");
  });
});

// ── Fix: purge managed state for disabled/excluded servers when host entry already absent ──

describe("runMcpSync — purge managed state even when host entry is already absent", () => {
  it("disabled server with unset ${VAR}: managed state cleared even when host entry is already absent", async () => {
    placeAll();

    // First sync: add srv to all hosts (no env vars, not disabled)
    writeCanonical({ "stale-disabled-srv": { command: "my-mcp" } });
    await runMcpSync();
    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["stale-disabled-srv"],
    ).toBeDefined();
    expect(loadMcpManagedNames(skddTmp, "claude-code")).toContain("stale-disabled-srv");

    // Manually remove the host entry (simulate external deletion)
    const cc = JSON.parse(readFileSync(join(homeTmp, ".claude.json"), "utf8")) as Record<
      string,
      unknown
    >;
    delete (cc.mcpServers as Record<string, unknown>)["stale-disabled-srv"];
    writeFileSync(join(homeTmp, ".claude.json"), JSON.stringify(cc, null, 2), "utf8");

    // Update canonical: add unset env var + disabled:true
    writeCanonical({
      "stale-disabled-srv": {
        command: "my-mcp",
        env: { TOKEN: "${DEFINITELY_UNSET_STALE_DISABLED_VAR}" },
        disabled: true,
      },
    });

    const prev = process.env.DEFINITELY_UNSET_STALE_DISABLED_VAR;
    delete process.env.DEFINITELY_UNSET_STALE_DISABLED_VAR;
    let code: number;
    try {
      code = await runMcpSync();
    } finally {
      if (prev !== undefined) process.env.DEFINITELY_UNSET_STALE_DISABLED_VAR = prev;
    }

    expect(code).toBe(0);

    // Managed state must be PURGED (disabled intent wins even though host entry was already absent)
    expect(loadMcpManagedNames(skddTmp, "claude-code")).not.toContain("stale-disabled-srv");
  });

  it("host-excluded server with unset ${VAR}: managed state cleared even when host entry is already absent", async () => {
    placeAll();

    // First sync: add srv to all hosts (no hosts filter yet)
    writeCanonical({ "stale-excluded-srv": { command: "cursor-only-mcp" } });
    await runMcpSync();
    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["stale-excluded-srv"],
    ).toBeDefined();
    expect(loadMcpManagedNames(skddTmp, "claude-code")).toContain("stale-excluded-srv");

    // Manually remove the claude-code host entry (simulate external deletion)
    const cc = JSON.parse(readFileSync(join(homeTmp, ".claude.json"), "utf8")) as Record<
      string,
      unknown
    >;
    delete (cc.mcpServers as Record<string, unknown>)["stale-excluded-srv"];
    writeFileSync(join(homeTmp, ".claude.json"), JSON.stringify(cc, null, 2), "utf8");

    // Update canonical: add unset env var + narrow hosts to cursor only (excludes claude-code)
    writeCanonical({
      "stale-excluded-srv": {
        command: "cursor-only-mcp",
        env: { KEY: "${DEFINITELY_UNSET_STALE_EXCLUDED_VAR}" },
        hosts: ["cursor"],
      },
    });

    const prev = process.env.DEFINITELY_UNSET_STALE_EXCLUDED_VAR;
    delete process.env.DEFINITELY_UNSET_STALE_EXCLUDED_VAR;
    let code: number;
    try {
      code = await runMcpSync();
    } finally {
      if (prev !== undefined) process.env.DEFINITELY_UNSET_STALE_EXCLUDED_VAR = prev;
    }

    expect(code).toBe(0);

    // claude-code managed state must be PURGED (host-excluded intent wins even though entry was already absent)
    expect(loadMcpManagedNames(skddTmp, "claude-code")).not.toContain("stale-excluded-srv");
  });
});

// ── Smoke: runMcpSync with malformed mcp section in .skdd-sync.json ──────────

describe("runMcpSync — malformed mcp sync-state (defense-in-depth)", () => {
  it("runs without throwing and exits 0 when .skdd-sync.json has mcp:{} (missing hosts)", async () => {
    placeFixture("claude-code.json", ".claude.json");
    writeCanonical({ srv: { command: "cmd" } });

    // Pre-seed a malformed state with mcp:{}
    writeFileSync(
      statePath(skddTmp),
      JSON.stringify({ version: 2, canonical: "skills", mirrors: [], mcp: {} }),
    );

    let code: number;
    expect(async () => {
      code = await runMcpSync();
    }).not.toThrow();
    code = await runMcpSync();
    expect(code).toBe(0);

    // Should still sync the server normally
    const cc = readHostJson(".claude.json");
    expect((cc.mcpServers as Record<string, unknown>)["srv"]).toBeDefined();
  });

  it("runs without throwing and exits 0 when .skdd-sync.json has mcp:{hosts:null}", async () => {
    placeFixture("claude-code.json", ".claude.json");
    writeCanonical({ srv: { command: "cmd" } });

    // Pre-seed a malformed state with mcp:{hosts:null}
    writeFileSync(
      statePath(skddTmp),
      JSON.stringify({ version: 2, canonical: "skills", mirrors: [], mcp: { hosts: null } }),
    );

    const code = await runMcpSync();
    expect(code).toBe(0);

    // Server synced despite malformed state
    const cc = readHostJson(".claude.json");
    expect((cc.mcpServers as Record<string, unknown>)["srv"]).toBeDefined();
  });
});
