import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { logger } from "../lib/logger.js";
import { loadRegistry, registryExists } from "../lib/registry.js";

export interface ShowOptions {
  cwd?: string;
  format?: "raw" | "rendered";
}

/**
 * Print the full SKILL.md body for a single skill.
 *
 * Resolution order:
 *   1. Canonical `skills/<name>/SKILL.md` under `cwd`.
 *   2. Registry entry's `path` (from `.skills-registry.json` if present; the
 *      markdown registry doesn't carry a path column).
 *
 * Errors:
 *   - Skill not found anywhere → exit 1 with a hint listing available skills.
 *   - Registry references a path that isn't on disk → exit 1 with a
 *     "registered but missing on disk" message.
 */
export async function runShow(
  name: string,
  opts: ShowOptions = {},
): Promise<number> {
  const cwd = resolve(opts.cwd ?? process.cwd());

  if (!name) {
    logger.error("Skill name is required. Usage: skdd show <name>");
    return 1;
  }

  // 1. Canonical location wins.
  const canonicalPath = join(cwd, "skills", name, "SKILL.md");
  if (existsSync(canonicalPath)) {
    process.stdout.write(readFileSync(canonicalPath, "utf8"));
    return 0;
  }

  // 2. Fall back to the registry's `path` entry.
  const has = registryExists(cwd);
  if (has.md || has.json) {
    const registry = loadRegistry(cwd);
    const entry = registry.skills.find((s) => s.name === name);
    if (entry?.path) {
      const registeredPath = isAbsolute(entry.path) ? entry.path : join(cwd, entry.path);
      if (existsSync(registeredPath)) {
        process.stdout.write(readFileSync(registeredPath, "utf8"));
        return 0;
      }
      logger.error(
        `Skill "${name}" is registered but missing on disk at ${entry.path}.`,
      );
      logger.dim(
        "Check the registry or re-forge the skill with `skdd forge`.",
      );
      return 1;
    }
  }

  // Not found anywhere — print a helpful hint listing available skills.
  logger.error(`Skill not found: ${name}`);
  const available = has.md || has.json ? loadRegistry(cwd).skills.map((s) => s.name) : [];
  if (available.length > 0) {
    logger.dim(`Available skills: ${available.join(", ")}`);
  } else {
    logger.dim(
      "No skills found in this project. Run `skdd list` to inspect the registry, or `skdd forge <name>` to create one.",
    );
  }
  return 1;
}
