import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runImport } from "../src/commands/import.js";
import { SKDD_HOME_ENV } from "../src/lib/global.js";

const skipOnWindows = platform() === "win32";
const runUnix = skipOnWindows ? it.skip : it;

const HELLO_SKILL = `---
name: hello
description: Say hi. Use when a greeting is required.
---

# Hello

## Steps

1. Wave.
`;

const HELLO_SKILL_V2 = `---
name: hello
description: Say hi with enthusiasm. Use when a cheerful greeting is required.
---

# Hello

## Steps

1. Wave.
2. Smile.
`;

const WORLD_SKILL = `---
name: world
description: Say world. Use when the subject is global.
---

# World

## Steps

1. Bow.
`;

let tmp: string;
let logs: string[] = [];
let origLog: typeof console.log;
let origWarn: typeof console.warn;
let origError: typeof console.error;

function captureConsole() {
  logs = [];
  origLog = console.log;
  origWarn = console.warn;
  origError = console.error;
  const push = (...args: unknown[]) => {
    logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  console.log = push as typeof console.log;
  console.warn = push as typeof console.warn;
  console.error = push as typeof console.error;
}

function restoreConsole() {
  console.log = origLog;
  console.warn = origWarn;
  console.error = origError;
}

function writeSkill(dir: string, content: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content);
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skdd-import-"));
  captureConsole();
});

afterEach(() => {
  restoreConsole();
  rmSync(tmp, { recursive: true, force: true });
});

