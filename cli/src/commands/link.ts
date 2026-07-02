import { existsSync, lstatSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  adoptSkills,
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
  /**
   * Copy the colony's skills INTO each (possibly populated) harness dir instead
   * of replacing the dir with a whole-directory symlink/copy mirror. Additive
   * and non-destructive: non-colony skills in the target are never touched.
   */
  adopt?: boolean;
}

export async function runLink(opts: LinkOptions = {}): Promise<number> {
  if (opts.adopt) {
    return runAdopt(opts);
  }
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
      // Refresh if this mirror is already recorded as a managed copy (re-copy canonical → target).
      // Unmanaged real dirs (not in sync state) stay blocked to protect user data.
      const mirrorEntry = state.mirrors.find((m) => m.target === profile.skillsDir);
      const isManagedCopy = mirrorEntry?.mode === "copy";
      // Honor an explicit `--mode symlink` request even on managed copies — the user
      // is intentionally converting the copy to a symlink. They must also pass --force
      // since the managed copy is a real directory at the target path.
      // For default/auto (or explicit --mode copy), preserve M8: force-refresh the copy.
      const isExplicitSymlink = opts.mode === "symlink";
      const effectiveMode = !isExplicitSymlink && isManagedCopy ? "copy" : mode;
      result = ensureMirror(canonicalPath, mirrorAbs, effectiveMode, {
        force: opts.force || (!isExplicitSymlink && isManagedCopy),
      });
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
      // Refresh if this mirror is already recorded as a managed copy (re-copy canonical → target).
      // Unmanaged real dirs (not in sync state) stay blocked to protect user data.
      const mirrorEntry = state.mirrors.find((m) => m.target === mirrorAbs);
      const isManagedCopy = mirrorEntry?.mode === "copy";
      // Honor an explicit `--mode symlink` request even on managed copies — the user
      // is intentionally converting the copy to a symlink. They must also pass --force
      // since the managed copy is a real directory at the target path.
      // For default/auto (or explicit --mode copy), preserve M8: force-refresh the copy.
      const isExplicitSymlink = opts.mode === "symlink";
      const effectiveMode = !isExplicitSymlink && isManagedCopy ? "copy" : mode;
      result = ensureMirror(canonicalPath, mirrorAbs, effectiveMode, {
        force: opts.force || (!isExplicitSymlink && isManagedCopy),
      });
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

// -- runAdopt -----------------------------------------------------------------

/**
 * Push the colony's skills INTO each harness dir additively, leaving non-colony
 * skills in place. Unlike the symlink/copy mirror, this never replaces the
 * target dir — so it's the safe way to get colony skills into a harness dir that
 * already holds hand-authored skills (the common global-colony case). Adopted
 * copies are intentionally NOT tracked in sync-state: they're a one-way push,
 * not a managed whole-dir mirror.
 */
async function runAdopt(opts: LinkOptions): Promise<number> {
  const quiet = opts.quiet ?? false;
  const canonicalPath = opts.global
    ? join(skddHome(), "skills")
    : resolve(opts.cwd ?? process.cwd(), opts.canonical ?? "skills");

  if (!existsSync(canonicalPath)) {
    logger.error(`Canonical skills directory missing: ${canonicalPath}`);
    logger.dim(opts.global ? "Run 'skdd init -g' to create it." : "Run 'skdd init' to create it.");
    return 1;
  }

  // Target dirs: explicit --harness list, else all with an existing parent
  // (global) / detected (project) — mirroring the normal link target selection.
  let harnesses = opts.harnesses;
  if (!harnesses || harnesses.length === 0) {
    harnesses = opts.global
      ? (Object.keys(HARNESSES) as Harness[]).filter((h) => existsSync(dirname(globalSkillsDir(h))))
      : detectAllHarnesses(resolve(opts.cwd ?? process.cwd()));
    if (harnesses.length === 0) harnesses = ["claude"];
  }

  const targetOf = (h: Harness) =>
    opts.global ? globalSkillsDir(h) : resolve(opts.cwd ?? process.cwd(), HARNESSES[h].skillsDir);

  if (!quiet) {
    logger.heading(`skdd ${opts.global ? "link -g " : "link "}--adopt`);
    logger.dim(`canonical: ${canonicalPath}`);
    console.log("");
  }

  let created = 0;
  let updated = 0;
  let divergent = 0;
  for (const harness of harnesses) {
    const target = targetOf(harness);
    const label = opts.global ? target : HARNESSES[harness].skillsDir;

    // A dir that's already a symlink to canonical sees every skill for free.
    let stat: ReturnType<typeof lstatSync> | null = null;
    try {
      stat = lstatSync(target);
    } catch {
      stat = null;
    }
    if (stat?.isSymbolicLink()) {
      try {
        if (realpathSync(target) === realpathSync(canonicalPath)) {
          if (!quiet) logger.dim(`${label}: already a colony symlink — sees all skills`);
          continue;
        }
      } catch {
        // fall through to adopt if the link is dangling/foreign
      }
      // A symlink pointing elsewhere: don't copy into someone else's target.
      if (!quiet) logger.warn(`${label}: symlink points outside the colony — skipping`);
      continue;
    }

    const results = adoptSkills(canonicalPath, target, { force: opts.force });
    const c = results.filter((r) => r.action === "created").length;
    const u = results.filter((r) => r.action === "updated").length;
    const d = results.filter((r) => r.action === "skipped-divergent").length;
    created += c;
    updated += u;
    divergent += d;
    if (!quiet) {
      const parts = [`${c} added`, `${u} updated`, `${results.length - c - u - d} unchanged`];
      if (d > 0) parts.push(pc.yellow(`${d} divergent (kept)`));
      logger.success(`${label}: ${parts.join(", ")}`);
      for (const r of results.filter((x) => x.action === "skipped-divergent")) {
        logger.dim(
          `    ~ ${r.skill}: differs from colony — kept target copy (use --force to overwrite)`,
        );
      }
    }
  }

  if (!quiet) {
    console.log("");
    logger.success(`adopt complete: ${created} added, ${updated} updated across harness dirs.`);
    if (divergent > 0) {
      logger.warn(
        `${divergent} skill(s) differ from the colony and were left as-is. Re-run with --force to overwrite them with the colony version.`,
      );
    }
    logger.dim("Non-colony skills in each dir were left untouched.");
  }
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
  let blockedCount = 0;
  let removalFailedCount = 0;

  for (const harness of harnesses) {
    const profile = HARNESSES[harness];
    const mirrorAbs = resolve(cwd, profile.skillsDir);

    // Guard: only remove symlinks by default. Real directories require explicit force,
    // UNLESS the sync-state records this as a managed COPY mirror (skdd created it).
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
          removalFailedCount++;
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
          removalFailedCount++;
          continue;
        }
      } else {
        // Real directory without force — check if this is a skdd-managed COPY mirror.
        const mirrorEntry = state.mirrors.find((m) => resolve(cwd, m.target) === mirrorAbs);
        if (mirrorEntry?.mode === "copy") {
          // Managed copy-mode mirror: skdd created it, safe to remove.
          try {
            rmSync(mirrorAbs, { recursive: true, force: true });
            if (!quiet) logger.success(`Unlinked ${profile.skillsDir} (copy-mode mirror)`);
          } catch (err) {
            if (!quiet)
              logger.warn(`Could not remove ${profile.skillsDir}: ${(err as Error).message}`);
            removalFailedCount++;
            continue;
          }
        } else {
          // Unmanaged real directory — refuse to delete user data.
          if (!quiet) {
            logger.warn(
              `${profile.skillsDir} is a real directory (not a skdd-managed mirror) — skipping. Pass --force to remove.`,
            );
          }
          blockedCount++;
          continue;
        }
      }
    } else {
      if (!quiet) logger.dim(`${profile.skillsDir} already absent`);
    }

    // Remove mirror entry from state
    removeMirror(state, profile.skillsDir);
  }

  saveState(cwd, state);
  return blockedCount > 0 || removalFailedCount > 0 ? 1 : 0;
}
