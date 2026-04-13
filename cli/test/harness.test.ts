import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectHarness, resolveHarness, HARNESSES } from "../src/lib/harness.js";

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