describe("runImport", () => {
  it("warns when no skill directories exist", async () => {
    const code = await runImport(undefined, { cwd: tmp, json: true });
    restoreConsole();
    expect(code).toBe(0);
    const payload = JSON.parse(logs[0]!);
    expect(payload.scanned).toHaveLength(0);
    expect(payload.totalSkills).toBe(0);
  });

  it("reports zero duplicates when only canonical skills/ has content", async () => {
    writeSkill(join(tmp, "skills/hello"), HELLO_SKILL);
    writeSkill(join(tmp, "skills/world"), WORLD_SKILL);
    const code = await runImport(undefined, { cwd: tmp, json: true });
    restoreConsole();
    expect(code).toBe(0);
    const payload = JSON.parse(logs[0]!);
    expect(payload.totalSkills).toBe(2);
    expect(payload.duplicates).toHaveLength(0);
    expect(payload.nameCollisions).toHaveLength(0);
  });

  it("detects identical skills in two harness dirs as a duplicate group", async () => {
    writeSkill(join(tmp, ".claude/skills/hello"), HELLO_SKILL);
    writeSkill(join(tmp, ".cursor/skills/hello"), HELLO_SKILL);
    const code = await runImport(undefined, { cwd: tmp, json: true });
    restoreConsole();
    expect(code).toBe(0);
    const payload = JSON.parse(logs[0]!);
    expect(payload.totalSkills).toBe(2);
    expect(payload.uniqueByHash).toBe(1);
    expect(payload.duplicates).toHaveLength(1);
    expect(payload.duplicates[0].skillName).toBe("hello");
    expect(payload.duplicates[0].entries).toHaveLength(2);
    expect(payload.nameCollisions).toHaveLength(0);
  });

  it("detects a name collision when two skills share a name but differ in content", async () => {
    writeSkill(join(tmp, ".claude/skills/hello"), HELLO_SKILL);
    writeSkill(join(tmp, ".cursor/skills/hello"), HELLO_SKILL_V2);
    const code = await runImport(undefined, { cwd: tmp, json: true });
    restoreConsole();
    expect(code).toBe(0);
    const payload = JSON.parse(logs[0]!);
    expect(payload.totalSkills).toBe(2);
    expect(payload.duplicates).toHaveLength(0);
    expect(payload.nameCollisions).toHaveLength(1);
    expect(payload.nameCollisions[0].name).toBe("hello");
    expect(payload.nameCollisions[0].variants).toHaveLength(2);
  });

  runUnix("deduplicates a symlinked harness mirror via realpath", async () => {
    writeSkill(join(tmp, "skills/hello"), HELLO_SKILL);
    mkdirSync(join(tmp, ".claude"));
    symlinkSync("../skills", join(tmp, ".claude/skills"), "dir");
    const code = await runImport(undefined, { cwd: tmp, json: true });
    restoreConsole();
    expect(code).toBe(0);
    const payload = JSON.parse(logs[0]!);
    // The symlinked .claude/skills should NOT be counted separately — realpath dedup
    expect(payload.totalSkills).toBe(1);
    expect(payload.duplicates).toHaveLength(0);
    // Only the canonical scan shows up
    expect(payload.scanned).toHaveLength(1);
    expect(payload.scanned[0].origin).toBe("canonical");
  });

  it("honors canonicalSkillsDir from .colony.json", async () => {
    writeFileSync(
      join(tmp, ".colony.json"),
      JSON.stringify({ canonicalSkillsDir: "playbooks", name: "t", version: "0.0.1" }),
    );
    writeSkill(join(tmp, "playbooks/hello"), HELLO_SKILL);
    const code = await runImport(undefined, { cwd: tmp, json: true });
    restoreConsole();
    expect(code).toBe(0);
    const payload = JSON.parse(logs[0]!);
    expect(payload.canonical).toBe("playbooks");
    expect(payload.totalSkills).toBe(1);
  });

  runUnix("--apply consolidates a duplicate group into canonical and runs link", async () => {
    writeSkill(join(tmp, ".claude/skills/hello"), HELLO_SKILL);
    writeSkill(join(tmp, ".cursor/skills/hello"), HELLO_SKILL);
    // Pre-create canonical as empty so link has something to work with afterwards
    // (we actually rely on --apply to create it, so skip the mkdir)
    const code = await runImport(undefined, { cwd: tmp, json: true, apply: true });
    restoreConsole();
    expect(code).toBe(0);
    // Canonical now exists with the skill
    expect(existsSync(join(tmp, "skills/hello/SKILL.md"))).toBe(true);
    // Harness copies are gone as real directories (replaced by symlinks after runLink)
    const claudeMirror = lstatSync(join(tmp, ".claude/skills"));
    expect(claudeMirror.isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(tmp, ".claude/skills"))).toBe("../skills");
    const cursorMirror = lstatSync(join(tmp, ".cursor/skills"));
    expect(cursorMirror.isSymbolicLink()).toBe(true);
  });

  runUnix("--apply migrates a single-source harness skill into canonical", async () => {
    writeSkill(join(tmp, ".claude/skills/world"), WORLD_SKILL);
    const code = await runImport(undefined, { cwd: tmp, json: true, apply: true });
    restoreConsole();
    expect(code).toBe(0);
    expect(existsSync(join(tmp, "skills/world/SKILL.md"))).toBe(true);
    const mirror = lstatSync(join(tmp, ".claude/skills"));
    expect(mirror.isSymbolicLink()).toBe(true);
  });

  it("--apply refuses to run when name collisions exist", async () => {
    writeSkill(join(tmp, ".claude/skills/hello"), HELLO_SKILL);
    writeSkill(join(tmp, ".cursor/skills/hello"), HELLO_SKILL_V2);
    const code = await runImport(undefined, { cwd: tmp, json: true, apply: true });
    restoreConsole();
    expect(code).toBe(1);
    // Neither copy should have been touched
    expect(existsSync(join(tmp, ".claude/skills/hello/SKILL.md"))).toBe(true);
    expect(existsSync(join(tmp, ".cursor/skills/hello/SKILL.md"))).toBe(true);
  });

  it("errors when the target directory does not exist", async () => {
    const code = await runImport("does-not-exist", { cwd: tmp, json: true });
    restoreConsole();
    expect(code).toBe(1);
  });

  runUnix(
    "--apply with leftover unrecognized harness content: valid skills consolidated, unrecognized files preserved, link blocked",
    async () => {
      // Valid skill that will be consolidated into canonical
      writeSkill(join(tmp, ".claude/skills/hello"), HELLO_SKILL);
      // Unrecognized top-level file inside the harness skills dir
      writeFileSync(join(tmp, ".claude/skills/readme.txt"), "my notes");
      // Malformed skill dir: has SKILL.md but no frontmatter name — import leaves it
      mkdirSync(join(tmp, ".claude/skills/no-name"), { recursive: true });
      writeFileSync(
        join(tmp, ".claude/skills/no-name/SKILL.md"),
        "# No frontmatter name\n\nContent.",
      );

      const code = await runImport(undefined, { cwd: tmp, apply: true });
      restoreConsole();

      // Link was blocked because harness dir still had content — non-zero exit
      expect(code).toBe(1);
      // Valid skill IS in canonical (data was not lost)
      expect(existsSync(join(tmp, "skills/hello/SKILL.md"))).toBe(true);
      // Unrecognized content was NOT deleted
      expect(existsSync(join(tmp, ".claude/skills/readme.txt"))).toBe(true);
      expect(existsSync(join(tmp, ".claude/skills/no-name/SKILL.md"))).toBe(true);
    },
  );
});

