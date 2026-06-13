/**
 * mcp-sync-dryrun-no-sideeffect.test.ts
 *
 * Verifies the dry-run contract: `mcp sync --dry-run` on a fresh machine
 * (SKDD_HOME does not exist yet) must exit 0, return a preview, and create
 * NO files or directories under SKDD_HOME.
 *
 * Non-dry-run must still bootstrap the global colony as before.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectMcpPlanLines, runMcpSync } from "../src/commands/mcp.js";
import { SKDD_HOME_ENV } from "../src/lib/global.js";

let parentTmp: string; // the parent temp dir we DO create
let skddHome: string; // the SKDD_HOME path — a subdir we do NOT create
let homeTmp: string; // fake HOME to prevent adapter.available() from finding real host configs
let prevSkddHome: string | undefined;
let prevHome: string | undefined;

beforeEach(() => {
  parentTmp = mkdtempSync(join(tmpdir(), "skdd-dryrun-nosideeffect-"));
  skddHome = join(parentTmp, "skdd"); // intentionally NOT created
  homeTmp = mkdtempSync(join(tmpdir(), "skdd-dryrun-fakehome-"));
  prevSkddHome = process.env[SKDD_HOME_ENV];
  prevHome = process.env.HOME;
  process.env[SKDD_HOME_ENV] = skddHome;
  process.env.HOME = homeTmp;
});

afterEach(() => {
  if (prevSkddHome === undefined) delete process.env[SKDD_HOME_ENV];
  else process.env[SKDD_HOME_ENV] = prevSkddHome;
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  rmSync(parentTmp, { recursive: true, force: true });
  rmSync(homeTmp, { recursive: true, force: true });
});

describe("mcp sync --dry-run on a fresh machine (SKDD_HOME absent)", () => {
  it("exits 0 and creates no files or directories under SKDD_HOME", async () => {
    expect(existsSync(skddHome)).toBe(false);

    const code = await runMcpSync({ dryRun: true });

    expect(code).toBe(0);
    // The SKDD_HOME directory must not have been created
    expect(existsSync(skddHome)).toBe(false);
  });

  it("returns a non-empty preview (no servers message) without writing anything", async () => {
    expect(existsSync(skddHome)).toBe(false);

    const lines = await collectMcpPlanLines();

    expect(lines.length).toBeGreaterThan(0);
    // Expected: "No MCP servers configured." since canonical is absent
    expect(lines.some((l) => l.toLowerCase().includes("no mcp servers"))).toBe(true);
    // Still no files created
    expect(existsSync(skddHome)).toBe(false);
  });

  it("collectMcpPlanLines creates no files or directories under SKDD_HOME", async () => {
    expect(existsSync(skddHome)).toBe(false);

    await collectMcpPlanLines();

    expect(existsSync(skddHome)).toBe(false);
  });
});

describe("mcp sync (non-dry-run) on a fresh machine still bootstraps colony", () => {
  it("creates SKDD_HOME/skills and .skills-registry.md on first non-dry-run sync", async () => {
    expect(existsSync(skddHome)).toBe(false);

    const code = await runMcpSync();

    expect(code).toBe(0);
    // Colony must have been bootstrapped
    expect(existsSync(join(skddHome, "skills"))).toBe(true);
    expect(existsSync(join(skddHome, ".skills-registry.md"))).toBe(true);
  });
});
