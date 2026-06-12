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
});
