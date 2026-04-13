import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  lstatSync,
  readlinkSync,
  readFileSync,
  unlinkSync,
  symlinkSync,
} from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { runLink } from "../src/commands/link.js";
import { loadState } from "../src/lib/sync-state.js";

const skipOnWindows = platform() === "win32";
const runUnix = skipOnWindows ? it.skip : it;

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skdd-link-"));
  // Canonical skills/ with a single skill
  mkdirSync(join(tmp, "skills/hello"), { recursive: true });
  writeFileSync(
    join(tmp, "skills/hello/SKILL.md"),
    "---\nname: hello\ndescription: Hello. Use when saying hi.\n---\n\n# Hello\n",
  );
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("runLink", () => {
  it("fails loudly when skills/ does not exist", async () => {
    rmSync(join(tmp, "skills"), { recursive: true });
    const code = await runLink({ cwd: tmp, harnesses: ["claude"], quiet: true });
    expect(code).toBe(1);
  });

  runUnix("creates a symlink mirror for the requested harness", async () => {
    const code = await runLink({ cwd: tmp, harnesses: ["claude"], quiet: true });
    expect(code).toBe(0);
    expect(existsSync(join(tmp, ".claude/skills"))).toBe(true);
    expect(lstatSync(join(tmp, ".claude/skills")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(tmp, ".claude/skills"))).toBe("../skills");
    // Skill is visible through the mirror
    expect(existsSync(join(tmp, ".claude/skills/hello/SKILL.md"))).toBe(true);
  });

  runUnix("creates mirrors for multiple harnesses in one run", async () => {
    const code = await runLink({
      cwd: tmp,
      harnesses: ["claude", "codex", "cursor"],
      quiet: true,
    });
    expect(code).toBe(0);
    for (const mirror of [".claude/skills", ".codex/skills", ".cursor/skills"]) {
      expect(existsSync(join(tmp, mirror))).toBe(true);
      expect(lstatSync(join(tmp, mirror)).isSymbolicLink()).toBe(true);
    }
  });

  runUnix("writes .skdd-sync.json with one entry per mirror", async () => {
    await runLink({ cwd: tmp, harnesses: ["claude", "codex"], quiet: true });
    const state = loadState(tmp);
    expect(state).not.toBeNull();
    expect(state!.canonical).toBe("skills");
    expect(state!.mirrors).toHaveLength(2);
    expect(state!.mirrors.map((m) => m.target).sort()).toEqual([
      ".claude/skills",
      ".codex/skills",
    ]);
    expect(state!.mirrors.every((m) => m.mode === "symlink")).toBe(true);
  });

  runUnix("is idempotent — second run is a no-op", async () => {
    const first = await runLink({ cwd: tmp, harnesses: ["claude"], quiet: true });
    const second = await runLink({ cwd: tmp, harnesses: ["claude"], quiet: true });
    expect(first).toBe(0);
    expect(second).toBe(0);
    expect(lstatSync(join(tmp, ".claude/skills")).isSymbolicLink()).toBe(true);
  });

  runUnix("repairs a dangling symlink that points at the wrong place", async () => {
    await runLink({ cwd: tmp, harnesses: ["claude"], quiet: true });
    // Repoint the symlink at a bogus target (unlinkSync — don't follow into the real dir)
    unlinkSync(join(tmp, ".claude/skills"));
    mkdirSync(join(tmp, "bogus"), { recursive: true });
    symlinkSync("../bogus", join(tmp, ".claude/skills"), "dir");
    // Re-run link — should fix it
    const code = await runLink({ cwd: tmp, harnesses: ["claude"], quiet: true });
    expect(code).toBe(0);
    expect(readlinkSync(join(tmp, ".claude/skills"))).toBe("../skills");
  });

  it("copy mode works end-to-end without symlinks", async () => {
    const code = await runLink({
      cwd: tmp,
      harnesses: ["claude"],
      mode: "copy",
      quiet: true,
    });
    expect(code).toBe(0);
    const stat = lstatSync(join(tmp, ".claude/skills"));
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isDirectory()).toBe(true);
    expect(readFileSync(join(tmp, ".claude/skills/hello/SKILL.md"), "utf8")).toContain("# Hello");
    const state = loadState(tmp);
    expect(state!.mirrors[0]!.mode).toBe("copy");
  });

  runUnix("blocks when the target already has unrelated content (no --force)", async () => {
    mkdirSync(join(tmp, ".claude/skills/other"), { recursive: true });
    writeFileSync(join(tmp, ".claude/skills/other/SKILL.md"), "existing user data");
    const code = await runLink({ cwd: tmp, harnesses: ["claude"], quiet: true });
    expect(code).toBe(1);
    // Existing content must be preserved
    expect(readFileSync(join(tmp, ".claude/skills/other/SKILL.md"), "utf8")).toBe(
      "existing user data",
    );
  });

  runUnix("overwrites with --force when the target has unrelated content", async () => {
    mkdirSync(join(tmp, ".claude/skills/other"), { recursive: true });
    writeFileSync(join(tmp, ".claude/skills/other/SKILL.md"), "existing user data");
    const code = await runLink({
      cwd: tmp,
      harnesses: ["claude"],
      quiet: true,
      force: true,
    });
    expect(code).toBe(0);
    expect(lstatSync(join(tmp, ".claude/skills")).isSymbolicLink()).toBe(true);
  });
});
