import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectHarness, detectAllHarnesses, resolveHarness, HARNESSES } from "../src/lib/harness.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skdd-harness-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("detectHarness", () => {
  it("returns null when no markers exist", () => {
    expect(detectHarness(tmp)).toBeNull();
  });

  it("detects claude from CLAUDE.md", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "# Project");
    expect(detectHarness(tmp)).toBe("claude");
  });

  it("detects claude from .claude/skills/ directory", () => {
    mkdirSync(join(tmp, ".claude", "skills"), { recursive: true });
    expect(detectHarness(tmp)).toBe("claude");
  });

  it("detects cursor from .cursor/", () => {
    mkdirSync(join(tmp, ".cursor"), { recursive: true });
    expect(detectHarness(tmp)).toBe("cursor");
  });

  it("detects copilot from .github/copilot-instructions.md", () => {
    mkdirSync(join(tmp, ".github"), { recursive: true });
    writeFileSync(join(tmp, ".github", "copilot-instructions.md"), "# Copilot");
    expect(detectHarness(tmp)).toBe("copilot");
  });

  it("prefers claude when multiple markers exist", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "# Project");
    mkdirSync(join(tmp, ".cursor"), { recursive: true });
    // claude is checked first in the detection order
    expect(detectHarness(tmp)).toBe("claude");
  });
});

describe("detectAllHarnesses", () => {
  it("returns empty array when no markers exist", () => {
    expect(detectAllHarnesses(tmp)).toEqual([]);
  });

  it("returns a single harness when only one marker exists", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "# Project");
    expect(detectAllHarnesses(tmp)).toEqual(["claude"]);
  });

  it("returns every harness whose markers are present", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "# Project");
    mkdirSync(join(tmp, ".cursor"), { recursive: true });
    mkdirSync(join(tmp, ".codex"), { recursive: true });
    const found = detectAllHarnesses(tmp);
    expect(found).toContain("claude");
    expect(found).toContain("cursor");
    expect(found).toContain("codex");
    expect(found).toHaveLength(3);
  });

  it("returns harnesses in a stable, deterministic order", () => {
    mkdirSync(join(tmp, ".amp"), { recursive: true });
    mkdirSync(join(tmp, ".claude"), { recursive: true });
    mkdirSync(join(tmp, ".cursor"), { recursive: true });
    const found = detectAllHarnesses(tmp);
    // claude comes before cursor comes before amp in the check order
    expect(found.indexOf("claude")).toBeLessThan(found.indexOf("cursor"));
    expect(found.indexOf("cursor")).toBeLessThan(found.indexOf("amp"));
  });
});

describe("resolveHarness", () => {
  it("returns the explicitly requested harness", () => {
    const profile = resolveHarness(tmp, "codex");
    expect(profile.id).toBe("codex");
    expect(profile.skillsDir).toBe(".codex/skills");
  });

  it("falls back to detected harness on auto", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "# Project");
    const profile = resolveHarness(tmp, "auto");
    expect(profile.id).toBe("claude");
  });

  it("defaults to claude when nothing detected and auto requested", () => {
    const profile = resolveHarness(tmp, "auto");
    expect(profile.id).toBe("claude");
  });

  it("every harness has required profile fields", () => {
    for (const harness of Object.values(HARNESSES)) {
      expect(harness.id).toBeTruthy();
      expect(harness.label).toBeTruthy();
      expect(harness.skillsDir).toBeTruthy();
      expect(harness.instructionFile).toBeTruthy();
    }
  });
});
