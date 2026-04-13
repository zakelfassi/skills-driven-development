import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { logger, pc } from "../lib/logger.js";
import { detectAllHarnesses } from "../lib/harness.js";
import { loadState } from "../lib/sync-state.js";
import { loadRegistry, registryExists } from "../lib/registry.js";
import { findSkills, parseSkill, type ParsedSkill } from "../lib/skill.js";
import { validateSkill } from "./validate.js";

export type CheckStatus = "ok" | "warn" | "error";

export interface DoctorCheck {
  section: string;
  status: CheckStatus;
  message: string;
  hint?: string;
}

export interface DoctorOptions {
  cwd?: string;
  json?: boolean;
}

interface ColonyManifest {
  name?: string;
  version?: string;
  canonicalSkillsDir?: string;
}

const INSTRUCTION_FILES = [
  "CLAUDE.md",
  "AGENTS.md",
  ".cursor/rules/skills.mdc",
  ".github/copilot-instructions.md",
] as const;

export async function runDoctor(opts: DoctorOptions = {}): Promise<number> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const checks: DoctorCheck[] = [];

  const canonical = checkColony(cwd, checks);
  const canonicalPath = join(cwd, canonical);
  const parsedSkills = checkSkillsDir(cwd, canonical, canonicalPath, checks);
  checkValidation(parsedSkills, checks);
  checkRegistry(cwd, parsedSkills, canonical, checks);
  checkMirrors(cwd, canonicalPath, checks);
  checkInstructions(cwd, checks);

  if (opts.json) {
    emitJson(cwd, canonical, checks);
  } else {
    emitHuman(cwd, canonical, checks);
  }

  return checks.some((c) => c.status === "error") ? 1 : 0;
}

function checkColony(cwd: string, checks: DoctorCheck[]): string {
  const colonyPath = join(cwd, ".colony.json");
  if (!existsSync(colonyPath)) {
    checks.push({
      section: "Colony",
      status: "warn",
      message: "no .colony.json manifest",
      hint: "Hand-write .colony.json (schema: docs/spec/colony-v1.json) to make the colony discoverable by marketplaces.",
    });
    return "skills";
  }
  try {
    const manifest = JSON.parse(readFileSync(colonyPath, "utf8")) as ColonyManifest;
    const canonical =
      typeof manifest.canonicalSkillsDir === "string" && manifest.canonicalSkillsDir.length > 0
        ? manifest.canonicalSkillsDir
        : "skills";
    const label =
      manifest.name !== undefined
        ? `${manifest.name}${manifest.version ? "@" + manifest.version : ""}`
        : null;
    checks.push({
      section: "Colony",
      status: "ok",
      message: label
        ? `.colony.json valid — ${label} (canonical: ${canonical}/)`
        : `.colony.json valid (canonical: ${canonical}/)`,
    });
    return canonical;
  } catch (err) {
    checks.push({
      section: "Colony",
      status: "error",
      message: `.colony.json exists but failed to parse: ${(err as Error).message}`,
      hint: "Fix the JSON syntax and re-run 'skdd doctor'.",
    });
    return "skills";
  }
}

function checkSkillsDir(
  cwd: string,
  canonical: string,
  canonicalPath: string,
  checks: DoctorCheck[],
): ParsedSkill[] {
  if (!existsSync(canonicalPath)) {
    checks.push({
      section: "Skills",
      status: "error",
      message: `canonical skills directory missing: ${canonical}/`,
      hint: `Run 'skdd init' to scaffold it, or 'mkdir -p ${canonical}' and 'skdd forge <name>'.`,
    });
    return [];
  }

  const skillPaths = findSkills(canonicalPath);
  if (skillPaths.length === 0) {
    checks.push({
      section: "Skills",
      status: "warn",
      message: `${canonical}/ exists but contains no SKILL.md files`,
      hint: "Run 'skdd forge <name>' to create your first skill.",
    });
    return [];
  }

  const parsed: ParsedSkill[] = [];
  for (const p of skillPaths) {
    try {
      parsed.push(parseSkill(p));
    } catch (err) {
      checks.push({
        section: "Skills",
        status: "error",
        message: `${relative(cwd, p) || p}: failed to parse — ${(err as Error).message}`,
      });
    }
  }
  checks.push({
    section: "Skills",
    status: "ok",
    message: `${parsed.length} skill(s) found in ${canonical}/`,
  });
  return parsed;
}

