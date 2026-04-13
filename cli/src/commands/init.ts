import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { logger } from "../lib/logger.js";
import { resolveHarness, type Harness } from "../lib/harness.js";
import {
  EMPTY_REGISTRY_MD,
  SKILLFORGE_STUB,
  renderCanonicalInstructionBlock,
  renderHarnessInstructionBlock,
} from "../lib/templates.js";
import { runLink } from "./link.js";

export interface InitOptions {
  cwd?: string;
  harness?: Harness | "auto";
  force?: boolean;
  /**
   * When true (default), scaffold the canonical `skills/` directory and link harness
   * mirrors into it. When false, fall back to the flat per-harness layout for users who
   * explicitly don't want symlinks or the canonical source-of-truth.
   */
  canonical?: boolean;
}

export async function runInit(opts: InitOptions = {}): Promise<number> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const profile = resolveHarness(cwd, opts.harness);
  const canonical = opts.canonical !== false; // default true

  logger.heading(`skdd init — ${profile.label}${canonical ? " (canonical)" : " (flat)"}`);
  logger.dim(`project: ${cwd}`);
  if (canonical) {
    logger.dim(`canonical: skills/`);
    logger.dim(`mirror:    ${profile.skillsDir}`);
  } else {
    logger.dim(`skills dir: ${profile.skillsDir}`);
  }
  logger.dim(`instruction file: ${profile.instructionFile}`);
  console.log("");

  const skillsDir = canonical ? "skills" : profile.skillsDir;
  const skillforgeDir = join(cwd, skillsDir, "skillforge");
  const skillforgePath = join(skillforgeDir, "SKILL.md");

  // 1. Create skills directory and skillforge stub
  if (!existsSync(skillforgeDir)) {
    mkdirSync(skillforgeDir, { recursive: true });
    logger.success(`created ${skillsDir}/skillforge/`);
  } else {
    logger.dim(`exists: ${skillsDir}/skillforge/`);
  }
  if (!existsSync(skillforgePath) || opts.force) {
    writeFileSync(skillforgePath, SKILLFORGE_STUB);
    logger.success(`wrote ${skillsDir}/skillforge/SKILL.md (stub — replace with the full version when ready)`);
  } else {
    logger.dim(`exists: ${skillsDir}/skillforge/SKILL.md (pass --force to overwrite)`);
  }

  // 2. Create empty registry
  const registryPath = join(cwd, ".skills-registry.md");
  if (!existsSync(registryPath)) {
    writeFileSync(registryPath, EMPTY_REGISTRY_MD);
    logger.success(`created .skills-registry.md`);
  } else {
    logger.dim(`exists: .skills-registry.md`);
  }

  // 3. Ensure instruction file has the skills block
  const instructionPath = join(cwd, profile.instructionFile);
  const block = canonical
    ? renderCanonicalInstructionBlock("skills", profile.skillsDir, ".skills-registry.md", profile.label)
    : renderHarnessInstructionBlock(profile.skillsDir, ".skills-registry.md");
  const instructionDir = dirname(instructionPath);
  if (!existsSync(instructionDir)) {
    mkdirSync(instructionDir, { recursive: true });
  }
  if (!existsSync(instructionPath)) {
    writeFileSync(instructionPath, `# Agent Instructions\n\n${block}`);
    logger.success(`created ${profile.instructionFile} with skills block`);
  } else {
    const existing = readFileSync(instructionPath, "utf8");
    if (existing.includes("## Skills") && existing.includes(".skills-registry.md")) {
      logger.dim(`exists: ${profile.instructionFile} (skills block already present)`);
    } else {
      appendFileSync(instructionPath, `\n\n${block}`);
      logger.success(`appended skills block to ${profile.instructionFile}`);
    }
  }

  // 4. If canonical, run `link` to materialize the harness mirror
  if (canonical) {
    console.log("");
    logger.heading("Linking harness mirror");
    const linkCode = await runLink({
      cwd,
      harnesses: [profile.id],
      mode: "auto",
      quiet: false,
    });
    if (linkCode !== 0) {
      logger.warn(
        "Link step returned non-zero. The canonical skills/ directory is ready, but the harness mirror may need attention. Re-run `skdd link` to retry.",
      );
    }
  }

  console.log("");
  logger.heading("Next steps");
  logger.info(`1. Pull the full skillforge instead of the stub:`);
  logger.dim(
    `   curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md -o ${skillsDir}/skillforge/SKILL.md`,
  );
  logger.info(`2. Open this project with ${profile.label} and ask: "What skills are available?"`);
  logger.info(`3. Forge your first skill: "Forge a skill for <your repeated task>."`);
  logger.info(`4. See docs/configuration.md for per-harness details.`);

  return 0;
}
