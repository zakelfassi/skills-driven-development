import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "../src/commands/init.js";
import { SKDD_HOME_ENV, skddHome } from "../src/lib/global.js";
import { loadState } from "../src/lib/sync-state.js";

const skipOnWindows = platform() === "win32";
const runUnix = skipOnWindows ? it.skip : it;

let skddTmp: string;
let fakeTmp: string;
let prevSkddHome: string | undefined;
let prevHome: string | undefined;

beforeEach(() => {
  skddTmp = mkdtempSync(join(tmpdir(), "skdd-init-global-"));
  fakeTmp = mkdtempSync(join(tmpdir(), "skdd-init-fake-home-"));
  prevSkddHome = process.env[SKDD_HOME_ENV];
  prevHome = process.env.HOME;
  process.env[SKDD_HOME_ENV] = skddTmp;
  process.env.HOME = fakeTmp;
});

afterEach(() => {
  if (prevSkddHome === undefined) {
    delete process.env[SKDD_HOME_ENV];
  } else {
    process.env[SKDD_HOME_ENV] = prevSkddHome;
  }
  if (prevHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = prevHome;
  }
  rmSync(skddTmp, { recursive: true, force: true });
  rmSync(fakeTmp, { recursive: true, force: true });
});

describe("runInit --global harness forwarding", () => {
  runUnix(
    "explicit --harness droid links droid even when ~/.factory parent dir is absent",
    async () => {
      // fakeTmp has NO .factory dir — auto-detection would skip droid entirely.
      // Explicit harness must override auto-detection.
      expect(existsSync(join(fakeTmp, ".factory"))).toBe(false);

      const code = await runInit({ global: true, harness: "droid" });
      expect(code).toBe(0);

      const droidSkillsDir = join(fakeTmp, ".factory", "skills");
      expect(existsSync(droidSkillsDir)).toBe(true);
      expect(lstatSync(droidSkillsDir).isSymbolicLink()).toBe(true);
    },
  );

  runUnix("explicit --harness claude links claude even when ~/.claude parent dir is absent", async () => {
    expect(existsSync(join(fakeTmp, ".claude"))).toBe(false);

    const code = await runInit({ global: true, harness: "claude" });
    expect(code).toBe(0);

    const claudeSkillsDir = join(fakeTmp, ".claude", "skills");
    expect(existsSync(claudeSkillsDir)).toBe(true);
    expect(lstatSync(claudeSkillsDir).isSymbolicLink()).toBe(true);
  });

  runUnix("explicit harness is recorded in state even when auto-detection would skip it", async () => {
    // No parent dirs for any harness exist
    const code = await runInit({ global: true, harness: "droid" });
    expect(code).toBe(0);

    const state = loadState(skddHome());
    expect(state).not.toBeNull();
    expect(state!.mirrors.some((m) => m.target.includes(".factory/skills"))).toBe(true);
  });

  it("global init without explicit harness runs without error (auto mode)", async () => {
    // No harness parent dirs → link step finds nothing but still returns 0
    const code = await runInit({ global: true });
    expect(code).toBe(0);
  });

  runUnix("--harness auto is treated same as no harness (auto-detection)", async () => {
    // Create .factory parent — auto-detection should find droid
    mkdirSync(join(fakeTmp, ".factory"), { recursive: true });
    const code = await runInit({ global: true, harness: "auto" });
    expect(code).toBe(0);

    const droidSkillsDir = join(fakeTmp, ".factory", "skills");
    expect(existsSync(droidSkillsDir)).toBe(true);
  });
});
