import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  lstatSync,
  readlinkSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { ensureMirror, resolveLinkMode } from "../src/lib/fs-link.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skdd-fs-link-"));
  // Canonical dir with one skill so we have something to mirror
  mkdirSync(join(tmp, "skills/demo"), { recursive: true });
  writeFileSync(join(tmp, "skills/demo/SKILL.md"), "---\nname: demo\ndescription: d. Use when.\n---\n\n# Demo\n");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("resolveLinkMode", () => {
  it("resolves 'symlink' passthrough", () => {
    expect(resolveLinkMode("symlink")).toBe("symlink");
  });
  it("resolves 'copy' passthrough", () => {
    expect(resolveLinkMode("copy")).toBe("copy");
  });
  it("resolves 'auto' based on platform", () => {
    const expected = platform() === "win32" ? "copy" : "symlink";
    expect(resolveLinkMode("auto")).toBe(expected);
  });
  it("resolves undefined as auto", () => {
    const expected = platform() === "win32" ? "copy" : "symlink";
    expect(resolveLinkMode(undefined)).toBe(expected);
  });
});

describe("ensureMirror — symlink mode", () => {
  const skipOnWindows = platform() === "win32";
  const run = skipOnWindows ? it.skip : it;

  run("creates a symlink to the canonical dir when target is absent", () => {
    const result = ensureMirror(join(tmp, "skills"), join(tmp, ".claude/skills"), "symlink");
    expect(result.action).toBe("created");
    expect(result.mode).toBe("symlink");
    const link = lstatSync(join(tmp, ".claude/skills"));
    expect(link.isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(tmp, ".claude/skills"))).toBe("../skills");
    // The skill should be visible through the symlink
    expect(existsSync(join(tmp, ".claude/skills/demo/SKILL.md"))).toBe(true);
  });

  run("is idempotent — re-running reports unchanged", () => {
    ensureMirror(join(tmp, "skills"), join(tmp, ".claude/skills"), "symlink");
    const second = ensureMirror(join(tmp, "skills"), join(tmp, ".claude/skills"), "symlink");
    expect(second.action).toBe("unchanged");
    expect(second.driftDetected).toBe(false);
  });

  run("repairs a symlink that points at the wrong target", () => {
    mkdirSync(join(tmp, "wrong"), { recursive: true });
    mkdirSync(join(tmp, ".claude"), { recursive: true });
    symlinkSync("../wrong", join(tmp, ".claude/skills"), "dir");
    const result = ensureMirror(join(tmp, "skills"), join(tmp, ".claude/skills"), "symlink");
    expect(result.action).toBe("repaired");
    expect(result.driftDetected).toBe(true);
    expect(readlinkSync(join(tmp, ".claude/skills"))).toBe("../skills");
  });

  run("refuses to clobber a non-empty directory without --force", () => {
    mkdirSync(join(tmp, ".claude/skills/orphan"), { recursive: true });
    writeFileSync(join(tmp, ".claude/skills/orphan/SKILL.md"), "existing content");
    const result = ensureMirror(join(tmp, "skills"), join(tmp, ".claude/skills"), "symlink");
    expect(result.action).toBe("blocked");
    expect(result.driftDetected).toBe(true);
    // File should still be there
    expect(readFileSync(join(tmp, ".claude/skills/orphan/SKILL.md"), "utf8")).toBe("existing content");
  });

  run("replaces a non-empty directory when --force is passed", () => {
    mkdirSync(join(tmp, ".claude/skills/orphan"), { recursive: true });
    writeFileSync(join(tmp, ".claude/skills/orphan/SKILL.md"), "existing content");
    const result = ensureMirror(join(tmp, "skills"), join(tmp, ".claude/skills"), "symlink", {
      force: true,
    });
    expect(result.action).toBe("repaired");
    const link = lstatSync(join(tmp, ".claude/skills"));
    expect(link.isSymbolicLink()).toBe(true);
  });
});

describe("ensureMirror — copy mode", () => {
  it("recursively copies the canonical dir when target is absent", () => {
    const result = ensureMirror(join(tmp, "skills"), join(tmp, ".claude/skills"), "copy");
    expect(result.action).toBe("created");
    expect(result.mode).toBe("copy");
    // The target should NOT be a symlink
    const stat = lstatSync(join(tmp, ".claude/skills"));
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isDirectory()).toBe(true);
    expect(readFileSync(join(tmp, ".claude/skills/demo/SKILL.md"), "utf8")).toContain("# Demo");
  });

  it("refuses to overwrite a pre-existing directory without --force", () => {
    mkdirSync(join(tmp, ".claude/skills/other"), { recursive: true });
    writeFileSync(join(tmp, ".claude/skills/other/SKILL.md"), "keep me");
    const result = ensureMirror(join(tmp, "skills"), join(tmp, ".claude/skills"), "copy");
    expect(result.action).toBe("blocked");
    expect(readFileSync(join(tmp, ".claude/skills/other/SKILL.md"), "utf8")).toBe("keep me");
  });

  it("overwrites a pre-existing directory with --force", () => {
    mkdirSync(join(tmp, ".claude/skills/other"), { recursive: true });
    writeFileSync(join(tmp, ".claude/skills/other/SKILL.md"), "keep me");
    const result = ensureMirror(join(tmp, "skills"), join(tmp, ".claude/skills"), "copy", {
      force: true,
    });
    expect(result.action).toBe("repaired");
    // Original "other" should be gone
    expect(existsSync(join(tmp, ".claude/skills/other"))).toBe(false);
    // demo should be present
    expect(existsSync(join(tmp, ".claude/skills/demo/SKILL.md"))).toBe(true);
  });
});

describe("ensureMirror — blocked on missing source", () => {
  it("reports blocked when canonical is absent", () => {
    const result = ensureMirror(join(tmp, "does-not-exist"), join(tmp, ".claude/skills"), "copy");
    expect(result.action).toBe("blocked");
    expect(result.reason).toContain("source does not exist");
  });
});
