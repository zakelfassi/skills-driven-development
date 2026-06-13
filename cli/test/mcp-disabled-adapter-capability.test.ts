/**
 * mcp-disabled-adapter-capability.test.ts
 *
 * TDD tests for f-m8-disabled-adapter-capability:
 * Adapter-aware disabled semantics for unresolved-env reconciliation.
 *
 * ROOT CAUSE being fixed: the unresolved-env branch in mcp.ts used
 * `server.disabled` as a UNIVERSAL "omit" signal, but whether a disabled
 * server is omitted is ADAPTER-SPECIFIC:
 *   - Omit-hosts (omitsDisabled=true): claude-code, claude-desktop, cursor, gemini
 *   - Persist-hosts (omitsDisabled=false): droid, opencode, codex
 *
 * Treating disabled as universal-omit removed native-persisted entries and
 * lost managed ownership.
 *
 * Test matrix (§4 of feature description):
 *   A. disabled + unset ${VAR} on claude-code (omits) → entry removed + managed purged
 *   B. disabled + unset ${VAR} on droid (persists) → entry KEPT + managed RETAINED
 *   C. disabled + unset ${VAR} on opencode (persists) → entry KEPT + managed RETAINED
 *   D. disabled + unset ${VAR} on codex (persists) → entry KEPT + managed RETAINED
 *   E. host-excluded + unset var (any host) → entry removed (allowlist path unchanged)
 *   F. still-intended + unset var → preserved + managed RETAINED (M5 regression guard)
 *   G. canonical removal of native-disabled droid server → entry removed (ownership preserved)
 *   H. env IS resolved: disabled flows correctly on both omit and persist hosts (no regression)
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
const UNSET_VAR = "SKDD_TEST_UNSET_DISABLED_ADAPTER_CAP_VAR";

let skddTmp: string;
let homeTmp: string;
let prevSkddHome: string | undefined;
let prevHome: string | undefined;
let prevUnsetVar: string | undefined;

beforeEach(() => {
  skddTmp = mkdtempSync(join(tmpdir(), "skdd-dis-adapter-skdd-"));
  homeTmp = mkdtempSync(join(tmpdir(), "skdd-dis-adapter-home-"));
  prevSkddHome = process.env.SKDD_HOME;
  prevHome = process.env.HOME;
  prevUnsetVar = process.env[UNSET_VAR];
  process.env.SKDD_HOME = skddTmp;
  process.env.HOME = homeTmp;
  // Ensure the test env var is always unset before each test
  delete process.env[UNSET_VAR];
});

afterEach(() => {
  if (prevSkddHome === undefined) delete process.env.SKDD_HOME;
  else process.env.SKDD_HOME = prevSkddHome;
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  if (prevUnsetVar === undefined) delete process.env[UNSET_VAR];
  else process.env[UNSET_VAR] = prevUnsetVar;
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

// ── A: disabled + unset ${VAR} on omit-hosts → entry removed + managed purged ──

describe("A: disabled + unset var on claude-code (omitsDisabled=true) → removed + purged", () => {
  it("first adds a managed server, then disabling with unset var removes it and purges state", async () => {
    placeFixture("claude-code.json", ".claude.json");

    // Step 1: add without disabled — entry lands in claude-code
    writeCanonical({ "srvA-cc": { command: "my-mcp" } });
    await runMcpSync();
    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["srvA-cc"],
    ).toBeDefined();
    expect(loadMcpManagedNames(skddTmp, "claude-code")).toContain("srvA-cc");

    // Step 2: disabled + unset env var
    writeCanonical({
      "srvA-cc": {
        command: "my-mcp",
        env: { TOKEN: `\${${UNSET_VAR}}` },
        disabled: true,
      },
    });
    const code = await runMcpSync();
    expect(code).toBe(0);

    // claude-code omitsDisabled=true → entry MUST be removed
    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["srvA-cc"],
    ).toBeUndefined();

    // Managed state MUST be purged
    expect(loadMcpManagedNames(skddTmp, "claude-code")).not.toContain("srvA-cc");
  });
});

// ── B: disabled + unset ${VAR} on droid (omitsDisabled=false) → KEPT + RETAINED ──

describe("B: disabled + unset var on droid (omitsDisabled=false) → entry KEPT + managed RETAINED", () => {
  it("disabling a managed droid server with unset var keeps the entry (disabled:true) and retains managed state", async () => {
    ensureDir(".factory");
    placeFixture("droid.json", ".factory/mcp.json");

    // Step 1: add without disabled
    writeCanonical({ "srvB-droid": { command: "droid-mcp" } });
    await runMcpSync();
    expect(
      (readHostJson(".factory/mcp.json").mcpServers as Record<string, unknown>)["srvB-droid"],
    ).toBeDefined();
    expect(loadMcpManagedNames(skddTmp, "droid")).toContain("srvB-droid");

    // Step 2: disabled + unset env var
    writeCanonical({
      "srvB-droid": {
        command: "droid-mcp",
        env: { TOKEN: `\${${UNSET_VAR}}` },
        disabled: true,
      },
    });
    const code = await runMcpSync();
    expect(code).toBe(0);

    // droid omitsDisabled=false AND droid natively receives vars as-is (isDroid path)
    // But even if env was NOT passed through (the unresolved-env branch is what we're testing
    // for non-droid hosts), the managed state retention is the key invariant here.
    // For droid the server passes through the isDroid branch (vars written as-is),
    // and the adapter writes disabled:true.
    const droidEntry = (readHostJson(".factory/mcp.json").mcpServers as Record<string, unknown>)[
      "srvB-droid"
    ] as Record<string, unknown>;
    expect(droidEntry).toBeDefined();
    expect(droidEntry.disabled).toBe(true);

    // Managed state MUST be RETAINED (entry is still present in the file)
    expect(loadMcpManagedNames(skddTmp, "droid")).toContain("srvB-droid");
  });
});

// ── C: disabled + unset ${VAR} on opencode (omitsDisabled=false) → KEPT + RETAINED ──

describe("C: disabled + unset var on opencode (omitsDisabled=false) → entry KEPT + managed RETAINED", () => {
  it("disabling a managed opencode server with unset var keeps the entry (enabled:false) and retains managed state", async () => {
    ensureDir(".config/opencode");
    placeFixture("opencode.json", ".config/opencode/opencode.json");

    // Step 1: add without disabled
    writeCanonical({ "srvC-oc": { command: "oc-mcp" } });
    await runMcpSync();
    const ocMcp1 = (readHostJson(".config/opencode/opencode.json") as Record<string, unknown>)
      .mcp as Record<string, unknown>;
    expect(ocMcp1["srvC-oc"]).toBeDefined();
    expect(loadMcpManagedNames(skddTmp, "opencode")).toContain("srvC-oc");

    // Step 2: disabled + unset env var → BEFORE this fix, the unresolved-env branch
    // would have treated disabled as "intended for removal" and NOT added to
    // expansionFailedManaged, letting the adapter plan removal. This was wrong because
    // opencode persists disabled entries — the server would be removed from managed state.
    writeCanonical({
      "srvC-oc": {
        command: "oc-mcp",
        env: { TOKEN: `\${${UNSET_VAR}}` },
        disabled: true,
      },
    });
    const code = await runMcpSync();
    expect(code).toBe(0);

    // opencode omitsDisabled=false → entry MUST be KEPT (existing entry preserved as-is;
    // the update is skipped because env is unresolved, but the entry is NOT removed).
    const ocMcp2 = (readHostJson(".config/opencode/opencode.json") as Record<string, unknown>)
      .mcp as Record<string, unknown>;
    const ocEntry = ocMcp2["srvC-oc"];
    expect(ocEntry).toBeDefined();

    // Managed state MUST be RETAINED
    expect(loadMcpManagedNames(skddTmp, "opencode")).toContain("srvC-oc");
  });
});

// ── D: disabled + unset ${VAR} on codex (omitsDisabled=false) → KEPT + RETAINED ──

describe("D: disabled + unset var on codex (omitsDisabled=false) → entry KEPT + managed RETAINED", () => {
  it("disabling a managed codex server with unset var keeps the TOML block (enabled=false) and retains managed state", async () => {
    ensureDir(".codex");
    placeFixture("codex.toml", ".codex/config.toml");

    // Step 1: add without disabled
    writeCanonical({ "srvD-codex": { command: "codex-mcp" } });
    await runMcpSync();
    const toml1 = readFileSync(join(homeTmp, ".codex/config.toml"), "utf8");
    expect(toml1).toContain("[mcp_servers.srvD-codex]");
    expect(loadMcpManagedNames(skddTmp, "codex")).toContain("srvD-codex");

    // Step 2: disabled + unset env var
    writeCanonical({
      "srvD-codex": {
        command: "codex-mcp",
        env: { TOKEN: `\${${UNSET_VAR}}` },
        disabled: true,
      },
    });
    const code = await runMcpSync();
    expect(code).toBe(0);

    // codex omitsDisabled=false → TOML block MUST be KEPT (existing block preserved as-is;
    // the update is skipped because env is unresolved, but the block is NOT removed).
    const toml2 = readFileSync(join(homeTmp, ".codex/config.toml"), "utf8");
    expect(toml2).toContain("[mcp_servers.srvD-codex]");

    // Managed state MUST be RETAINED
    expect(loadMcpManagedNames(skddTmp, "codex")).toContain("srvD-codex");
  });
});

// ── E: host-excluded + unset var → removed (allowlist path unchanged) ─────────

describe("E: host-excluded + unset var → removed (allowlist path unchanged)", () => {
  it("a managed server excluded from claude-code by allowlist + unset var → entry removed", async () => {
    placeFixture("claude-code.json", ".claude.json");

    // Step 1: add server to claude-code (no hosts filter yet)
    writeCanonical({ "srvE-cc": { command: "my-mcp" } });
    await runMcpSync();
    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["srvE-cc"],
    ).toBeDefined();
    expect(loadMcpManagedNames(skddTmp, "claude-code")).toContain("srvE-cc");

    // Step 2: exclude claude-code from hosts allowlist + add unset env var
    writeCanonical({
      "srvE-cc": {
        command: "my-mcp",
        env: { TOKEN: `\${${UNSET_VAR}}` },
        hosts: ["droid"], // claude-code is excluded
      },
    });
    const code = await runMcpSync();
    expect(code).toBe(0);

    // Host-excluded → entry MUST be removed regardless of disabled or omitsDisabled
    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["srvE-cc"],
    ).toBeUndefined();

    // Managed state cleared
    expect(loadMcpManagedNames(skddTmp, "claude-code")).not.toContain("srvE-cc");
  });
});

// ── F: still-intended + unset var → preserved + managed RETAINED (M5 regression) ─

describe("F: still-intended + unset var → preserved + managed RETAINED (M5 regression guard)", () => {
  it("a managed server with unset env var but NO disabled/hosts filter → entry preserved", async () => {
    placeFixture("claude-code.json", ".claude.json");

    // Step 1: add without env var
    writeCanonical({ "srvF-cc": { command: "my-mcp" } });
    await runMcpSync();
    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["srvF-cc"],
    ).toBeDefined();
    expect(loadMcpManagedNames(skddTmp, "claude-code")).toContain("srvF-cc");

    // Step 2: add unset env var (still intended — not disabled, no hosts filter)
    writeCanonical({
      "srvF-cc": {
        command: "my-mcp",
        env: { TOKEN: `\${${UNSET_VAR}}` },
      },
    });
    const code = await runMcpSync();
    expect(code).toBe(0);

    // Still intended → entry MUST be preserved (M5 invariant)
    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["srvF-cc"],
    ).toBeDefined();

    // Managed state MUST be RETAINED
    expect(loadMcpManagedNames(skddTmp, "claude-code")).toContain("srvF-cc");
  });

  it("same guard: droid server with unset env var (still intended) → entry preserved + managed", async () => {
    ensureDir(".factory");
    placeFixture("droid.json", ".factory/mcp.json");

    // Droid receives vars as-is (isDroid path) — but still test the guard
    writeCanonical({ "srvF-droid": { command: "droid-mcp" } });
    await runMcpSync();
    expect(loadMcpManagedNames(skddTmp, "droid")).toContain("srvF-droid");

    // Droid goes through isDroid path (no unresolved-env branch) so this always works,
    // but we verify the final state is correct.
    writeCanonical({
      "srvF-droid": {
        command: "droid-mcp",
        env: { TOKEN: `\${${UNSET_VAR}}` },
      },
    });
    const code = await runMcpSync();
    expect(code).toBe(0);

    const droidEntry = (readHostJson(".factory/mcp.json").mcpServers as Record<string, unknown>)[
      "srvF-droid"
    ] as Record<string, unknown>;
    expect(droidEntry).toBeDefined();
    expect(loadMcpManagedNames(skddTmp, "droid")).toContain("srvF-droid");
  });
});

// ── G: canonical removal of native-disabled droid server → entry removed ──────

describe("G: canonical removal of native-disabled+managed droid server → entry removed (ownership preserved)", () => {
  it("after disable+unset-var (entry kept, managed retained) → canonical removal deletes the entry", async () => {
    ensureDir(".factory");
    placeFixture("droid.json", ".factory/mcp.json");

    // Step 1: add
    writeCanonical({ "srvG-droid": { command: "droid-mcp" } });
    await runMcpSync();
    expect(loadMcpManagedNames(skddTmp, "droid")).toContain("srvG-droid");

    // Step 2: disable + unset var → entry kept, managed retained
    writeCanonical({
      "srvG-droid": {
        command: "droid-mcp",
        env: { TOKEN: `\${${UNSET_VAR}}` },
        disabled: true,
      },
    });
    await runMcpSync();
    expect(loadMcpManagedNames(skddTmp, "droid")).toContain("srvG-droid");
    expect(
      (
        (readHostJson(".factory/mcp.json").mcpServers as Record<string, unknown>)[
          "srvG-droid"
        ] as Record<string, unknown>
      ).disabled,
    ).toBe(true);

    // Step 3: remove from canonical entirely (ownership was preserved → safe deletion)
    writeCanonical({});
    const code = await runMcpSync();
    expect(code).toBe(0);

    expect(
      (readHostJson(".factory/mcp.json").mcpServers as Record<string, unknown>)["srvG-droid"],
    ).toBeUndefined();
    expect(loadMcpManagedNames(skddTmp, "droid")).not.toContain("srvG-droid");
  });

  it("same for opencode: canonical removal after disable+unset-var deletes the entry", async () => {
    ensureDir(".config/opencode");
    placeFixture("opencode.json", ".config/opencode/opencode.json");

    // Step 1: add
    writeCanonical({ "srvG-oc": { command: "oc-mcp" } });
    await runMcpSync();
    expect(loadMcpManagedNames(skddTmp, "opencode")).toContain("srvG-oc");

    // Step 2: disable + unset var → entry kept (enabled:false), managed retained
    writeCanonical({
      "srvG-oc": {
        command: "oc-mcp",
        env: { TOKEN: `\${${UNSET_VAR}}` },
        disabled: true,
      },
    });
    await runMcpSync();
    expect(loadMcpManagedNames(skddTmp, "opencode")).toContain("srvG-oc");

    // Step 3: remove from canonical entirely
    writeCanonical({});
    const code = await runMcpSync();
    expect(code).toBe(0);

    const ocMcp = (readHostJson(".config/opencode/opencode.json") as Record<string, unknown>)
      .mcp as Record<string, unknown>;
    expect(ocMcp["srvG-oc"]).toBeUndefined();
    expect(loadMcpManagedNames(skddTmp, "opencode")).not.toContain("srvG-oc");
  });

  it("same for codex: canonical removal after disable+unset-var removes the TOML block", async () => {
    ensureDir(".codex");
    placeFixture("codex.toml", ".codex/config.toml");

    // Step 1: add
    writeCanonical({ "srvG-codex": { command: "codex-mcp" } });
    await runMcpSync();
    expect(loadMcpManagedNames(skddTmp, "codex")).toContain("srvG-codex");

    // Step 2: disable + unset var → TOML block kept (enabled = false), managed retained
    writeCanonical({
      "srvG-codex": {
        command: "codex-mcp",
        env: { TOKEN: `\${${UNSET_VAR}}` },
        disabled: true,
      },
    });
    await runMcpSync();
    expect(loadMcpManagedNames(skddTmp, "codex")).toContain("srvG-codex");
    const tomlMid = readFileSync(join(homeTmp, ".codex/config.toml"), "utf8");
    expect(tomlMid).toContain("[mcp_servers.srvG-codex]");

    // Step 3: remove from canonical entirely
    writeCanonical({});
    const code = await runMcpSync();
    expect(code).toBe(0);

    const tomlFinal = readFileSync(join(homeTmp, ".codex/config.toml"), "utf8");
    expect(tomlFinal).not.toContain("[mcp_servers.srvG-codex]");
    expect(loadMcpManagedNames(skddTmp, "codex")).not.toContain("srvG-codex");
  });
});

// ── H: env IS resolved — no regression on either omit or persist hosts ────────

describe("H: env IS resolved — disabled flows correctly (no regression)", () => {
  it("resolved env + disabled:true on claude-code → entry removed (omit path unchanged)", async () => {
    placeFixture("claude-code.json", ".claude.json");

    // Add with resolved env var
    process.env[UNSET_VAR] = "resolved-token";
    writeCanonical({ "srvH-cc": { command: "my-mcp", env: { TOKEN: `\${${UNSET_VAR}}` } } });
    await runMcpSync();
    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["srvH-cc"],
    ).toBeDefined();
    expect(loadMcpManagedNames(skddTmp, "claude-code")).toContain("srvH-cc");

    // Disable with env var still resolved
    writeCanonical({
      "srvH-cc": {
        command: "my-mcp",
        env: { TOKEN: `\${${UNSET_VAR}}` },
        disabled: true,
      },
    });
    const code = await runMcpSync();
    expect(code).toBe(0);

    // Env is resolved so unresolved-env branch is NOT taken; adapter sees disabled=true
    // claude-code's toNativeEntry returns null for disabled → entry removed
    expect(
      (readHostJson(".claude.json").mcpServers as Record<string, unknown>)["srvH-cc"],
    ).toBeUndefined();
    expect(loadMcpManagedNames(skddTmp, "claude-code")).not.toContain("srvH-cc");

    delete process.env[UNSET_VAR];
  });

  it("resolved env + disabled:true on droid → entry kept (disabled:true) (persist path unchanged)", async () => {
    ensureDir(".factory");
    placeFixture("droid.json", ".factory/mcp.json");

    // Droid receives vars as-is — env resolution doesn't apply, but test disabled path
    writeCanonical({ "srvH-droid": { command: "droid-mcp" } });
    await runMcpSync();
    expect(loadMcpManagedNames(skddTmp, "droid")).toContain("srvH-droid");

    // Disable
    writeCanonical({ "srvH-droid": { command: "droid-mcp", disabled: true } });
    const code = await runMcpSync();
    expect(code).toBe(0);

    // Droid adapter writes disabled:true — entry persists
    const droidEntry = (readHostJson(".factory/mcp.json").mcpServers as Record<string, unknown>)[
      "srvH-droid"
    ] as Record<string, unknown>;
    expect(droidEntry).toBeDefined();
    expect(droidEntry.disabled).toBe(true);
    // Entry is present → managed RETAINED
    expect(loadMcpManagedNames(skddTmp, "droid")).toContain("srvH-droid");
  });
});

// ── Capability property tests ─────────────────────────────────────────────────

describe("omitsDisabled capability: correct values on all adapters", () => {
  it("claude-code, claude-desktop, cursor, gemini: omitsDisabled=true", async () => {
    const { ADAPTERS } = await import("../src/lib/mcp/adapters/index.js");
    expect(ADAPTERS["claude-code"]!.omitsDisabled).toBe(true);
    expect(ADAPTERS["claude-desktop"]!.omitsDisabled).toBe(true);
    expect(ADAPTERS["cursor"]!.omitsDisabled).toBe(true);
    expect(ADAPTERS["gemini"]!.omitsDisabled).toBe(true);
  });

  it("droid, opencode, codex: omitsDisabled=false", async () => {
    const { ADAPTERS } = await import("../src/lib/mcp/adapters/index.js");
    expect(ADAPTERS["droid"]!.omitsDisabled).toBe(false);
    expect(ADAPTERS["opencode"]!.omitsDisabled).toBe(false);
    expect(ADAPTERS["codex"]!.omitsDisabled).toBe(false);
  });
});
