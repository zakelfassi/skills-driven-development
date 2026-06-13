import { existsSync, lstatSync, rmSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  type EnsureMirrorResult,
  ensureMirror,
  type LinkMode,
  resolveLinkMode,
} from "../lib/fs-link.js";
import { globalSkillsDir, skddHome } from "../lib/global.js";
import { detectAllHarnesses, HARNESSES, type Harness } from "../lib/harness.js";
import { logger, pc } from "../lib/logger.js";
import { emptyState, loadState, removeMirror, saveState, upsertMirror } from "../lib/sync-state.js";

export interface LinkOptions {
  cwd?: string;
  mode?: LinkMode;
  harnesses?: Harness[];
  force?: boolean;
  quiet?: boolean;
  canonical?: string;
  global?: boolean;
}

export async function runLink(opts: LinkOptions = {}): Promise<number> {
  if (opts.global) {
    return runLinkGlobal(opts);
  }

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
          logger.warn(
            `${label} → ${rel} (repaired drift${result.reason ? ": " + result.reason : ""})`,
          );
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

async function runLinkGlobal(opts: LinkOptions): Promise<number> {
  const home = skddHome();
  const canonicalPath = join(home, "skills");
  const mode = resolveLinkMode(opts.mode);
  const quiet = opts.quiet ?? false;

  if (!existsSync(canonicalPath)) {
    logger.error(`Global skills directory missing: ${canonicalPath}`);
    logger.dim("Run 'skdd init -g' to create it.");
    return 1;
  }

  // Determine harnesses: explicit list or all whose global parent dir exists.
  let harnesses = opts.harnesses;
  if (!harnesses || harnesses.length === 0) {
    harnesses = (Object.keys(HARNESSES) as Harness[]).filter((h) => {
      const gDir = globalSkillsDir(h);
      const parent = dirname(gDir);
      return existsSync(parent);
    });
    if (harnesses.length === 0) {
      if (!quiet) {
        logger.warn(
          "No global harness parent directories found. Pass --harness to specify harnesses explicitly.",
        );
      }
      return 0;
    }
  }

  const state = loadState(home) ?? emptyState("skills");
  state.canonical = "skills";

  if (!quiet) {
    logger.heading(`skdd link --global — ${mode} mode`);
    logger.dim(`canonical: ${canonicalPath}`);
    logger.dim(`mirrors:   ${harnesses.map((h) => globalSkillsDir(h)).join(", ")}`);
    console.log("");
  }

  let errorCount = 0;
  let blockedCount = 0;
  for (const harness of harnesses) {
    const mirrorAbs = globalSkillsDir(harness);
    const profile = HARNESSES[harness];
    let result: EnsureMirrorResult;
    try {
      result = ensureMirror(canonicalPath, mirrorAbs, mode, { force: opts.force });
    } catch (err) {
      logger.error(`${mirrorAbs}: ${(err as Error).message}`);
      errorCount++;
      continue;
    }

    // Use absolute path as mirror target in global state.
    const label = isAbsolute(mirrorAbs) ? mirrorAbs : profile.skillsDir;
    switch (result.action) {
      case "created":
        if (!quiet) logger.success(`${label} → ${canonicalPath} (created ${result.mode})`);
        upsertMirror(state, mirrorAbs, result.mode);
        break;
      case "repaired":
        if (!quiet) {
          logger.warn(
            `${label} → ${canonicalPath} (repaired drift${result.reason ? ": " + result.reason : ""})`,
          );
        }
        upsertMirror(state, mirrorAbs, result.mode);
        break;
      case "unchanged":
        if (!quiet) logger.dim(`${label} → ${canonicalPath} (already in sync)`);
        upsertMirror(state, mirrorAbs, result.mode);
        break;
      case "blocked":
        logger.error(`${label}: ${result.reason ?? "blocked"}`);
        blockedCount++;
        break;
    }
  }

  saveState(home, state);

  if (!quiet) console.log("");
  if (errorCount > 0 || blockedCount > 0) {
    logger.error(
      `${errorCount + blockedCount} mirror(s) failed. ${blockedCount > 0 ? "Pass --force to override drift blocks." : ""}`.trim(),
    );
    return 1;
  }
  if (!quiet) logger.success(`State written to ${pc.bold(join(home, ".skdd-sync.json"))}`);
  return 0;
}

// -- runUnlink ----------------------------------------------------------------

export interface UnlinkOptions {
  cwd?: string;
  harnesses?: Harness[];
  quiet?: boolean;
  /** When true, allow removing a real (non-symlink) directory. Requires explicit opt-in. */
  force?: boolean;
}

/**
 * Remove the mirror symlink/directory for the given harnesses and delete
 * their entries from the sync state. Used by the hub TUI unlink action.
 */
export async function runUnlink(opts: UnlinkOptions = {}): Promise<number> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const quiet = opts.quiet ?? false;
  const harnesses = opts.harnesses ?? [];
  if (harnesses.length === 0) return 0;

  const state = loadState(cwd) ?? emptyState();

  for (const harness of harnesses) {
    const profile = HARNESSES[harness];
    const mirrorAbs = resolve(cwd, profile.skillsDir);

    // Guard: only remove symlinks by default. Real directories require explicit force.
    let stat: ReturnType<typeof lstatSync> | null = null;
    try {
      stat = lstatSync(mirrorAbs);
    } catch {
      // Already absent — treat as success.
      stat = null;
    }

    if (stat !== null) {
      if (stat.isSymbolicLink()) {
        // Remove the symlink itself (not its target).
        try {
          unlinkSync(mirrorAbs);
          if (!quiet) logger.success(`Unlinked ${profile.skillsDir}`);
        } catch (err) {
          if (!quiet)
            logger.warn(`Could not remove ${profile.skillsDir}: ${(err as Error).message}`);
          continue;
        }
      } else if (opts.force) {
        // Explicit force: caller acknowledges this removes a real directory.
        try {
          rmSync(mirrorAbs, { recursive: true, force: true });
          if (!quiet) logger.success(`Removed ${profile.skillsDir} (forced)`);
        } catch (err) {
          if (!quiet)
            logger.warn(`Could not remove ${profile.skillsDir}: ${(err as Error).message}`);
          continue;
        }
      } else {
        // Real directory without force — refuse to delete user data.
        if (!quiet) {
          logger.warn(
            `${profile.skillsDir} is a real directory (drift), not a symlink — skipping. Pass --force to remove.`,
          );
        }
        continue;
      }
    } else {
      if (!quiet) logger.dim(`${profile.skillsDir} already absent`);
    }

    // Remove mirror entry from state
    removeMirror(state, profile.skillsDir);
  }

  saveState(cwd, state);
  return 0;
}
