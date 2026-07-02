import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runLink } from "../src/commands/link.js";
import { adoptSkills } from "../src/lib/fs-link.js";

const skipOnWindows = platform() === "win32";
const runUnix = skipOnWindows ? it.skip : it;

let tmp: string;
let logs: string[] = [];
let origLog: typeof console.log;
let origWarn: typeof console.warn;
let origError: typeof console.error;

function capture() {
  logs = [];
  origLog = console.log;
  origWarn = console.warn;
  origError = console.error;
  const push = (...a: unknown[]) =>
    logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  console.log = push as typeof console.log;
  console.warn = push as typeof console.warn;
  console.error = push as typeof console.error;
}
function restore() {
  console.log = origLog;
  console.warn = origWarn;
  console.error = origError;
}

function writeSkill(dir: string, name: string, body: string) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(
    join(dir, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} skill. Use when testing.\n---\n${body}\n`,
  );
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skdd-adopt-"));
  capture();
});
afterEach(() => {
  restore();
  rmSync(tmp, { recursive: true, force: true });
});

describe("adoptSkills", () => {
  it("creates colony skills in an empty target and leaves foreign skills untouched", () => {
    const canonical = join(tmp, "canonical");
    writeSkill(canonical, "alpha", "a");
    writeSkill(canonical, "beta", "b");
    const target = join(tmp, "target");
    writeSkill(target, "foreign", "hand-authored, not in colony");

    const results = adoptSkills(canonical, target);
    restore();
    expect(
      results
        .filter((r) => r.action === "created")
        .map((r) => r.skill)
        .sort(),
    ).toEqual(["alpha", "beta"]);
    expect(existsSync(join(target, "alpha/SKILL.md"))).toBe(true);
    // Foreign skill is untouched.
    expect(readFileSync(join(target, "foreign/SKILL.md"), "utf8")).toContain("hand-authored");
  });

  it("reports unchanged for a byte-identical skill", () => {
    const canonical = join(tmp, "canonical");
    writeSkill(canonical, "alpha", "a");
    const target = join(tmp, "target");
    writeSkill(target, "alpha", "a"); // identical
    const results = adoptSkills(canonical, target);
    restore();
    expect(results).toEqual([{ skill: "alpha", action: "unchanged" }]);
  });

  it("keeps a divergent colony skill without --force (skipped-divergent)", () => {
    const canonical = join(tmp, "canonical");
    writeSkill(canonical, "alpha", "canonical body");
    const target = join(tmp, "target");
    writeSkill(target, "alpha", "LOCAL FORK — do not clobber");
    const results = adoptSkills(canonical, target);
    restore();
    expect(results).toEqual([{ skill: "alpha", action: "skipped-divergent" }]);
    expect(readFileSync(join(target, "alpha/SKILL.md"), "utf8")).toContain("LOCAL FORK");
  });

  it("never overwrites a divergent same-named target skill (no clobber)", () => {
    // A same-named skill in the target may be an independent fork, not a drifted
    // colony copy — adopt must not destroy it. There is no force-overwrite path.
    const canonical = join(tmp, "canonical");
    writeSkill(canonical, "alpha", "canonical body");
    const target = join(tmp, "target");
    writeSkill(target, "alpha", "INDEPENDENT FORK — must survive");
    const results = adoptSkills(canonical, target);
    restore();
    expect(results).toEqual([{ skill: "alpha", action: "skipped-divergent" }]);
    expect(readFileSync(join(target, "alpha/SKILL.md"), "utf8")).toContain("INDEPENDENT FORK");
  });
});

describe("runLink --adopt (project)", () => {
  runUnix(
    "adopts colony skills into a populated harness dir, preserving foreign skills",
    async () => {
      // canonical skills/
      writeSkill(join(tmp, "skills"), "alpha", "a");
      writeSkill(join(tmp, "skills"), "beta", "b");
      // a populated real .claude/skills with a non-colony skill
      writeSkill(join(tmp, ".claude/skills"), "handmade", "keep me");

      const code = await runLink({ cwd: tmp, harnesses: ["claude"], adopt: true, quiet: true });
      restore();
      expect(code).toBe(0);
      // colony skills copied in
      expect(existsSync(join(tmp, ".claude/skills/alpha/SKILL.md"))).toBe(true);
      expect(existsSync(join(tmp, ".claude/skills/beta/SKILL.md"))).toBe(true);
      // .claude/skills is STILL a real dir (not replaced by a symlink) and foreign skill survives
      expect(existsSync(join(tmp, ".claude/skills/handmade/SKILL.md"))).toBe(true);
      // no sync-state written for adopt (it's not a tracked mirror)
      expect(existsSync(join(tmp, ".skdd-sync.json"))).toBe(false);
    },
  );

  runUnix("does not clobber a divergent target skill even with --force", async () => {
    writeSkill(join(tmp, "skills"), "alpha", "canonical body");
    writeSkill(join(tmp, ".claude/skills"), "alpha", "HARNESS FORK — keep");
    const code = await runLink({
      cwd: tmp,
      harnesses: ["claude"],
      adopt: true,
      force: true,
      quiet: true,
    });
    restore();
    expect(code).toBe(0);
    expect(readFileSync(join(tmp, ".claude/skills/alpha/SKILL.md"), "utf8")).toContain(
      "HARNESS FORK",
    );
  });

  runUnix("skips a dir already symlinked to the colony", async () => {
    writeSkill(join(tmp, "skills"), "alpha", "a");
    mkdirSync(join(tmp, ".claude"), { recursive: true });
    symlinkSync(join(tmp, "skills"), join(tmp, ".claude/skills"));
    const code = await runLink({ cwd: tmp, harnesses: ["claude"], adopt: true, quiet: false });
    restore();
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("already a colony symlink");
  });
});
