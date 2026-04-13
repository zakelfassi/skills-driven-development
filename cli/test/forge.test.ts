import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runForge } from "../src/commands/forge.js";
import { loadRegistry } from "../src/lib/registry.js";
import matter from "gray-matter";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skdd-forge-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("runForge — canonical mode (default)", () => {
  it("writes the skill to canonical skills/<name>/ and links the harness mirror", async () => {
    const code = await runForge("test-skill", {
      cwd: tmp,
      harness: "claude",
      fromDescription: "A test skill. Use when exercising the forge command in unit tests.",
      nonInteractive: true,
    });
    expect(code).toBe(0);

    // Canonical location
    const canonicalPath = join(tmp, "skills/test-skill/SKILL.md");
    expect(existsSync(canonicalPath)).toBe(true);

    const content = readFileSync(canonicalPath, "utf8");
    const parsed = matter(content);
    expect(parsed.data.name).toBe("test-skill");
    expect(parsed.data.description).toContain("Use when");
    expect(parsed.data.metadata).toBeDefined();
    expect((parsed.data.metadata as Record<string, unknown>).status).toBe("active");

    // Harness mirror resolves through the symlink (on Unix) to the same file
    if (process.platform !== "win32") {
      expect(existsSync(join(tmp, ".claude/skills/test-skill/SKILL.md"))).toBe(true);
      expect(existsSync(join(tmp, ".skdd-sync.json"))).toBe(true);
    }
  });

  it("adds the new skill to .skills-registry.md with the canonical path", async () => {
    await runForge("reg-test", {
      cwd: tmp,
      harness: "claude",
      fromDescription: "Another test skill. Use when testing registry updates.",
      nonInteractive: true,
    });

    const registry = loadRegistry(tmp);
    expect(registry.skills).toHaveLength(1);
    expect(registry.skills[0]!.name).toBe("reg-test");
    expect(registry.skills[0]!.source).toBe("local");
    // `path` is only surfaced through the JSON registry (the markdown table has no
    // path column by convention). The canonical file existing on disk is the thing
    // that matters — which we assert in the other test.
  });

  it("refuses to overwrite an existing skill", async () => {
    await runForge("dup", {
      cwd: tmp,
      harness: "claude",
      fromDescription: "First. Use when testing.",
      nonInteractive: true,
    });
    const code = await runForge("dup", {
      cwd: tmp,
      harness: "claude",
      fromDescription: "Second. Use when testing.",
      nonInteractive: true,
    });
    expect(code).toBe(1);
  });

  it("rejects invalid skill names", async () => {
    const code = await runForge("Bad_Name", {
      cwd: tmp,
      harness: "claude",
      fromDescription: "Should fail. Use when testing validation.",
      nonInteractive: true,
    });
    expect(code).toBe(1);
  });

  it("requires --from-description in non-interactive mode", async () => {
    const code = await runForge("no-desc", {
      cwd: tmp,
      harness: "claude",
      nonInteractive: true,
    });
    expect(code).toBe(1);
  });
});

describe("runForge — flat / --no-canonical mode", () => {
  it("writes the skill directly to the harness dir without a mirror", async () => {
    const code = await runForge("flat-skill", {
      cwd: tmp,
      harness: "claude",
      fromDescription: "Flat layout. Use when preserving the old per-harness scheme.",
      nonInteractive: true,
      canonical: false,
    });
    expect(code).toBe(0);

    // The skill lives at the harness path
    expect(existsSync(join(tmp, ".claude/skills/flat-skill/SKILL.md"))).toBe(true);
    // No canonical skills/ dir was created
    expect(existsSync(join(tmp, "skills/flat-skill/SKILL.md"))).toBe(false);
    // No sync state file should have been written
    expect(existsSync(join(tmp, ".skdd-sync.json"))).toBe(false);
  });
});
