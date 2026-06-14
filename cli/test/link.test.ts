import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runLink, runUnlink } from "../src/commands/link.js";
import { emptyState, loadState, saveState } from "../src/lib/sync-state.js";

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
    expect(state!.mirrors.map((m) => m.target).sort()).toEqual([".claude/skills", ".codex/skills"]);
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

  it("managed copy-mode mirror is refreshed on re-link — new skill appears without --force", async () => {
    // First link: creates the managed copy and records it in state
    const first = await runLink({ cwd: tmp, harnesses: ["claude"], mode: "copy", quiet: true });
    expect(first).toBe(0);
    expect(existsSync(join(tmp, ".claude/skills/hello/SKILL.md"))).toBe(true);

    // Add a new skill to canonical AFTER the initial copy
    mkdirSync(join(tmp, "skills/newskill"), { recursive: true });
    writeFileSync(
      join(tmp, "skills/newskill/SKILL.md"),
      "---\nname: newskill\ndescription: New. Use when new.\n---\n\n# New Skill\n",
    );
    expect(existsSync(join(tmp, ".claude/skills/newskill/SKILL.md"))).toBe(false);

    // Re-run link without --force — the managed copy should be refreshed
    const second = await runLink({ cwd: tmp, harnesses: ["claude"], mode: "copy", quiet: true });
    expect(second).toBe(0);

    // New skill must now appear in the copy target
    expect(existsSync(join(tmp, ".claude/skills/newskill/SKILL.md"))).toBe(true);
    expect(readFileSync(join(tmp, ".claude/skills/newskill/SKILL.md"), "utf8")).toContain(
      "# New Skill",
    );
  });

  runUnix("managed copy mirror + --mode symlink --force converts to a symlink", async () => {
    // First link: create a managed copy-mode mirror
    const first = await runLink({ cwd: tmp, harnesses: ["claude"], mode: "copy", quiet: true });
    expect(first).toBe(0);
    const mirrorPath = join(tmp, ".claude/skills");
    expect(lstatSync(mirrorPath).isDirectory()).toBe(true);
    expect(lstatSync(mirrorPath).isSymbolicLink()).toBe(false);
    const stateBefore = loadState(tmp)!;
    expect(stateBefore.mirrors[0]!.mode).toBe("copy");

    // Re-run with explicit --mode symlink --force — must convert to symlink
    const second = await runLink({
      cwd: tmp,
      harnesses: ["claude"],
      mode: "symlink",
      force: true,
      quiet: true,
    });
    expect(second).toBe(0);

    // Must now be a symlink
    expect(lstatSync(mirrorPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(mirrorPath)).toBe("../skills");

    // Skill is still visible through the symlink
    expect(existsSync(join(tmp, ".claude/skills/hello/SKILL.md"))).toBe(true);

    // State records updated mode
    const stateAfter = loadState(tmp)!;
    expect(stateAfter.mirrors[0]!.mode).toBe("symlink");
  });

  it("managed copy + default/auto refresh stays a copy (M8 holds)", async () => {
    // First link: create a managed copy
    const first = await runLink({ cwd: tmp, harnesses: ["claude"], mode: "copy", quiet: true });
    expect(first).toBe(0);
    expect(lstatSync(join(tmp, ".claude/skills")).isSymbolicLink()).toBe(false);

    // Re-run without specifying a mode (default/auto)
    const second = await runLink({ cwd: tmp, harnesses: ["claude"], quiet: true });
    expect(second).toBe(0);

    // Must still be a directory (copy), not a symlink
    expect(lstatSync(join(tmp, ".claude/skills")).isSymbolicLink()).toBe(false);
    expect(lstatSync(join(tmp, ".claude/skills")).isDirectory()).toBe(true);

    // State still records copy
    const state = loadState(tmp)!;
    expect(state.mirrors[0]!.mode).toBe("copy");
  });

  runUnix(
    "unmanaged real dir + explicit --mode symlink without --force is still blocked",
    async () => {
      // Create an unmanaged real dir at the mirror path (no sync-state entry)
      mkdirSync(join(tmp, ".claude/skills/user-data"), { recursive: true });
      writeFileSync(join(tmp, ".claude/skills/user-data/important.md"), "user data");

      // State has NO entry for this mirror (unmanaged)
      saveState(tmp, emptyState("skills"));

      // Explicit --mode symlink without --force must still be blocked for unmanaged dirs
      const code = await runLink({
        cwd: tmp,
        harnesses: ["claude"],
        mode: "symlink",
        quiet: true,
      });
      expect(code).toBe(1);
      // User data preserved
      expect(readFileSync(join(tmp, ".claude/skills/user-data/important.md"), "utf8")).toBe(
        "user data",
      );
      // No state entry written for this blocked mirror
      expect(loadState(tmp)!.mirrors).toHaveLength(0);
    },
  );

  it("unmanaged real dir at copy-mode target is still blocked (not overwritten)", async () => {
    // Manually create a real directory at the mirror path without any sync-state entry
    mkdirSync(join(tmp, ".claude/skills/user-data"), { recursive: true });
    writeFileSync(join(tmp, ".claude/skills/user-data/important.md"), "user data");

    // Ensure state has NO entry for this mirror (unmanaged)
    const state = emptyState("skills");
    saveState(tmp, state);

    const code = await runLink({ cwd: tmp, harnesses: ["claude"], mode: "copy", quiet: true });
    expect(code).toBe(1);
    // User data must be preserved
    expect(readFileSync(join(tmp, ".claude/skills/user-data/important.md"), "utf8")).toBe(
      "user data",
    );
    // State must NOT record this unmanaged dir
    expect(loadState(tmp)!.mirrors).toHaveLength(0);
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

describe("runUnlink", () => {
  runUnix("unlinks a symlink mirror and clears its state entry", async () => {
    // Set up: link first (creates symlink + state entry)
    await runLink({ cwd: tmp, harnesses: ["claude"], quiet: true });
    expect(lstatSync(join(tmp, ".claude/skills")).isSymbolicLink()).toBe(true);
    expect(loadState(tmp)!.mirrors).toHaveLength(1);

    const code = await runUnlink({ cwd: tmp, harnesses: ["claude"], quiet: true });
    expect(code).toBe(0);
    expect(existsSync(join(tmp, ".claude/skills"))).toBe(false);
    expect(loadState(tmp)!.mirrors).toHaveLength(0);
  });

  it("managed copy-mode mirror → removes directory, clears state entry, returns 0", async () => {
    // Set up: link in copy mode (creates real dir + state entry with mode=copy)
    await runLink({ cwd: tmp, harnesses: ["claude"], mode: "copy", quiet: true });
    const mirrorPath = join(tmp, ".claude/skills");
    expect(lstatSync(mirrorPath).isDirectory()).toBe(true);
    expect(lstatSync(mirrorPath).isSymbolicLink()).toBe(false);
    const stateBefore = loadState(tmp)!;
    expect(stateBefore.mirrors[0]!.mode).toBe("copy");

    const code = await runUnlink({ cwd: tmp, harnesses: ["claude"], quiet: true });
    expect(code).toBe(0);
    expect(existsSync(mirrorPath)).toBe(false);
    const stateAfter = loadState(tmp)!;
    expect(stateAfter.mirrors).toHaveLength(0);
  });

  it("unmanaged drifted real dir → protected (no delete), returns 1", async () => {
    // Set up: create a real directory at the mirror path that is NOT in sync-state
    mkdirSync(join(tmp, ".claude/skills/user-data"), { recursive: true });
    writeFileSync(join(tmp, ".claude/skills/user-data/important.md"), "user data");

    // Ensure state has no entry for this mirror (unmanaged)
    const state = emptyState("skills");
    saveState(tmp, state);

    const code = await runUnlink({ cwd: tmp, harnesses: ["claude"], quiet: true });
    expect(code).toBe(1);
    // User data must be preserved
    expect(existsSync(join(tmp, ".claude/skills/user-data/important.md"))).toBe(true);
    // State entry must NOT be created/modified
    expect(loadState(tmp)!.mirrors).toHaveLength(0);
  });

  runUnix(
    "returns non-zero when unlinkSync throws (FS removal failure — e.g. EACCES)",
    async () => {
      // Set up: link first so a symlink exists at .claude/skills
      await runLink({ cwd: tmp, harnesses: ["claude"], quiet: true });
      expect(lstatSync(join(tmp, ".claude/skills")).isSymbolicLink()).toBe(true);

      // Make the parent directory read-only so unlinkSync on the symlink fails
      const parentDir = join(tmp, ".claude");
      chmodSync(parentDir, 0o555);
      let code: number;
      try {
        code = await runUnlink({ cwd: tmp, harnesses: ["claude"], quiet: true });
      } finally {
        // Restore permissions before cleanup
        chmodSync(parentDir, 0o755);
      }
      // FS removal threw → must return non-zero (was 0 before the fix)
      expect(code).toBe(1);
      // Symlink must still be present (removal failed)
      expect(existsSync(join(tmp, ".claude/skills"))).toBe(true);
    },
  );
});
