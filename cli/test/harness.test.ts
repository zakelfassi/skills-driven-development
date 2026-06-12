import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "../src/commands/init.js";
import {
  detectAllHarnesses,
  detectHarness,
  HARNESSES,
  resolveHarness,
} from "../src/lib/harness.js";

const skipOnWindows = platform() === "win32";
const runUnix = skipOnWindows ? it.skip : it;

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skdd-harness-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("droid harness profile", () => {
  it("droid is present in HARNESSES table with correct fields", () => {
    const droid = HARNESSES.droid;
    expect(droid.id).toBe("droid");
    expect(droid.label).toBe("Factory Droid");
    expect(droid.skillsDir).toBe(".factory/skills");
    expect(droid.instructionFile).toBe("AGENTS.md");
    expect(droid.instructionHint).toBeTruthy();
  });

  it("detects droid from .factory/skills/ directory", () => {
    mkdirSync(join(tmp, ".factory", "skills"), { recursive: true });
    expect(detectHarness(tmp)).toBe("droid");
  });

  it("detects droid from .factory/ directory", () => {
    mkdirSync(join(tmp, ".factory"), { recursive: true });
    expect(detectHarness(tmp)).toBe("droid");
  });

  it("detectAllHarnesses includes droid when .factory exists", () => {
    mkdirSync(join(tmp, ".factory"), { recursive: true });
    const found = detectAllHarnesses(tmp);
    expect(found).toContain("droid");
  });

  it("resolveHarness returns droid profile when explicitly requested", () => {
    const profile = resolveHarness(tmp, "droid");
    expect(profile.id).toBe("droid");
    expect(profile.skillsDir).toBe(".factory/skills");
  });
});

describe("init --harness=droid", () => {
  runUnix("creates AGENTS.md instruction file and .factory/skills symlink", async () => {
    const code = await runInit({ cwd: tmp, harness: "droid", force: false, canonical: true });
    expect(code).toBe(0);
    // Instruction file should be AGENTS.md
    expect(existsSync(join(tmp, "AGENTS.md"))).toBe(true);
    const agentsContent = readFileSync(join(tmp, "AGENTS.md"), "utf8");
    expect(agentsContent).toContain("Skills");
    // Harness mirror should be a symlink at .factory/skills
    expect(existsSync(join(tmp, ".factory", "skills"))).toBe(true);
    expect(lstatSync(join(tmp, ".factory", "skills")).isSymbolicLink()).toBe(true);
  });
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
      expect(harness.globalSkillsDir).toBeTruthy();
      expect(harness.instructionFile).toBeTruthy();
    }
  });

  it("every harness globalSkillsDir starts with ~/", () => {
    for (const harness of Object.values(HARNESSES)) {
      expect(harness.globalSkillsDir.startsWith("~/")).toBe(true);
    }
  });

  it("globalSkillsDir ends with /skills for all harnesses", () => {
    for (const harness of Object.values(HARNESSES)) {
      expect(harness.globalSkillsDir.endsWith("/skills")).toBe(true);
    }
  });
});
