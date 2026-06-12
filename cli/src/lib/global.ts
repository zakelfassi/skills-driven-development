import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { HARNESSES, type Harness } from "./harness.js";
import { EMPTY_REGISTRY_MD } from "./templates.js";

export const SKDD_HOME_ENV = "SKDD_HOME";

/**
 * Returns the ~/.skdd directory path.
 * Honors the SKDD_HOME environment variable as a test seam — all global paths
 * flow through this function so tests can override the home directory without
 * touching the real user home.
 */
export function skddHome(): string {
  const env = process.env[SKDD_HOME_ENV];
  return env ? resolve(env) : join(homedir(), ".skdd");
}

export interface ColonyContext {
  root: string;
  scope: "project" | "global";
}

/**
 * Resolve the colony root directory.
 * - global: true → ~/.skdd (ensures it exists first)
 * - otherwise → cwd or process.cwd()
 */
export function resolveColonyRoot(opts: { cwd?: string; global?: boolean }): ColonyContext {
  if (opts.global) {
    ensureGlobalColony();
    return { root: skddHome(), scope: "global" };
  }
  return { root: resolve(opts.cwd ?? process.cwd()), scope: "project" };
}

/**
 * Resolve the global skills directory for a given harness.
 * Expands the tilde-relative `globalSkillsDir` from the harness profile
 * against `homedir()` (which honors the HOME env on POSIX).
 */
export function globalSkillsDir(harness: Harness): string {
  const raw = HARNESSES[harness].globalSkillsDir;
  if (raw.startsWith("~/")) {
    return join(homedir(), raw.slice(2));
  }
  return isAbsolute(raw) ? raw : join(homedir(), raw);
}

/**
 * Ensure the global colony directory (~/.skdd/) exists with its required
 * subdirectories and seed files. Idempotent — safe to call multiple times.
 */
export function ensureGlobalColony(): void {
  const home = skddHome();
  const skillsDir = join(home, "skills");
  if (!existsSync(skillsDir)) {
    mkdirSync(skillsDir, { recursive: true });
  }
  const registryPath = join(home, ".skills-registry.md");
  if (!existsSync(registryPath)) {
    writeFileSync(registryPath, EMPTY_REGISTRY_MD);
  }
}