function checkValidation(parsedSkills: ParsedSkill[], checks: DoctorCheck[]): void {
  if (parsedSkills.length === 0) return;
  let errors = 0;
  let warns = 0;
  for (const skill of parsedSkills) {
    const issues = validateSkill(skill);
    errors += issues.filter((i) => i.severity === "error").length;
    warns += issues.filter((i) => i.severity === "warn").length;
  }
  if (errors === 0 && warns === 0) {
    checks.push({
      section: "Validation",
      status: "ok",
      message: `all ${parsedSkills.length} skill(s) pass 'skdd validate'`,
    });
    return;
  }
  if (errors > 0) {
    checks.push({
      section: "Validation",
      status: "error",
      message: `${errors} spec error(s) across ${parsedSkills.length} skill(s)`,
      hint: "Run 'skdd validate' for per-skill details.",
    });
  }
  if (warns > 0) {
    checks.push({
      section: "Validation",
      status: "warn",
      message: `${warns} spec warning(s) across ${parsedSkills.length} skill(s)`,
      hint: errors === 0 ? "Run 'skdd validate' for per-skill details." : undefined,
    });
  }
}

function checkRegistry(
  cwd: string,
  parsedSkills: ParsedSkill[],
  canonical: string,
  checks: DoctorCheck[],
): void {
  const { md, json } = registryExists(cwd);
  if (!md && !json) {
    checks.push({
      section: "Registry",
      status: "warn",
      message: "no .skills-registry.md or .skills-registry.json in project root",
      hint: "Run 'skdd init' to create the markdown registry.",
    });
    return;
  }

  let registry;
  try {
    registry = loadRegistry(cwd);
  } catch (err) {
    checks.push({
      section: "Registry",
      status: "error",
      message: `failed to parse registry: ${(err as Error).message}`,
    });
    return;
  }

  const formats = [md ? "markdown" : null, json ? "json" : null].filter(Boolean).join(" + ");
  const registryNames = new Set(registry.skills.map((s) => s.name));
  const diskNames = new Set(
    parsedSkills
      .filter((s) => typeof s.frontmatter.name === "string")
      .map((s) => s.frontmatter.name as string),
  );

  const missingFromRegistry = [...diskNames].filter((n) => !registryNames.has(n)).sort();
  const missingFromDisk = [...registryNames].filter((n) => !diskNames.has(n)).sort();

  if (missingFromRegistry.length === 0 && missingFromDisk.length === 0) {
    checks.push({
      section: "Registry",
      status: "ok",
      message: `${formats} registry in sync with ${canonical}/ (${registry.skills.length} entries)`,
    });
    return;
  }
  if (missingFromRegistry.length > 0) {
    checks.push({
      section: "Registry",
      status: "warn",
      message: `${missingFromRegistry.length} skill(s) on disk missing from registry: ${missingFromRegistry.join(", ")}`,
      hint: "Re-run 'skdd forge' for each, or add them to .skills-registry.md by hand.",
    });
  }
  if (missingFromDisk.length > 0) {
    checks.push({
      section: "Registry",
      status: "warn",
      message: `${missingFromDisk.length} registry entry/entries with no SKILL.md on disk: ${missingFromDisk.join(", ")}`,
      hint: "Restore the files or remove the entries from .skills-registry.md.",
    });
  }
}

function checkMirrors(cwd: string, canonicalPath: string, checks: DoctorCheck[]): void {
  const state = loadState(cwd);
  const detected = detectAllHarnesses(cwd);

  if (!state && detected.length === 0) {
    checks.push({
      section: "Mirrors",
      status: "ok",
      message: "no harness markers and no .skdd-sync.json — single-harness or not yet linked",
    });
    return;
  }
  if (!state && detected.length > 0) {
    checks.push({
      section: "Mirrors",
      status: "warn",
      message: `${detected.length} harness(es) detected (${detected.join(", ")}) but no .skdd-sync.json`,
      hint: "Run 'skdd link' to materialize mirrors into each harness dir.",
    });
    return;
  }
  if (state!.mirrors.length === 0) {
    checks.push({
      section: "Mirrors",
      status: "warn",
      message: ".skdd-sync.json exists but has no mirrors recorded",
      hint: "Run 'skdd link' to populate it.",
    });
    return;
  }

  let okCount = 0;
  let driftCount = 0;
  for (const mirror of state!.mirrors) {
    const target = join(cwd, mirror.target);
    const result = verifyMirror(target, mirror.mode, canonicalPath);
    if (result.ok) {
      okCount++;
    } else {
      driftCount++;
      checks.push({
        section: "Mirrors",
        status: "error",
        message: `${mirror.target}: ${result.reason}`,
        hint: "Run 'skdd link' (or 'skdd link --force' if the target has user data) to repair.",
      });
    }
  }
  if (driftCount === 0) {
    checks.push({
      section: "Mirrors",
      status: "ok",
      message: `${okCount} mirror(s) in sync (${state!.mirrors.map((m) => m.target).join(", ")})`,
    });
  }
}

