import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runLink } from "../src/commands/link.js";
import { SKDD_HOME_ENV, skddHome } from "../src/lib/global.js";
import { loadState } from "../src/lib/sync-state.js";

const skipOnWindows = platform() === "win32";
const runUnix = skipOnWindows ? it.skip : it;

let skddTmp: string;
let fakeTmp: string;
let prevSkddHome: string | undefined;
let prevHome: string | undefined;

beforeEach(() => {
  skddTmp = mkdtempSync(join(tmpdir(), "skdd-global-home-"));
  fakeTmp = mkdtempSync(join(tmpdir(), "skdd-fake-home-"));
  prevSkddHome = process.env[SKDD_HOME_ENV];
  prevHome = process.env.HOME;
  process.env[SKDD_HOME_ENV] = skddTmp;
  process.env.HOME = fakeTmp;

  // Create the canonical global skills dir with a test skill
  mkdirSync(join(skddTmp, "skills", "test-skill"), { recursive: true });
  writeFileSync(
    join(skddTmp, "skills", "test-skill", "SKILL.md"),
    "---\nname: test-skill\ndescription: Test. Use when testing.\n---\n\n# Test\n",
  );
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

describe("runLink --global", () => {
  runUnix("fails when global skills dir does not exist", async () => {
    rmSync(join(skddTmp, "skills"), { recursive: true });
    const code = await runLink({ global: true, harnesses: ["claude"], quiet: true });
    expect(code).toBe(1);
  });

  runUnix("creates symlink at harness global dir (explicit harness)", async () => {
    // Create the parent dir for droid harness (~/.factory/)
    mkdirSync(join(fakeTmp, ".factory"), { recursive: true });
    const code = await runLink({ global: true, harnesses: ["droid"], quiet: true });
    expect(code).toBe(0);
    const droidSkillsDir = join(fakeTmp, ".factory", "skills");
    expect(existsSync(droidSkillsDir)).toBe(true);
    expect(lstatSync(droidSkillsDir).isSymbolicLink()).toBe(true);
    // Skill is visible through the mirror
    expect(existsSync(join(droidSkillsDir, "test-skill", "SKILL.md"))).toBe(true);
  });

  runUnix("writes state under skddHome() with absolute mirror targets", async () => {
    mkdirSync(join(fakeTmp, ".factory"), { recursive: true });
    mkdirSync(join(fakeTmp, ".claude"), { recursive: true });
    const code = await runLink({ global: true, harnesses: ["droid", "claude"], quiet: true });
    expect(code).toBe(0);

    const state = loadState(skddTmp);
    expect(state).not.toBeNull();
    // Mirror targets should be absolute paths (not relative)
    for (const mirror of state!.mirrors) {
      expect(mirror.target.startsWith("/")).toBe(true);
    }
    const targets = state!.mirrors.map((m) => m.target);
    expect(targets.some((t) => t.includes(".factory/skills"))).toBe(true);
    expect(targets.some((t) => t.includes(".claude/skills"))).toBe(true);
  });

  runUnix("state file is at skddHome()/.skdd-sync.json", async () => {
    mkdirSync(join(fakeTmp, ".claude"), { recursive: true });
    await runLink({ global: true, harnesses: ["claude"], quiet: true });
    expect(existsSync(join(skddTmp, ".skdd-sync.json"))).toBe(true);
  });

  runUnix("is idempotent — second run returns unchanged", async () => {
    mkdirSync(join(fakeTmp, ".claude"), { recursive: true });
    const first = await runLink({ global: true, harnesses: ["claude"], quiet: true });
    const second = await runLink({ global: true, harnesses: ["claude"], quiet: true });
    expect(first).toBe(0);
    expect(second).toBe(0);
    expect(lstatSync(join(fakeTmp, ".claude", "skills")).isSymbolicLink()).toBe(true);
  });

  runUnix("blocks a populated global dir without --force (safety)", async () => {
    mkdirSync(join(fakeTmp, ".claude", "skills", "existing-skill"), { recursive: true });
    writeFileSync(join(fakeTmp, ".claude", "skills", "existing-skill", "SKILL.md"), "user data");
    const code = await runLink({ global: true, harnesses: ["claude"], quiet: true });
    expect(code).toBe(1);
    // User data preserved
    expect(
      readFileSync(join(fakeTmp, ".claude", "skills", "existing-skill", "SKILL.md"), "utf8"),
    ).toBe("user data");
  });

  runUnix("--force overrides blocked populated dir", async () => {
    mkdirSync(join(fakeTmp, ".claude", "skills", "existing-skill"), { recursive: true });
    writeFileSync(join(fakeTmp, ".claude", "skills", "existing-skill", "SKILL.md"), "user data");
    const code = await runLink({ global: true, harnesses: ["claude"], force: true, quiet: true });
    expect(code).toBe(0);
    expect(lstatSync(join(fakeTmp, ".claude", "skills")).isSymbolicLink()).toBe(true);
  });

  it("auto-detects harnesses by global parent dir existence", async () => {
    // Only create the .factory parent — only droid should be detected
    mkdirSync(join(fakeTmp, ".factory"), { recursive: true });
    const code = await runLink({ global: true, quiet: true });
    expect(code).toBe(0);
    const state = loadState(skddTmp);
    expect(state).not.toBeNull();
    expect(state!.mirrors.some((m) => m.target.includes(".factory/skills"))).toBe(true);
    // claude NOT in state because ~/.claude was not created
    expect(state!.mirrors.some((m) => m.target.includes(".claude/skills"))).toBe(false);
  });

  // ── Regression: managed copy-mode global mirror must stay copy on re-run with default mode ──

  runUnix(
    "managed copy-mode global mirror: re-run with default mode (auto) stays a copy, not a symlink",
    async () => {
      mkdirSync(join(fakeTmp, ".factory"), { recursive: true });

      // First link: create a copy-mode global mirror
      const code1 = await runLink({
        global: true,
        harnesses: ["droid"],
        mode: "copy",
        quiet: true,
      });
      expect(code1).toBe(0);
      const droidSkillsDir = join(fakeTmp, ".factory", "skills");
      expect(lstatSync(droidSkillsDir).isSymbolicLink()).toBe(false);
      expect(lstatSync(droidSkillsDir).isDirectory()).toBe(true);

      // Add a new skill to canonical AFTER the initial copy
      mkdirSync(join(skddTmp, "skills", "new-skill"), { recursive: true });
      writeFileSync(
        join(skddTmp, "skills", "new-skill", "SKILL.md"),
        "---\nname: new-skill\ndescription: New. Use when new.\n---\n\n# New Skill\n",
      );
      expect(existsSync(join(droidSkillsDir, "new-skill", "SKILL.md"))).toBe(false);

      // Re-run with default mode (auto) — must stay copy, not become symlink
      const code2 = await runLink({ global: true, harnesses: ["droid"], quiet: true });
      expect(code2).toBe(0);

      // Must still be a directory (copy), not a symlink
      expect(lstatSync(droidSkillsDir).isSymbolicLink()).toBe(false);
      expect(lstatSync(droidSkillsDir).isDirectory()).toBe(true);

      // New skill must be visible (copy was refreshed)
      expect(existsSync(join(droidSkillsDir, "new-skill", "SKILL.md"))).toBe(true);
      expect(readFileSync(join(droidSkillsDir, "new-skill", "SKILL.md"), "utf8")).toContain(
        "# New Skill",
      );

      // State still records mode: copy
      const state = loadState(skddTmp);
      const mirrorEntry = state!.mirrors.find((m) => m.target.includes(".factory/skills"));
      expect(mirrorEntry?.mode).toBe("copy");
    },
  );

  runUnix(
    "managed copy global mirror + explicit --mode symlink --force converts to symlink",
    async () => {
      mkdirSync(join(fakeTmp, ".factory"), { recursive: true });

      // First: create a copy-mode global mirror
      const code1 = await runLink({
        global: true,
        harnesses: ["droid"],
        mode: "copy",
        quiet: true,
      });
      expect(code1).toBe(0);
      const droidSkillsDir = join(fakeTmp, ".factory", "skills");
      expect(lstatSync(droidSkillsDir).isDirectory()).toBe(true);
      expect(lstatSync(droidSkillsDir).isSymbolicLink()).toBe(false);

      // Re-run with explicit --mode symlink --force — must convert to symlink
      const code2 = await runLink({
        global: true,
        harnesses: ["droid"],
        mode: "symlink",
        force: true,
        quiet: true,
      });
      expect(code2).toBe(0);

      // Must now be a symlink
      expect(lstatSync(droidSkillsDir).isSymbolicLink()).toBe(true);
      // Skill is still visible
      expect(existsSync(join(droidSkillsDir, "test-skill", "SKILL.md"))).toBe(true);

      // State updated to symlink mode
      const state = loadState(skddTmp);
      const mirrorEntry = state!.mirrors.find((m) => m.target.includes(".factory/skills"));
      expect(mirrorEntry?.mode).toBe("symlink");
    },
  );

  runUnix("managed copy global mirror + default/auto refresh stays a copy (M8 holds)", async () => {
    mkdirSync(join(fakeTmp, ".factory"), { recursive: true });

    // Create a copy-mode global mirror
    const code1 = await runLink({
      global: true,
      harnesses: ["droid"],
      mode: "copy",
      quiet: true,
    });
    expect(code1).toBe(0);
    const droidSkillsDir = join(fakeTmp, ".factory", "skills");
    expect(lstatSync(droidSkillsDir).isDirectory()).toBe(true);

    // Re-run without specifying mode — must remain a copy
    const code2 = await runLink({ global: true, harnesses: ["droid"], quiet: true });
    expect(code2).toBe(0);

    expect(lstatSync(droidSkillsDir).isSymbolicLink()).toBe(false);
    expect(lstatSync(droidSkillsDir).isDirectory()).toBe(true);

    const state = loadState(skddTmp);
    const mirrorEntry = state!.mirrors.find((m) => m.target.includes(".factory/skills"));
    expect(mirrorEntry?.mode).toBe("copy");
  });

  runUnix(
    "forge -g simulation: explicit mode:auto on recorded copy mirror keeps copy mode",
    async () => {
      mkdirSync(join(fakeTmp, ".factory"), { recursive: true });

      // First: create a copy-mode global mirror
      const code1 = await runLink({
        global: true,
        harnesses: ["droid"],
        mode: "copy",
        quiet: true,
      });
      expect(code1).toBe(0);
      const droidSkillsDir = join(fakeTmp, ".factory", "skills");
      expect(lstatSync(droidSkillsDir).isDirectory()).toBe(true);
      expect(lstatSync(droidSkillsDir).isSymbolicLink()).toBe(false);

      // Simulate what forge -g does: add a skill to canonical, then refresh with mode:"auto"
      mkdirSync(join(skddTmp, "skills", "forged-skill"), { recursive: true });
      writeFileSync(
        join(skddTmp, "skills", "forged-skill", "SKILL.md"),
        "---\nname: forged-skill\ndescription: Forged. Use when forging.\n---\n\n# Forged Skill\n",
      );

      const code2 = await runLink({
        global: true,
        harnesses: ["droid"],
        mode: "auto",
        quiet: true,
      });
      expect(code2).toBe(0);

      // Copy must remain a copy
      expect(lstatSync(droidSkillsDir).isSymbolicLink()).toBe(false);
      expect(lstatSync(droidSkillsDir).isDirectory()).toBe(true);

      // Forged skill must be visible (refresh happened)
      expect(existsSync(join(droidSkillsDir, "forged-skill", "SKILL.md"))).toBe(true);
    },
  );
});
