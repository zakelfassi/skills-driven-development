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

  runUnix(
    "--apply preserves harness source when canonical destination dir is occupied (not in scan)",
    async () => {
      // Harness has a valid skill named "hello"
      writeSkill(join(tmp, ".claude/skills/hello"), HELLO_SKILL);
      // Canonical destination dir already exists but contains a SKILL.md with a different
      // frontmatter name — so it won't appear as the canonical entry for "hello" during scan.
      mkdirSync(join(tmp, "skills/hello"), { recursive: true });
      writeFileSync(
        join(tmp, "skills/hello/SKILL.md"),
        `---\nname: hello-v2\ndescription: Different name.\n---\n\n# Hello V2\n`,
      );

      const code = await runImport(undefined, { cwd: tmp, apply: true, skipLink: true });
      restoreConsole();

      // Non-zero exit: there is an unresolved item requiring manual review
      expect(code).not.toBe(0);
      // Harness source MUST still exist (not deleted)
      expect(existsSync(join(tmp, ".claude/skills/hello/SKILL.md"))).toBe(true);
      // The occupied canonical dir should still have its original content
      expect(existsSync(join(tmp, "skills/hello/SKILL.md"))).toBe(true);
      // Informative message emitted
      const allLogs = logs.join("\n");
      expect(allLogs).toMatch(/destination.*already exists/);
      expect(allLogs).toMatch(/manual review/);
    },
  );

  runUnix(
    "--apply removes harness copies when skill is already in canonical (no skip-guard regression)",
    async () => {
      // Canonical already has "hello"
      writeSkill(join(tmp, "skills/hello"), HELLO_SKILL);
      // Harness also has the identical "hello" skill (duplicate copy)
      writeSkill(join(tmp, ".claude/skills/hello"), HELLO_SKILL);

      const code = await runImport(undefined, { cwd: tmp, apply: true, skipLink: true });
      restoreConsole();

      // Zero exit: already-canonical is not an error condition
      expect(code).toBe(0);
      // Canonical skill still intact
      expect(existsSync(join(tmp, "skills/hello/SKILL.md"))).toBe(true);
      // Harness copy was removed — skip guard must NOT fire when dest is held by the same-named scan entry
      expect(existsSync(join(tmp, ".claude/skills/hello"))).toBe(false);
    },
  );

  runUnix(
    "--apply mixed run: migrated skill source removed, skipped skill source preserved",
    async () => {
      // "world" is only in a harness dir, no canonical entry — will be migrated
      writeSkill(join(tmp, ".claude/skills/world"), WORLD_SKILL);
      // "hello" is only in a harness dir, but canonical dest dir exists with a different frontmatter name
      writeSkill(join(tmp, ".cursor/skills/hello"), HELLO_SKILL);
      mkdirSync(join(tmp, "skills/hello"), { recursive: true });
      writeFileSync(
        join(tmp, "skills/hello/SKILL.md"),
        `---\nname: hello-v2\ndescription: Different name.\n---\n\n# Hello V2\n`,
      );

      const code = await runImport(undefined, { cwd: tmp, apply: true, skipLink: true });
      restoreConsole();

      // Non-zero exit: one item was skipped (occupied destination)
      expect(code).not.toBe(0);
      // "world" was migrated into canonical
      expect(existsSync(join(tmp, "skills/world/SKILL.md"))).toBe(true);
      // "world" harness source was removed after successful migration
      expect(existsSync(join(tmp, ".claude/skills/world"))).toBe(false);
      // "hello" harness source was preserved (skip guard fired due to occupied dest)
      expect(existsSync(join(tmp, ".cursor/skills/hello/SKILL.md"))).toBe(true);
      // The occupied canonical dir still has its original conflicting content
      expect(existsSync(join(tmp, "skills/hello/SKILL.md"))).toBe(true);
      // Informative message emitted about the skipped item
      const allLogs = logs.join("\n");
      expect(allLogs).toMatch(/destination.*already exists/);
      expect(allLogs).toMatch(/manual review/);
    },
  );

  runUnix(
    "--apply does not delete harness source with unique payload files not in canonical",
    async () => {
      // Canonical has the skill (identical SKILL.md)
      writeSkill(join(tmp, "skills/hello"), HELLO_SKILL);
      // Harness has the same SKILL.md but ALSO has a unique extra file not in canonical
      writeSkill(join(tmp, ".claude/skills/hello"), HELLO_SKILL);
      mkdirSync(join(tmp, ".claude/skills/hello/scripts"), { recursive: true });
      writeFileSync(
        join(tmp, ".claude/skills/hello/scripts/deploy.sh"),
        "#!/bin/bash\necho deploy",
      );

      const code = await runImport(undefined, { cwd: tmp, apply: true, skipLink: true });
      restoreConsole();

      // Non-zero exit: unique payload detected, left for manual review
      expect(code).not.toBe(0);
      // Harness source MUST still exist — unique payload was not deleted
      expect(existsSync(join(tmp, ".claude/skills/hello/SKILL.md"))).toBe(true);
      expect(existsSync(join(tmp, ".claude/skills/hello/scripts/deploy.sh"))).toBe(true);
      // Canonical skill is untouched
      expect(existsSync(join(tmp, "skills/hello/SKILL.md"))).toBe(true);
      // Informative message emitted
      const allLogs = logs.join("\n");
      expect(allLogs).toMatch(/unique payload|manual review/i);
    },
  );

  runUnix(
    "--apply removes harness source when full dir is byte-identical to canonical",
    async () => {
      // Canonical has the skill with a scripts/ subdir
      writeSkill(join(tmp, "skills/hello"), HELLO_SKILL);
      mkdirSync(join(tmp, "skills/hello/scripts"), { recursive: true });
      writeFileSync(join(tmp, "skills/hello/scripts/helper.sh"), "#!/bin/bash\necho helper");
      // Harness has the EXACT same layout (byte-identical)
      writeSkill(join(tmp, ".claude/skills/hello"), HELLO_SKILL);
      mkdirSync(join(tmp, ".claude/skills/hello/scripts"), { recursive: true });
      writeFileSync(
        join(tmp, ".claude/skills/hello/scripts/helper.sh"),
        "#!/bin/bash\necho helper",
      );

      const code = await runImport(undefined, { cwd: tmp, apply: true, skipLink: true });
      restoreConsole();

      // Zero exit: true duplicate, all good
      expect(code).toBe(0);
      // Canonical is intact
      expect(existsSync(join(tmp, "skills/hello/SKILL.md"))).toBe(true);
      expect(existsSync(join(tmp, "skills/hello/scripts/helper.sh"))).toBe(true);
      // Harness copy was removed (byte-identical to canonical)
      expect(existsSync(join(tmp, ".claude/skills/hello"))).toBe(false);
    },
  );

  runUnix("--apply migrates full skill dir including scripts/ into canonical", async () => {
    // Harness has a skill with a scripts/ subdir — no canonical entry
    writeSkill(join(tmp, ".claude/skills/hello"), HELLO_SKILL);
    mkdirSync(join(tmp, ".claude/skills/hello/scripts"), { recursive: true });
    writeFileSync(join(tmp, ".claude/skills/hello/scripts/deploy.sh"), "#!/bin/bash\necho deploy");

    const code = await runImport(undefined, { cwd: tmp, apply: true, skipLink: true });
    restoreConsole();

    // Zero exit: migrated cleanly
    expect(code).toBe(0);
    // Full dir was copied into canonical
    expect(existsSync(join(tmp, "skills/hello/SKILL.md"))).toBe(true);
    expect(existsSync(join(tmp, "skills/hello/scripts/deploy.sh"))).toBe(true);
  });

  it("--canonical custom (project mode) works as before — guard does not affect project import", async () => {
    mkdirSync(join(tmp, "custom", "hello"), { recursive: true });
    writeFileSync(join(tmp, "custom", "hello", "SKILL.md"), HELLO_SKILL);
    const code = await runImport(undefined, { cwd: tmp, canonical: "custom", json: true });
    restoreConsole();
    expect(code).toBe(0);
    const payload = JSON.parse(logs[0]!);
    expect(payload.canonical).toBe("custom");
    expect(payload.totalSkills).toBe(1);
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
      // Actionable guidance message is emitted so the user knows what to do next
      const allLogs = logs.join("\n");
      expect(allLogs).toMatch(/unrecognized files/);
      expect(allLogs).toMatch(/skdd link --force/);
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
      // Actionable guidance message is emitted so the user knows what to do next
      const allLogs = logs.join("\n");
      expect(allLogs).toMatch(/unrecognized files/);
      expect(allLogs).toMatch(/skdd link -g --force/);
    },
  );

  it("import -g --canonical custom exits non-zero with clear error (global mode rejects --canonical)", async () => {
    const code = await runImport(undefined, { global: true, canonical: "custom", json: false });
    restoreConsole();
    expect(code).toBe(1);
    const allLogs = logs.join("\n");
    expect(allLogs).toMatch(/--canonical.*--global|global.*--canonical/i);
    expect(allLogs).toMatch(/~\/.skdd\/skills/);
  });

  it("import -g --canonical custom --apply exits non-zero before any FS writes (no partial colony)", async () => {
    const skddFreshHome = join(skddParent, ".skdd-fresh");
    const code = await runImport(undefined, {
      global: true,
      canonical: "custom",
      apply: true,
      json: false,
    });
    restoreConsole();
    expect(code).toBe(1);
    // Colony should NOT have been bootstrapped (no FS side-effects before the guard)
    expect(existsSync(join(skddFreshHome, "custom"))).toBe(false);
    const allLogs = logs.join("\n");
    expect(allLogs).toMatch(/--canonical.*--global|global.*--canonical/i);
  });

  it("import -g without --canonical still works normally (guard does not affect standard global import)", async () => {
    const code = await runImport(undefined, { global: true, json: true });
    restoreConsole();
    expect(code).toBe(0);
  });

  it("import -g (scan only) on a fresh SKDD_HOME bootstraps colony and returns 0", async () => {
    const skddFreshHome = join(skddParent, ".skdd-fresh");
    expect(existsSync(skddFreshHome)).toBe(false);

    const code = await runImport(undefined, { global: true, json: true });
    restoreConsole();
    expect(code).toBe(0);

    // Colony was created
    expect(existsSync(join(skddFreshHome, "skills"))).toBe(true);
  });

  runUnix(
    "import -g --apply does not delete harness source with unique payload not in canonical",
    async () => {
      const skddFreshHome = join(skddParent, ".skdd-fresh");

      // Canonical already has the skill
      mkdirSync(join(skddFreshHome, "skills", "hello"), { recursive: true });
      writeFileSync(join(skddFreshHome, "skills", "hello", "SKILL.md"), HELLO_SKILL);

      // Droid harness global dir has same SKILL.md but also a unique scripts/ file
      const droidSkillsDir = join(fakeTmp, ".factory", "skills");
      mkdirSync(join(droidSkillsDir, "hello", "scripts"), { recursive: true });
      writeFileSync(join(droidSkillsDir, "hello", "SKILL.md"), HELLO_SKILL);
      writeFileSync(join(droidSkillsDir, "hello", "scripts", "run.sh"), "#!/bin/bash\necho run");

      const code = await runImport(undefined, { global: true, apply: true, skipLink: true });
      restoreConsole();

      // Non-zero exit: unique payload detected
      expect(code).not.toBe(0);
      // Harness source MUST still exist
      expect(existsSync(join(droidSkillsDir, "hello", "SKILL.md"))).toBe(true);
      expect(existsSync(join(droidSkillsDir, "hello", "scripts", "run.sh"))).toBe(true);
      // Canonical intact
      expect(existsSync(join(skddFreshHome, "skills", "hello", "SKILL.md"))).toBe(true);
    },
  );

  runUnix(
    "import -g --apply preserves harness source when global canonical dest is occupied (not in scan)",
    async () => {
      const skddFreshHome = join(skddParent, ".skdd-fresh");
      // Pre-create canonical with a dir whose SKILL.md uses a different frontmatter name —
      // the scan will pick it up as "hello-v2", not "hello", so it won't satisfy the
      // canonical entry check for the harness "hello" skill.
      mkdirSync(join(skddFreshHome, "skills", "hello"), { recursive: true });
      writeFileSync(
        join(skddFreshHome, "skills", "hello", "SKILL.md"),
        `---\nname: hello-v2\ndescription: Different name.\n---\n\n# Hello V2\n`,
      );

      // Seed the droid harness global dir with the actual "hello" skill
      const droidGlobalDir = join(fakeTmp, ".factory", "skills", "hello");
      mkdirSync(droidGlobalDir, { recursive: true });
      writeFileSync(join(droidGlobalDir, "SKILL.md"), HELLO_SKILL);

      const code = await runImport(undefined, { global: true, apply: true, skipLink: true });
      restoreConsole();

      // Non-zero exit: unresolved item requiring manual review
      expect(code).not.toBe(0);
      // Harness source MUST still exist (not deleted)
      expect(existsSync(join(droidGlobalDir, "SKILL.md"))).toBe(true);
      // The occupied canonical dir still has its original content
      expect(existsSync(join(skddFreshHome, "skills", "hello", "SKILL.md"))).toBe(true);
      // Informative message emitted
      const allLogs = logs.join("\n");
      expect(allLogs).toMatch(/destination.*already exists/);
      expect(allLogs).toMatch(/manual review/);
    },
  );
});
