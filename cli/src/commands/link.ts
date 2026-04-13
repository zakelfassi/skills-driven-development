import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { logger, pc } from "../lib/logger.js";
import { detectAllHarnesses, HARNESSES, type Harness } from "../lib/harness.js";
import {
  ensureMirror,
  resolveLinkMode,
  type EnsureMirrorResult,
  type LinkMode,
} from "../lib/fs-link.js";
import { emptyState, loadState, saveState, upsertMirror } from "../lib/sync-state.js";

export interface LinkOptions {
  cwd?: string;
  mode?: LinkMode;
  harnesses?: Harness[];
  force?: boolean;
  quiet?: boolean;
  canonical?: string;
}

export async function runLink(opts: LinkOptions = {}): Promise<number> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const canonical = opts.canonical ?? "skills";
  const canonicalPath = resolve(cwd, canonical);
  const mode = resolveLinkMode(opts.mode);
  const quiet = opts.quiet ?? false;

  if (!existsSync(canonicalPath)) {
    logger.error(`Canonical skills directory missing: ${canonical}/`);
    logger.dim("Run 'skdd init' to create it, or 'mkdir skills' manually.");
    return 1;
  }

  // Determine which harnesses to mirror into.
  let harnesses = opts.harnesses;
  if (!harnesses || harnesses.length === 0) {
    const detected = detectAllHarnesses(cwd);
    if (detected.length > 0) {
      harnesses = detected;
    } else {
      if (!quiet) {
        logger.warn(
          "No harness markers detected (.claude/, .codex/, .cursor/, .github/, etc.). Defaulting to claude. Pass --harness to override.",
        );
      }
      harnesses = ["claude"];
    }
  }

  const state = loadState(cwd) ?? emptyState(canonical);
  state.canonical = canonical;

  if (!quiet) {
    logger.heading(`skdd link — ${mode} mode`);
    logger.dim(`canonical: ${canonical}/`);
    logger.dim(`mirrors:   ${harnesses.map((h) => HARNESSES[h].skillsDir).join(", ")}`);
    console.log("");
  }

  let errorCount = 0;
  let blockedCount = 0;
  for (const harness of harnesses) {
    const profile = HARNESSES[harness];
    const mirrorAbs = resolve(cwd, profile.skillsDir);
    let result: EnsureMirrorResult;
    try {
      result = ensureMirror(canonicalPath, mirrorAbs, mode, { force: opts.force });
    } catch (err) {
      logger.error(`${profile.skillsDir}: ${(err as Error).message}`);
      errorCount++;
      continue;
    }

    const label = profile.skillsDir;
    const rel = relative(cwd, canonicalPath) || canonicalPath;
    switch (result.action) {
      case "created":
        if (!quiet) logger.success(`${label} → ${rel} (created ${result.mode})`);
        upsertMirror(state, profile.skillsDir, result.mode);
        break;
      case "repaired":
        if (!quiet) {
          logger.warn(`${label} → ${rel} (repaired drift${result.reason ? ": " + result.reason : ""})`);
        }
        upsertMirror(state, profile.skillsDir, result.mode);
        break;
      case "unchanged":
        if (!quiet) logger.dim(`${label} → ${rel} (already in sync)`);
        upsertMirror(state, profile.skillsDir, result.mode);
        break;
      case "blocked":
        logger.error(`${label}: ${result.reason ?? "blocked"}`);
        blockedCount++;
        break;
    }
  }

  saveState(cwd, state);

  if (!quiet) console.log("");
  if (errorCount > 0 || blockedCount > 0) {
    logger.error(
      `${errorCount + blockedCount} mirror(s) failed. ${blockedCount > 0 ? "Pass --force to override drift blocks." : ""}`.trim(),
    );
    return 1;
  }
  if (!quiet) logger.success(`State written to ${pc.bold(".skdd-sync.json")}`);
  return 0;
}
