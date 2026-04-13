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

describe("runForge — non-interactive", () => {
  it("writes a spec-compliant SKILL.md and registers it", async () => {
    const code = await runForge("test-skill", {
      cwd: tmp,
      harness: "claude",
      fromDescription: "A test skill. Use when exercising the forge command in unit tests.",
      nonInteractive: true,
    });
    expect(code).toBe(0);

    const skillPath = join(tmp, ".claude/skills/test-skill/SKILL.md");
    expect(existsSync(skillPath)).toBe(true);

    const content = readFileSync(skillPath, "utf8");
    const parsed = matter(content);
    expect(parsed.data.name).toBe("test-skill");
    expect(parsed.data.description).toContain("Use when");
    expect(parsed.data.metadata).toBeDefined();
    expect((parsed.data.metadata as Record<string, unknown>).status).toBe("active");
  });

  it("adds the new skill to .skills-registry.md", async () => {
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
