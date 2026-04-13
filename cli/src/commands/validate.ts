import { existsSync, statSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { logger, pc } from "../lib/logger.js";
import { parseSkill, findSkills, type ParsedSkill } from "../lib/skill.js";
import {
  DESCRIPTION_MAX_LENGTH,
  DESCRIPTION_MIN_LENGTH,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  NAME_REGEX,
  REQUIRED_FRONTMATTER,
  SKDD_MAX_SKILL_LINES,
} from "../lib/spec.js";

export interface ValidationIssue {
  severity: "error" | "warn";
  field?: string;
  message: string;
}

export interface ValidationResult {
  path: string;
  issues: ValidationIssue[];
}

export interface ValidateOptions {
  strict?: boolean;
  cwd?: string;
}

export function validateSkill(skill: ParsedSkill, opts: ValidateOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fm = skill.frontmatter;

  // Required fields
  for (const field of REQUIRED_FRONTMATTER) {
    if (fm[field] === undefined || fm[field] === null || fm[field] === "") {
      issues.push({
        severity: "error",
        field,
        message: `missing required frontmatter field '${field}'`,
      });
    }
  }

  // Name validation
  if (typeof fm.name === "string") {
    if (fm.name.length < NAME_MIN_LENGTH || fm.name.length > NAME_MAX_LENGTH) {
      issues.push({
        severity: "error",
        field: "name",
        message: `name must be ${NAME_MIN_LENGTH}-${NAME_MAX_LENGTH} characters (got ${fm.name.length})`,
      });
    }
    if (!NAME_REGEX.test(fm.name)) {
      issues.push({
        severity: "error",
        field: "name",
        message: `name must match ${NAME_REGEX} (lowercase kebab-case)`,
      });
    }
    // name must match directory
    if (fm.name !== skill.dirName) {
      issues.push({
        severity: "error",
        field: "name",
        message: `name '${fm.name}' does not match directory '${skill.dirName}'`,
      });
    }
  } else if (fm.name !== undefined) {
    issues.push({
      severity: "error",
      field: "name",
      message: `name must be a string`,
    });
  }

  // Description validation
  if (typeof fm.description === "string") {
    if (
      fm.description.length < DESCRIPTION_MIN_LENGTH ||
      fm.description.length > DESCRIPTION_MAX_LENGTH
    ) {
      issues.push({
        severity: "error",
        field: "description",
        message: `description must be ${DESCRIPTION_MIN_LENGTH}-${DESCRIPTION_MAX_LENGTH} characters (got ${fm.description.length})`,
      });
    }
    // Soft check: description should include trigger language
    if (!/\buse when\b|\bwhen asked\b|\btriggers?\b/i.test(fm.description)) {
      issues.push({
        severity: "warn",
        field: "description",
        message: `description should include trigger language (e.g., "Use when …") to improve discovery`,
      });
    }
  } else if (fm.description !== undefined) {
    issues.push({
      severity: "error",
      field: "description",
      message: `description must be a string`,
    });
  }

  // Metadata must be an object if present
  if (fm.metadata !== undefined && (typeof fm.metadata !== "object" || Array.isArray(fm.metadata))) {
    issues.push({
      severity: "error",
      field: "metadata",
      message: `metadata must be an object`,
    });
  }

  // Body must exist
  if (skill.body.trim().length === 0) {
    issues.push({
      severity: "error",
      message: `body is empty — a SKILL.md must have markdown instructions after the frontmatter`,
    });
  }

  // SkDD size recommendation
  if (skill.lineCount > SKDD_MAX_SKILL_LINES) {
    issues.push({
      severity: opts.strict ? "error" : "warn",
      message: `SKILL.md is ${skill.lineCount} lines (SkDD recommends splitting above ${SKDD_MAX_SKILL_LINES})`,
    });
  }

  return issues;
}

export async function runValidate(targets: string[], opts: ValidateOptions = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const paths = targets.length > 0 ? targets : [cwd];
  const results: ValidationResult[] = [];

  for (const target of paths) {
    const absTarget = resolve(cwd, target);
    if (!existsSync(absTarget)) {
      logger.error(`Path not found: ${target}`);
      return 2;
    }
    const stat = statSync(absTarget);
    const skillPaths =
      stat.isFile() && basename(absTarget) === "SKILL.md"
        ? [absTarget]
        : findSkills(absTarget);

    if (skillPaths.length === 0) {
      logger.warn(`No SKILL.md files found under ${relative(cwd, absTarget) || "."}`);
      continue;
    }

    for (const p of skillPaths) {
      try {
        const skill = parseSkill(p);
        const issues = validateSkill(skill, opts);
        results.push({ path: p, issues });
      } catch (err) {
        results.push({
          path: p,
          issues: [
            {
              severity: "error",
              message: `failed to parse: ${(err as Error).message}`,
            },
          ],
        });
      }
    }
  }

  let errorCount = 0;
  let warnCount = 0;
  for (const result of results) {
    const rel = relative(cwd, result.path) || result.path;
    const errors = result.issues.filter((i) => i.severity === "error");
    const warns = result.issues.filter((i) => i.severity === "warn");
    errorCount += errors.length;
    warnCount += warns.length;

    if (result.issues.length === 0) {
      logger.success(rel);
      continue;
    }
    if (errors.length > 0) {
      logger.error(rel);
    } else {
      logger.warn(rel);
    }
    for (const issue of result.issues) {
      const prefix = issue.severity === "error" ? pc.red("  error") : pc.yellow("  warn ");
      const field = issue.field ? pc.dim(`[${issue.field}] `) : "";
      console.log(`${prefix} ${field}${issue.message}`);
    }
  }

  console.log("");
  if (errorCount === 0 && warnCount === 0) {
    logger.success(`${results.length} skill(s) validated — all clean.`);
    return 0;
  }
  const summary = `${results.length} skill(s), ${errorCount} error(s), ${warnCount} warning(s).`;
  if (errorCount > 0) {
    logger.error(summary);
    return 1;
  }
  logger.warn(summary);
  return 0;
}
