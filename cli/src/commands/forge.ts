import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { input, confirm } from "@inquirer/prompts";
import { logger } from "../lib/logger.js";
import { NAME_MAX_LENGTH, NAME_REGEX } from "../lib/spec.js";
import { renderSkillSkeleton } from "../lib/templates.js";
import { addRegistryEntry } from "../lib/registry.js";
import { resolveHarness, type Harness } from "../lib/harness.js";

export interface ForgeOptions {
  cwd?: string;
  fromDescription?: string;
  nonInteractive?: boolean;
  harness?: Harness | "auto";
  forgedBy?: string;
}

export async function runForge(name: string, opts: ForgeOptions = {}): Promise<number> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const profile = resolveHarness(cwd, opts.harness);

  // Validate name
  const nameError = validateName(name);
  if (nameError) {
    logger.error(nameError);
    return 1;
  }

  const skillDir = join(cwd, profile.skillsDir, name);
  const skillPath = join(skillDir, "SKILL.md");

  if (existsSync(skillPath)) {
    logger.error(`Skill already exists: ${profile.skillsDir}/${name}/SKILL.md`);
    logger.dim(`Use \`skdd forge\` with a different name, or edit the file directly.`);
    return 1;
  }

  let description = opts.fromDescription ?? "";
  if (!description) {
    if (opts.nonInteractive) {
      logger.error(`--non-interactive requires --from-description="..."`);
      return 1;
    }
    description = await input({
      message: `Description (1-1024 chars, include trigger language like "Use when ..."):`,
      validate: (value) => {
        if (!value || value.length === 0) return "Description is required";
        if (value.length > 1024) return "Description must be ≤1024 characters";
        if (!/use when|when asked|triggers?/i.test(value))
          return 'Include trigger language, e.g., "Use when …"';
        return true;
      },
    });
  }

  const forgedBy = opts.forgedBy ?? "skdd-cli";
  const forgedFrom = new Date().toISOString().slice(0, 10);
  let forgedReason = "";
  if (!opts.nonInteractive) {
    forgedReason = await input({
      message: "Why are you forging this skill? (one sentence, optional)",
      default: "",
    });
  }

  const body = renderSkillSkeleton({ name, description, forgedBy, forgedFrom, forgedReason: forgedReason || undefined });
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(skillPath, body);
  logger.success(`forged ${profile.skillsDir}/${name}/SKILL.md`);

  // Register in the registry
  try {
    addRegistryEntry(cwd, {
      name,
      source: "local",
      path: `${profile.skillsDir}/${name}/SKILL.md`,
      lastUsed: forgedFrom,
      uses: 0,
      description,
      status: "active",
    });
    logger.success(`registered ${name} in .skills-registry.md`);
  } catch (err) {
    logger.warn(`skill written but registry update failed: ${(err as Error).message}`);
  }

  if (!opts.nonInteractive) {
    const openNext = await confirm({
      message: `Fill in Inputs/Steps/Conventions/Edge Cases now?`,
      default: true,
    });
    if (openNext) {
      logger.info(`Open ${skillPath} in your editor.`);
    }
  }

  return 0;
}

function validateName(name: string): string | null {
  if (!name) return "Skill name is required";
  if (name.length > NAME_MAX_LENGTH) return `Name must be ≤${NAME_MAX_LENGTH} characters`;
  if (!NAME_REGEX.test(name)) return `Name must be lowercase kebab-case (${NAME_REGEX})`;
  return null;
}
