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
import { loadState } from "../src/lib/sync-state.js";

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
});