describe("runImport — global mode colony bootstrap", () => {
  let skddParent: string;
  let fakeTmp: string;
  let prevSkddHome: string | undefined;
  let prevHome: string | undefined;

  beforeEach(() => {
    skddParent = mkdtempSync(join(tmpdir(), "skdd-import-global-"));
    fakeTmp = mkdtempSync(join(tmpdir(), "skdd-import-fake-home-"));
    prevSkddHome = process.env[SKDD_HOME_ENV];
    prevHome = process.env.HOME;
    // Point SKDD_HOME at a subdirectory that does NOT exist yet
    process.env[SKDD_HOME_ENV] = join(skddParent, ".skdd-fresh");
    process.env.HOME = fakeTmp;
    captureConsole();
  });

  afterEach(() => {
    restoreConsole();
    if (prevSkddHome === undefined) delete process.env[SKDD_HOME_ENV];
    else process.env[SKDD_HOME_ENV] = prevSkddHome;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(skddParent, { recursive: true, force: true });
    rmSync(fakeTmp, { recursive: true, force: true });
  });

  it("import -g exits early with error when SKDD_HOME does not exist (non-global target missing)", async () => {
    // Baseline: without global flag, missing target still returns 1
    const skddFreshHome = join(skddParent, ".skdd-fresh");
    expect(existsSync(skddFreshHome)).toBe(false);
    const code = await runImport(skddFreshHome, { cwd: skddParent, json: true });
    restoreConsole();
    expect(code).toBe(1);
  });

  runUnix(
    "import -g --apply on a fresh SKDD_HOME bootstraps colony and consolidates harness-global skills",
    async () => {
      const skddFreshHome = join(skddParent, ".skdd-fresh");
      expect(existsSync(skddFreshHome)).toBe(false);

      // Seed a skill in the droid harness global dir (~/.factory/skills)
      const droidGlobalDir = join(fakeTmp, ".factory", "skills", "hello");
      mkdirSync(droidGlobalDir, { recursive: true });
      writeFileSync(join(droidGlobalDir, "SKILL.md"), HELLO_SKILL);

      const code = await runImport(undefined, { global: true, apply: true, skipLink: false });
      restoreConsole();
      expect(code).toBe(0);

      // Colony was bootstrapped
      expect(existsSync(join(skddFreshHome, "skills"))).toBe(true);
      // hello skill consolidated into canonical
      expect(existsSync(join(skddFreshHome, "skills", "hello", "SKILL.md"))).toBe(true);
    },
  );

  runUnix(
    "import -g --apply with leftover unrecognized harness content: valid skills consolidated, unrecognized files preserved, link blocked",
    async () => {
      const skddFreshHome = join(skddParent, ".skdd-fresh");
      expect(existsSync(skddFreshHome)).toBe(false);

      // Valid skill in the droid harness global dir
      const droidSkillsDir = join(fakeTmp, ".factory", "skills");
      mkdirSync(join(droidSkillsDir, "hello"), { recursive: true });
      writeFileSync(join(droidSkillsDir, "hello", "SKILL.md"), HELLO_SKILL);
      // Unrecognized top-level file in the same harness skills dir
      writeFileSync(join(droidSkillsDir, "extra.txt"), "do not delete me");
      // Malformed skill dir (no frontmatter name) — import leaves it behind
      mkdirSync(join(droidSkillsDir, "no-name"), { recursive: true });
      writeFileSync(join(droidSkillsDir, "no-name", "SKILL.md"), "# No frontmatter name");

      const code = await runImport(undefined, { global: true, apply: true });
      restoreConsole();

      // Link was blocked — non-zero exit
      expect(code).toBe(1);
      // Valid skill IS in canonical
      expect(existsSync(join(skddFreshHome, "skills", "hello", "SKILL.md"))).toBe(true);
      // Unrecognized content was NOT deleted
      expect(existsSync(join(droidSkillsDir, "extra.txt"))).toBe(true);
      expect(existsSync(join(droidSkillsDir, "no-name", "SKILL.md"))).toBe(true);
    },
  );

  it("import -g (scan only) on a fresh SKDD_HOME bootstraps colony and returns 0", async () => {
    const skddFreshHome = join(skddParent, ".skdd-fresh");
    expect(existsSync(skddFreshHome)).toBe(false);

    const code = await runImport(undefined, { global: true, json: true });
    restoreConsole();
    expect(code).toBe(0);

    // Colony was created
    expect(existsSync(join(skddFreshHome, "skills"))).toBe(true);
  });
});
