import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkill } from "../src/lib/skill.js";
import { validateSkill } from "../src/commands/validate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "fixtures");

describe("validateSkill — valid fixtures", () => {
  it("accepts a minimal spec-compliant skill", () => {
    const skill = parseSkill(resolve(FIXTURES, "valid/minimal/SKILL.md"));
    const issues = validateSkill(skill);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  it("accepts a fully-populated skill with SkDD lifecycle metadata", () => {
    const skill = parseSkill(resolve(FIXTURES, "valid/full/SKILL.md"));
    const issues = validateSkill(skill);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });
});

describe("validateSkill — invalid fixtures", () => {
  it("rejects a skill missing name", () => {
    const skill = parseSkill(resolve(FIXTURES, "invalid/missing-name/SKILL.md"));
    const issues = validateSkill(skill);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors.some((e) => e.field === "name")).toBe(true);
  });

  it("rejects a skill missing description", () => {
    const skill = parseSkill(resolve(FIXTURES, "invalid/missing-description/SKILL.md"));
    const issues = validateSkill(skill);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors.some((e) => e.field === "description")).toBe(true);
  });

  it("rejects a skill with uppercase/underscore name", () => {
    const skill = parseSkill(resolve(FIXTURES, "invalid/bad-name/SKILL.md"));
    const issues = validateSkill(skill);
    const errors = issues.filter((i) => i.severity === "error" && i.field === "name");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects a skill whose name does not match its directory", () => {
    const skill = parseSkill(resolve(FIXTURES, "invalid/wrong-dir/SKILL.md"));
    const issues = validateSkill(skill);
    const errors = issues.filter((i) => i.severity === "error" && i.field === "name");
    expect(errors.some((e) => e.message.includes("does not match directory"))).toBe(true);
  });
});

describe("validateSkill — description warnings", () => {
  it("warns when description lacks trigger language", () => {
    // Synthesize a skill in memory by re-parsing a fixture and overriding its frontmatter
    const skill = parseSkill(resolve(FIXTURES, "valid/minimal/SKILL.md"));
    skill.frontmatter.description = "A skill that does something useful.";
    const issues = validateSkill(skill);
    const warnings = issues.filter((i) => i.severity === "warn" && i.field === "description");
    expect(warnings.length).toBeGreaterThan(0);
  });
});