function verifyMirror(
  target: string,
  mode: "symlink" | "copy",
  canonicalPath: string,
): { ok: boolean; reason?: string } {
  if (!existsSync(target)) {
    return { ok: false, reason: "mirror path does not exist" };
  }
  try {
    const stat = lstatSync(target);
    if (mode === "symlink") {
      if (!stat.isSymbolicLink()) {
        return { ok: false, reason: "expected symlink, found regular directory/file" };
      }
      const linkTarget = readlinkSync(target);
      const expected = relative(dirname(target), canonicalPath);
      if (linkTarget !== expected) {
        return {
          ok: false,
          reason: `symlink points at '${linkTarget}', expected '${expected}'`,
        };
      }
      return { ok: true };
    }
    if (stat.isSymbolicLink()) {
      return { ok: false, reason: "expected directory copy, found symlink" };
    }
    if (!stat.isDirectory()) {
      return { ok: false, reason: "expected directory copy, found file" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

function checkInstructions(cwd: string, checks: DoctorCheck[]): void {
  const found: Array<{ file: string; hasBlock: boolean }> = [];
  for (const file of INSTRUCTION_FILES) {
    const p = join(cwd, file);
    if (!existsSync(p)) continue;
    const content = readFileSync(p, "utf8");
    const hasBlock = content.includes("## Skills") && content.includes(".skills-registry.md");
    found.push({ file, hasBlock });
  }
  if (found.length === 0) {
    checks.push({
      section: "Instructions",
      status: "warn",
      message: `no agent instruction files found (expected any of: ${INSTRUCTION_FILES.join(", ")})`,
      hint: "Run 'skdd init' to scaffold CLAUDE.md / AGENTS.md / .cursor/rules/skills.mdc.",
    });
    return;
  }
  const withBlock = found.filter((f) => f.hasBlock);
  const withoutBlock = found.filter((f) => !f.hasBlock);
  if (withBlock.length > 0) {
    checks.push({
      section: "Instructions",
      status: "ok",
      message: `${withBlock.length} instruction file(s) reference the skills registry: ${withBlock
        .map((f) => f.file)
        .join(", ")}`,
    });
  }
  if (withoutBlock.length > 0) {
    checks.push({
      section: "Instructions",
      status: "warn",
      message: `${withoutBlock.length} instruction file(s) lack a Skills block: ${withoutBlock
        .map((f) => f.file)
        .join(", ")}`,
      hint: "Run 'skdd init' — it will append the block if missing.",
    });
  }
}

function emitJson(cwd: string, canonical: string, checks: DoctorCheck[]): void {
  const counts = {
    total: checks.length,
    ok: checks.filter((c) => c.status === "ok").length,
    warn: checks.filter((c) => c.status === "warn").length,
    error: checks.filter((c) => c.status === "error").length,
  };
  console.log(JSON.stringify({ cwd, canonical, counts, checks }, null, 2));
}

function emitHuman(cwd: string, canonical: string, checks: DoctorCheck[]): void {
  logger.heading("skdd doctor");
  logger.dim(`project:   ${cwd}`);
  logger.dim(`canonical: ${canonical}/`);
  console.log("");

  const sections: string[] = [];
  for (const c of checks) {
    if (!sections.includes(c.section)) sections.push(c.section);
  }
  for (const section of sections) {
    console.log(pc.bold(section));
    for (const check of checks.filter((c) => c.section === section)) {
      const icon =
        check.status === "ok"
          ? pc.green("✓")
          : check.status === "warn"
            ? pc.yellow("!")
            : pc.red("✗");
      console.log(`  ${icon} ${check.message}`);
      if (check.hint) {
        console.log(`    ${pc.dim("→ " + check.hint)}`);
      }
    }
    console.log("");
  }

  const oks = checks.filter((c) => c.status === "ok").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  const errors = checks.filter((c) => c.status === "error").length;
  if (errors === 0 && warns === 0) {
    logger.success(`All ${oks} check(s) passed.`);
  } else if (errors === 0) {
    logger.warn(`${oks} ok · ${warns} warning(s) · 0 errors`);
  } else {
    logger.error(`${oks} ok · ${warns} warning(s) · ${errors} error(s)`);
  }
}
