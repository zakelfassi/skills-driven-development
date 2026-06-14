/**
 * mcp-disabled-state.test.ts
 *
 * TDD tests for the disabled-state precision fix (f-m8-disabled-state-precision).
 *
 * Background:
 * - Hosts that OMIT disabled entries (claude-code, cursor, gemini, claude-desktop):
 *   adapter removes the entry → managed state should be PURGED.
 * - Hosts that NATIVELY PERSIST disabled entries (droid, opencode, codex):
 *   adapter keeps the entry → managed state should be RETAINED so ownership is
 *   preserved for a later canonical removal.
 *
 * The right discriminator is what the adapter ACTUALLY DID (present vs absent in
 * the host config after sync), NOT the disabled flag alone.
 *
 * All tests use SKDD_HOME + HOME temp dirs — never touch the real user home.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMcpSync } from "../src/commands/mcp.js";
import { type CanonicalMcpConfig, saveMcpConfig } from "../src/lib/mcp/schema.js";
import { loadMcpManagedNames } from "../src/lib/mcp/state.js";

const FIXTURES_DIR = join(__dirname, "fixtures", "mcp");

let skddTmp: string;
let homeTmp: string;
let prevSkddHome: string | undefined;
let prevHome: string | undefined;

beforeEach(() => {
  skddTmp = mkdtempSync(join(tmpdir(), "skdd-disabled-state-skdd-"));
  homeTmp = mkdtempSync(join(tmpdir(), "skdd-disabled-state-home-"));
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

function writeCanonical(servers: CanonicalMcpConfig["servers"]): void {
  mkdirSync(join(skddTmp, "skills"), { recursive: true });
  saveMcpConfig(skddTmp, { version: 1, servers });
}

function readHostJson(relPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(homeTmp, relPath), "utf8")) as Record<string, unknown>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runMcpSync — disabled server: host-omit hosts purge managed state", () => {
  it("claude-code: disabling a previously-managed server removes the entry and purges managed state", async () => {
    // Set up claude-code host
    placeFixture("claude-code.json", ".claude.json");

    // First sync: add the server (enabled)
    writeCanonical({ "dis-cc-srv": { command: "some-mcp" } });
    await runMcpSync();

    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["dis-cc-srv"],
    ).toBeDefined();
    expect(loadMcpManagedNames(skddTmp, "claude-code")).toContain("dis-cc-srv");

    // Second sync: disable the server
    writeCanonical({ "dis-cc-srv": { command: "some-mcp", disabled: true } });
    const code = await runMcpSync();
    expect(code).toBe(0);

    // claude-code does NOT have a native disabled flag → removes the entry
    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["dis-cc-srv"],
    ).toBeUndefined();

    // Managed state must be PURGED (entry is absent from host)
    expect(loadMcpManagedNames(skddTmp, "claude-code")).not.toContain("dis-cc-srv");
  });

  it("cursor: disabling a previously-managed server removes the entry and purges managed state", async () => {
    ensureDir(".cursor");
    placeFixture("cursor.json", ".cursor/mcp.json");

    writeCanonical({ "dis-cursor-srv": { command: "some-mcp" } });
    await runMcpSync();

    expect(
      (readHostJson(".cursor/mcp.json").mcpServers as Record<string, unknown>)["dis-cursor-srv"],
    ).toBeDefined();
    expect(loadMcpManagedNames(skddTmp, "cursor")).toContain("dis-cursor-srv");

    writeCanonical({ "dis-cursor-srv": { command: "some-mcp", disabled: true } });
    const code = await runMcpSync();
    expect(code).toBe(0);

    expect(
      (readHostJson(".cursor/mcp.json").mcpServers as Record<string, unknown>)["dis-cursor-srv"],
    ).toBeUndefined();
    expect(loadMcpManagedNames(skddTmp, "cursor")).not.toContain("dis-cursor-srv");
  });
});

describe("runMcpSync — disabled server: native-persist hosts RETAIN managed state", () => {
  it("droid: disabling a managed server keeps the entry (disabled:true) and RETAINS managed state", async () => {
    ensureDir(".factory");
    placeFixture("droid.json", ".factory/mcp.json");

    // First sync: add the server (enabled)
    writeCanonical({ "dis-droid-srv": { command: "droid-mcp" } });
    await runMcpSync();

    expect(
      (readHostJson(".factory/mcp.json").mcpServers as Record<string, unknown>)["dis-droid-srv"],
    ).toBeDefined();
    expect(loadMcpManagedNames(skddTmp, "droid")).toContain("dis-droid-srv");

    // Second sync: disable the server
    writeCanonical({ "dis-droid-srv": { command: "droid-mcp", disabled: true } });
    const code = await runMcpSync();
    expect(code).toBe(0);

    // Droid natively persists disabled:true — entry STAYS in the file
    const droidEntry = (readHostJson(".factory/mcp.json").mcpServers as Record<string, unknown>)[
      "dis-droid-srv"
    ] as Record<string, unknown>;
    expect(droidEntry).toBeDefined();
    expect(droidEntry.disabled).toBe(true);

    // Managed state must be RETAINED (entry is still present in host)
    expect(loadMcpManagedNames(skddTmp, "droid")).toContain("dis-droid-srv");
  });

  it("opencode: disabling a managed server keeps the entry (enabled:false) and RETAINS managed state", async () => {
    ensureDir(".config/opencode");
    placeFixture("opencode.json", ".config/opencode/opencode.json");

    // First sync: add the server (enabled)
    writeCanonical({ "dis-oc-srv": { command: "opencode-mcp" } });
    await runMcpSync();

    const ocMcp = (readHostJson(".config/opencode/opencode.json") as Record<string, unknown>)
      .mcp as Record<string, unknown>;
    expect(ocMcp["dis-oc-srv"]).toBeDefined();
    expect(loadMcpManagedNames(skddTmp, "opencode")).toContain("dis-oc-srv");

    // Second sync: disable the server
    writeCanonical({ "dis-oc-srv": { command: "opencode-mcp", disabled: true } });
    const code = await runMcpSync();
    expect(code).toBe(0);

    // OpenCode natively maps disabled → enabled:false — entry STAYS in the file
    const ocMcp2 = (readHostJson(".config/opencode/opencode.json") as Record<string, unknown>)
      .mcp as Record<string, unknown>;
    const ocEntry = ocMcp2["dis-oc-srv"] as Record<string, unknown>;
    expect(ocEntry).toBeDefined();
    expect(ocEntry.enabled).toBe(false);

    // Managed state must be RETAINED (entry is still present in host)
    expect(loadMcpManagedNames(skddTmp, "opencode")).toContain("dis-oc-srv");
  });

  it("codex: disabling a managed server keeps the TOML block (enabled=false) and RETAINS managed state", async () => {
    ensureDir(".codex");
    placeFixture("codex.toml", ".codex/config.toml");

    // First sync: add the server (enabled)
    writeCanonical({ "dis-codex-srv": { command: "codex-mcp" } });
    await runMcpSync();

    const tomlAfterAdd = readFileSync(join(homeTmp, ".codex/config.toml"), "utf8");
    expect(tomlAfterAdd).toContain("[mcp_servers.dis-codex-srv]");
    expect(loadMcpManagedNames(skddTmp, "codex")).toContain("dis-codex-srv");

    // Second sync: disable the server
    writeCanonical({ "dis-codex-srv": { command: "codex-mcp", disabled: true } });
    const code = await runMcpSync();
    expect(code).toBe(0);

    // Codex natively maps disabled:true → enabled = false — TOML block STAYS
    const tomlAfterDisable = readFileSync(join(homeTmp, ".codex/config.toml"), "utf8");
    expect(tomlAfterDisable).toContain("[mcp_servers.dis-codex-srv]");
    expect(tomlAfterDisable).toContain("enabled = false");

    // Managed state must be RETAINED (entry is still present in host)
    expect(loadMcpManagedNames(skddTmp, "codex")).toContain("dis-codex-srv");
  });
});

describe("runMcpSync — ownership preserved: canonical removal of native-disabled server", () => {
  it("droid: removing a disabled+managed server from canonical deletes the host entry (ownership preserved)", async () => {
    ensureDir(".factory");
    placeFixture("droid.json", ".factory/mcp.json");

    // Step 1: add server
    writeCanonical({ "owned-droid-srv": { command: "droid-mcp" } });
    await runMcpSync();
    expect(loadMcpManagedNames(skddTmp, "droid")).toContain("owned-droid-srv");

    // Step 2: disable server — entry stays in droid, managed state RETAINED
    writeCanonical({ "owned-droid-srv": { command: "droid-mcp", disabled: true } });
    await runMcpSync();
    expect(loadMcpManagedNames(skddTmp, "droid")).toContain("owned-droid-srv");
    expect(
      (
        (readHostJson(".factory/mcp.json").mcpServers as Record<string, unknown>)[
          "owned-droid-srv"
        ] as Record<string, unknown>
      ).disabled,
    ).toBe(true);

    // Step 3: remove server from canonical entirely (skdd mcp remove)
    writeCanonical({});
    const code = await runMcpSync();
    expect(code).toBe(0);

    // Host entry must be REMOVED (ownership was preserved → safe deletion)
    expect(
      (readHostJson(".factory/mcp.json").mcpServers as Record<string, unknown>)["owned-droid-srv"],
    ).toBeUndefined();

    // Managed state cleared
    expect(loadMcpManagedNames(skddTmp, "droid")).not.toContain("owned-droid-srv");
  });

  it("opencode: removing a disabled+managed server from canonical deletes the host entry (ownership preserved)", async () => {
    ensureDir(".config/opencode");
    placeFixture("opencode.json", ".config/opencode/opencode.json");

    // Step 1: add server
    writeCanonical({ "owned-oc-srv": { command: "oc-mcp" } });
    await runMcpSync();
    expect(loadMcpManagedNames(skddTmp, "opencode")).toContain("owned-oc-srv");

    // Step 2: disable server — entry stays in opencode (enabled:false), managed RETAINED
    writeCanonical({ "owned-oc-srv": { command: "oc-mcp", disabled: true } });
    await runMcpSync();
    expect(loadMcpManagedNames(skddTmp, "opencode")).toContain("owned-oc-srv");

    // Step 3: remove server from canonical entirely
    writeCanonical({});
    const code = await runMcpSync();
    expect(code).toBe(0);

    // Host entry must be REMOVED
    const ocMcp = (readHostJson(".config/opencode/opencode.json") as Record<string, unknown>)
      .mcp as Record<string, unknown>;
    expect(ocMcp["owned-oc-srv"]).toBeUndefined();

    // Managed state cleared
    expect(loadMcpManagedNames(skddTmp, "opencode")).not.toContain("owned-oc-srv");
  });

  it("codex: removing a disabled+managed server from canonical deletes the TOML block (ownership preserved)", async () => {
    ensureDir(".codex");
    placeFixture("codex.toml", ".codex/config.toml");

    // Step 1: add server
    writeCanonical({ "owned-codex-srv": { command: "codex-mcp" } });
    await runMcpSync();
    expect(loadMcpManagedNames(skddTmp, "codex")).toContain("owned-codex-srv");

    // Step 2: disable server — TOML block stays (enabled = false), managed RETAINED
    writeCanonical({ "owned-codex-srv": { command: "codex-mcp", disabled: true } });
    await runMcpSync();
    expect(loadMcpManagedNames(skddTmp, "codex")).toContain("owned-codex-srv");

    // Step 3: remove server from canonical entirely
    writeCanonical({});
    const code = await runMcpSync();
    expect(code).toBe(0);

    // TOML block must be REMOVED (ownership was preserved → safe deletion)
    const tomlAfterRemove = readFileSync(join(homeTmp, ".codex/config.toml"), "utf8");
    expect(tomlAfterRemove).not.toContain("[mcp_servers.owned-codex-srv]");

    // Managed state cleared
    expect(loadMcpManagedNames(skddTmp, "codex")).not.toContain("owned-codex-srv");
  });
});

describe("runMcpSync — M8-A1 regression: disabled+already-absent → managed purged (host-omit hosts)", () => {
  it("claude-code: disabled+absent → managed purged (so future same-name entry is not clobbered)", async () => {
    placeFixture("claude-code.json", ".claude.json");

    // First sync: server added to claude-code
    writeCanonical({ "future-name-srv": { command: "some-mcp" } });
    await runMcpSync();
    expect(loadMcpManagedNames(skddTmp, "claude-code")).toContain("future-name-srv");

    // Simulate: host entry externally removed (e.g. user cleaned it up manually)
    const cc = JSON.parse(readFileSync(join(homeTmp, ".claude.json"), "utf8")) as Record<
      string,
      unknown
    >;
    delete (cc.mcpServers as Record<string, unknown>)["future-name-srv"];
    writeFileSync(join(homeTmp, ".claude.json"), JSON.stringify(cc, null, 2), "utf8");

    // Canonical: disable the server (not remove, just disable)
    writeCanonical({ "future-name-srv": { command: "some-mcp", disabled: true } });
    const code = await runMcpSync();
    expect(code).toBe(0);

    // Managed state must be PURGED (entry was already absent before sync, adapter omits it)
    expect(loadMcpManagedNames(skddTmp, "claude-code")).not.toContain("future-name-srv");
  });

  it("cursor: disabled+absent → managed purged", async () => {
    ensureDir(".cursor");
    placeFixture("cursor.json", ".cursor/mcp.json");

    writeCanonical({ "future-cursor-srv": { command: "cursor-mcp" } });
    await runMcpSync();
    expect(loadMcpManagedNames(skddTmp, "cursor")).toContain("future-cursor-srv");

    // Externally remove the host entry
    const cursorCfg = JSON.parse(readFileSync(join(homeTmp, ".cursor/mcp.json"), "utf8")) as Record<
      string,
      unknown
    >;
    delete (cursorCfg.mcpServers as Record<string, unknown>)["future-cursor-srv"];
    writeFileSync(join(homeTmp, ".cursor/mcp.json"), JSON.stringify(cursorCfg, null, 2), "utf8");

    // Disable in canonical
    writeCanonical({ "future-cursor-srv": { command: "cursor-mcp", disabled: true } });
    const code = await runMcpSync();
    expect(code).toBe(0);

    // Managed state must be PURGED
    expect(loadMcpManagedNames(skddTmp, "cursor")).not.toContain("future-cursor-srv");
  });
});

describe("runMcpSync — existing M5/M8 regression guards still pass", () => {
  it("M5: managed server with unset ${VAR} still intended for host → preserved, still managed", async () => {
    placeFixture("claude-code.json", ".claude.json");

    // First sync: add server without env vars
    writeCanonical({ "preserved-srv": { command: "my-mcp" } });
    await runMcpSync();
    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["preserved-srv"],
    ).toBeDefined();
    expect(loadMcpManagedNames(skddTmp, "claude-code")).toContain("preserved-srv");

    // Update canonical: add unset env var, no disabled/hosts filter (still intended)
    writeCanonical({
      "preserved-srv": { command: "my-mcp", env: { TOKEN: "${DEFINITELY_UNSET_M5_REG_VAR}" } },
    });

    const prev = process.env.DEFINITELY_UNSET_M5_REG_VAR;
    delete process.env.DEFINITELY_UNSET_M5_REG_VAR;
    let code: number;
    try {
      code = await runMcpSync();
    } finally {
      if (prev !== undefined) process.env.DEFINITELY_UNSET_M5_REG_VAR = prev;
    }

    expect(code).toBe(0);

    // Entry must still exist (M5 preservation)
    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["preserved-srv"],
    ).toBeDefined();

    // Still managed
    expect(loadMcpManagedNames(skddTmp, "claude-code")).toContain("preserved-srv");
  });

  it("M8-removal-ordering: managed server with unset ${VAR} AND disabled:true → host entry removed", async () => {
    placeFixture("claude-code.json", ".claude.json");

    // First sync: add server without env vars
    writeCanonical({ "disabled-unset-srv": { command: "my-mcp" } });
    await runMcpSync();
    expect(loadMcpManagedNames(skddTmp, "claude-code")).toContain("disabled-unset-srv");

    // Update canonical: add unset env var + disabled:true
    writeCanonical({
      "disabled-unset-srv": {
        command: "my-mcp",
        env: { TOKEN: "${DEFINITELY_UNSET_M8_ORD_VAR}" },
        disabled: true,
      },
    });

    const prev = process.env.DEFINITELY_UNSET_M8_ORD_VAR;
    delete process.env.DEFINITELY_UNSET_M8_ORD_VAR;
    let code: number;
    try {
      code = await runMcpSync();
    } finally {
      if (prev !== undefined) process.env.DEFINITELY_UNSET_M8_ORD_VAR = prev;
    }

    expect(code).toBe(0);

    // Entry must be REMOVED (disabled intent wins over unset var preservation)
    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["disabled-unset-srv"],
    ).toBeUndefined();

    // Managed state cleared
    expect(loadMcpManagedNames(skddTmp, "claude-code")).not.toContain("disabled-unset-srv");
  });
});
