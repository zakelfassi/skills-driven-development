import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureGlobalColony,
  globalSkillsDir,
  resolveColonyRoot,
  SKDD_HOME_ENV,
  skddHome,
} from "../src/lib/global.js";
import { HARNESSES } from "../src/lib/harness.js";

let skddTmp: string;
let prevSkddHome: string | undefined;

beforeEach(() => {
  skddTmp = mkdtempSync(join(tmpdir(), "skdd-global-"));
  prevSkddHome = process.env[SKDD_HOME_ENV];
  process.env[SKDD_HOME_ENV] = skddTmp;
});

afterEach(() => {
  if (prevSkddHome === undefined) {
    delete process.env[SKDD_HOME_ENV];
  } else {
    process.env[SKDD_HOME_ENV] = prevSkddHome;
  }
  rmSync(skddTmp, { recursive: true, force: true });
});

describe("skddHome()", () => {
  it("returns the SKDD_HOME env value when set", () => {
    expect(skddHome()).toBe(skddTmp);
  });

  it("returns a resolved absolute path", () => {
    expect(skddHome()).toBe(skddTmp);
    expect(skddHome().startsWith("/")).toBe(true);
  });
});

describe("resolveColonyRoot()", () => {
  it("returns project scope with cwd when global is not set", () => {
    const result = resolveColonyRoot({ cwd: skddTmp });
    expect(result.scope).toBe("project");
    expect(result.root).toBe(skddTmp);
  });

  it("returns global scope with skddHome() when global is true", () => {
    const result = resolveColonyRoot({ global: true });
    expect(result.scope).toBe("global");
    expect(result.root).toBe(skddTmp);
  });

  it("global mode calls ensureGlobalColony, creating skills/ dir", () => {
    expect(existsSync(join(skddTmp, "skills"))).toBe(false);
    resolveColonyRoot({ global: true });
    expect(existsSync(join(skddTmp, "skills"))).toBe(true);
  });
});

describe("globalSkillsDir()", () => {
  it("returns a string starting with the home dir for claude", () => {
    const dir = globalSkillsDir("claude");
    expect(dir).toContain(".claude/skills");
    expect(dir.startsWith("/")).toBe(true);
  });

  it("returns correct path for all 9 harnesses", () => {
    const expected: Record<string, string> = {
      claude: ".claude/skills",
      codex: ".codex/skills",
      cursor: ".cursor/skills",
      copilot: ".copilot/skills",
      gemini: ".gemini/skills",
      opencode: ".config/opencode/skills",
      goose: ".agents/skills",
      amp: ".config/agents/skills",
      droid: ".factory/skills",
    };
    for (const [harness, suffix] of Object.entries(expected)) {
      const dir = globalSkillsDir(harness as keyof typeof HARNESSES);
      expect(dir).toContain(suffix);
      expect(dir.startsWith("/")).toBe(true);
    }
  });
});

describe("ensureGlobalColony()", () => {
  it("creates the skills/ subdirectory under skddHome()", () => {
    ensureGlobalColony();
    expect(existsSync(join(skddTmp, "skills"))).toBe(true);
  });

  it("creates the .skills-registry.md seed file", () => {
    ensureGlobalColony();
    expect(existsSync(join(skddTmp, ".skills-registry.md"))).toBe(true);
    const content = readFileSync(join(skddTmp, ".skills-registry.md"), "utf8");
    expect(content).toContain("Skills Registry");
  });

  it("is idempotent — second call does not throw or overwrite", () => {
    ensureGlobalColony();
    const firstContent = readFileSync(join(skddTmp, ".skills-registry.md"), "utf8");
    ensureGlobalColony();
    const secondContent = readFileSync(join(skddTmp, ".skills-registry.md"), "utf8");
    expect(firstContent).toBe(secondContent);
  });

  it("does not overwrite an existing registry file", () => {
    mkdirSync(join(skddTmp, "skills"), { recursive: true });
    const customContent = "# My Custom Registry\n";
    writeFileSync(join(skddTmp, ".skills-registry.md"), customContent);
    ensureGlobalColony();
    expect(readFileSync(join(skddTmp, ".skills-registry.md"), "utf8")).toBe(customContent);
  });
});

describe("HarnessProfile.globalSkillsDir field", () => {
  it("every harness has a non-empty globalSkillsDir field", () => {
    for (const harness of Object.values(HARNESSES)) {
      expect(harness.globalSkillsDir).toBeTruthy();
      expect(typeof harness.globalSkillsDir).toBe("string");
    }
  });

  it("all globalSkillsDir fields start with ~/", () => {
    for (const harness of Object.values(HARNESSES)) {
      expect(harness.globalSkillsDir.startsWith("~/")).toBe(true);
    }
  });
});
