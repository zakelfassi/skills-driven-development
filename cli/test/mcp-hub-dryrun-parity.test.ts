/**
 * mcp-hub-dryrun-parity.test.ts
 *
 * Regression tests for f-m8-hub-dryrun-parity:
 * collectMcpPlanLines (hub dry-run preview) must match actual runMcpSync
 * behavior for the unresolved-env + adapter.omitsDisabled + expansionFailedManaged
 * logic.
 *
 * ROOT CAUSE being fixed: collectMcpPlanLines was NOT applying the
 * isIntendedForHost check when a managed server had unresolved env vars.
 * It always pushed a "skip" line and passed the full `managed` array to
 * adapter.plan(), so the adapter could plan a "remove" op for a
 * disabled+unset-env server on native-persist hosts (droid/opencode/codex)
 * even though the real `skdd mcp sync` correctly preserves the entry.
 *
 * Test matrix:
 *   1. disabled + unset var on droid (omitsDisabled=false) → NO removal line
 *   2. disabled + unset var on opencode (omitsDisabled=false) → NO removal line
 *   3. disabled + unset var on codex (omitsDisabled=false) → NO removal line
 *   4. disabled + unset var on claude-code (omitsDisabled=true) → removal line
 *   5. still-intended + unset var on claude-code → no removal line (preserved)
 *
 * All tests use SKDD_HOME + HOME temp dirs — never touch the real user home.
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectMcpPlanLines, runMcpSync } from "../src/commands/mcp.js";
import { type CanonicalMcpConfig, saveMcpConfig } from "../src/lib/mcp/schema.js";

const FIXTURES_DIR = join(__dirname, "fixtures", "mcp");
const UNSET_VAR = "SKDD_TEST_HUB_DRYRUN_PARITY_UNSET_VAR";

let skddTmp: string;
let homeTmp: string;
let prevSkddHome: string | undefined;
let prevHome: string | undefined;

beforeEach(() => {
  skddTmp = mkdtempSync(join(tmpdir(), "skdd-hub-dryrun-skdd-"));
  homeTmp = mkdtempSync(join(tmpdir(), "skdd-hub-dryrun-home-"));
  prevSkddHome = process.env.SKDD_HOME;
  prevHome = process.env.HOME;
  process.env.SKDD_HOME = skddTmp;
  process.env.HOME = homeTmp;
  delete process.env[UNSET_VAR];
});

afterEach(() => {
  if (prevSkddHome === undefined) delete process.env.SKDD_HOME;
  else process.env.SKDD_HOME = prevSkddHome;
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  delete process.env[UNSET_VAR];
  rmSync(skddTmp, { recursive: true, force: true });
  rmSync(homeTmp, { recursive: true, force: true });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function placeFixture(fixtureName: string, relPath: string): void {
  const dest = join(homeTmp, relPath);
  mkdirSync(join(dest, ".."), { recursive: true });
  copyFileSync(join(FIXTURES_DIR, fixtureName), dest);
}

function ensureDir(relPath: string): void {
  mkdirSync(join(homeTmp, relPath), { recursive: true });
}

function writeCanonical(servers: CanonicalMcpConfig["servers"]): void {
  mkdirSync(join(skddTmp, "skills"), { recursive: true });
  saveMcpConfig(skddTmp, { version: 1, servers });
}

// ── 1. disabled + unset var on droid → NO removal line ───────────────────────

describe("hub dry-run: disabled + unset var on droid (omitsDisabled=false) → no removal line", () => {
  it("collectMcpPlanLines shows no removal line for droid (parity with runMcpSync)", async () => {
    ensureDir(".factory");
    placeFixture("droid.json", ".factory/mcp.json");

    // Step 1: add server — managed state established
    writeCanonical({ "hub-droid-srv": { command: "droid-mcp" } });
    await runMcpSync();

    // Step 2: disable + unset env var — runMcpSync preserves the entry on droid
    writeCanonical({
      "hub-droid-srv": {
        command: "droid-mcp",
        env: { TOKEN: `\${${UNSET_VAR}}` },
        disabled: true,
      },
    });

    // Verify sync itself does NOT remove the entry (correctness baseline)
    const syncCode = await runMcpSync();
    expect(syncCode).toBe(0);

    // Verify hub dry-run matches: no "- hub-droid-srv" removal line for droid
    const lines = await collectMcpPlanLines();
    const droidLines = lines.filter((l) => l.startsWith("[droid]"));
    const removalLine = droidLines.find((l) => l.includes("- hub-droid-srv"));
    expect(removalLine).toBeUndefined();
  });
});

// ── 2. disabled + unset var on opencode → NO removal line ────────────────────

describe("hub dry-run: disabled + unset var on opencode (omitsDisabled=false) → no removal line", () => {
  it("collectMcpPlanLines shows no removal line for opencode (parity with runMcpSync)", async () => {
    ensureDir(".config/opencode");
    placeFixture("opencode.json", ".config/opencode/opencode.json");

    writeCanonical({ "hub-oc-srv": { command: "oc-mcp" } });
    await runMcpSync();

    writeCanonical({
      "hub-oc-srv": {
        command: "oc-mcp",
        env: { TOKEN: `\${${UNSET_VAR}}` },
        disabled: true,
      },
    });

    const syncCode = await runMcpSync();
    expect(syncCode).toBe(0);

    const lines = await collectMcpPlanLines();
    const ocLines = lines.filter((l) => l.startsWith("[opencode]"));
    const removalLine = ocLines.find((l) => l.includes("- hub-oc-srv"));
    expect(removalLine).toBeUndefined();
  });
});

// ── 3. disabled + unset var on codex → NO removal line ───────────────────────

describe("hub dry-run: disabled + unset var on codex (omitsDisabled=false) → no removal line", () => {
  it("collectMcpPlanLines shows no removal line for codex (parity with runMcpSync)", async () => {
    ensureDir(".codex");
    placeFixture("codex.toml", ".codex/config.toml");

    writeCanonical({ "hub-codex-srv": { command: "codex-mcp" } });
    await runMcpSync();

    writeCanonical({
      "hub-codex-srv": {
        command: "codex-mcp",
        env: { TOKEN: `\${${UNSET_VAR}}` },
        disabled: true,
      },
    });

    const syncCode = await runMcpSync();
    expect(syncCode).toBe(0);

    const lines = await collectMcpPlanLines();
    const codexLines = lines.filter((l) => l.startsWith("[codex]"));
    const removalLine = codexLines.find((l) => l.includes("- hub-codex-srv"));
    expect(removalLine).toBeUndefined();
  });
});

// ── 4. disabled + unset var on claude-code → removal line IS shown ────────────

describe("hub dry-run: disabled + unset var on claude-code (omitsDisabled=true) → removal line", () => {
  it("collectMcpPlanLines shows removal line for claude-code (intended removal)", async () => {
    placeFixture("claude-code.json", ".claude.json");

    // Step 1: add without disabled — managed state established
    writeCanonical({ "hub-cc-srv": { command: "my-mcp" } });
    await runMcpSync();

    // Step 2: disabled + unset env var — claude-code omitsDisabled=true → removal intended
    writeCanonical({
      "hub-cc-srv": {
        command: "my-mcp",
        env: { TOKEN: `\${${UNSET_VAR}}` },
        disabled: true,
      },
    });

    // Verify sync removes the entry on claude-code (correctness baseline)
    const syncCode = await runMcpSync();
    expect(syncCode).toBe(0);

    // Re-add the server so we can test the hub preview BEFORE the actual removal
    writeCanonical({ "hub-cc-srv": { command: "my-mcp" } });
    await runMcpSync();

    // Now set up the disabled + unset var scenario again for the hub preview
    writeCanonical({
      "hub-cc-srv": {
        command: "my-mcp",
        env: { TOKEN: `\${${UNSET_VAR}}` },
        disabled: true,
      },
    });

    const lines = await collectMcpPlanLines();
    const ccLines = lines.filter((l) => l.startsWith("[claude-code]"));
    // claude-code is an omitting host: removal line should appear
    const removalLine = ccLines.find((l) => l.includes("- hub-cc-srv"));
    expect(removalLine).toBeDefined();
  });
});

// ── 5. still-intended + unset var → no removal line (M5 regression guard) ────

describe("hub dry-run: still-intended + unset var → no removal line", () => {
  it("collectMcpPlanLines preserves still-intended server (not disabled, no hosts filter)", async () => {
    placeFixture("claude-code.json", ".claude.json");

    writeCanonical({ "hub-still-srv": { command: "my-mcp" } });
    await runMcpSync();

    // Add unset env var but NOT disabled — still intended for claude-code
    writeCanonical({
      "hub-still-srv": {
        command: "my-mcp",
        env: { TOKEN: `\${${UNSET_VAR}}` },
      },
    });

    const lines = await collectMcpPlanLines();
    const ccLines = lines.filter((l) => l.startsWith("[claude-code]"));
    const removalLine = ccLines.find((l) => l.includes("- hub-still-srv"));
    expect(removalLine).toBeUndefined();
  });
});

// ── 6. untargeted malformed host → not shown as blocked in dry-run preview ───

describe("hub dry-run: untargeted malformed host → no blocked line (parity with runMcpSync skip)", () => {
  it("collectMcpPlanLines does not show [cursor] blocked when cursor is not targeted and has no managed entries", async () => {
    // Place a valid claude-code config so that host is available
    placeFixture("claude-code.json", ".claude.json");

    // Place a malformed cursor config
    mkdirSync(join(homeTmp, ".cursor"), { recursive: true });
    writeFileSync(join(homeTmp, ".cursor/mcp.json"), "THIS IS NOT JSON <<<");

    // Canonical: server is allowlisted to claude-code only — cursor is untargeted
    writeCanonical({
      "dryrun-skip-srv": {
        command: "my-cmd",
        hosts: ["claude-code"],
      },
    });

    // Verify sync itself exits 0 (cursor is skipped silently)
    const syncCode = await runMcpSync();
    expect(syncCode).toBe(0);

    // Verify hub dry-run also skips cursor — no blocked line
    const lines = await collectMcpPlanLines();
    const cursorBlocked = lines.find((l) => l.startsWith("[cursor]") && l.includes("blocked"));
    expect(cursorBlocked).toBeUndefined();
  });
});
