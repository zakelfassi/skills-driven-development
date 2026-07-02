import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  type Stats,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { platform } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { dirTreeHash } from "./dir-tree-hash.js";

export type LinkMode = "symlink" | "copy" | "auto";

export type ResolvedLinkMode = "symlink" | "copy";

export type AdoptAction =
  | "created" // skill wasn't in the target dir — copied in
  | "updated" // colony skill existed but differed — refreshed to canonical (force only)
  | "unchanged" // already byte-identical to canonical
  | "skipped-divergent"; // present but differs, and --force not given — left as-is

export interface AdoptSkillResult {
  skill: string;
  action: AdoptAction;
}

/** List immediate subdirectories of `canonicalPath` that are skills (have a SKILL.md). */
function listCanonicalSkills(canonicalPath: string): string[] {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(canonicalPath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && existsSync(join(canonicalPath, e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort();
}

/**
 * Copy the colony's skills INTO an existing (possibly populated) target directory,
 * leaving every non-colony skill in that directory untouched. This is the
 * additive alternative to a whole-directory symlink/copy mirror: it never
 * deletes the target dir and never touches skills that aren't in the colony —
 * so it is safe to run against a harness dir that holds hand-authored skills.
 *
 * Per colony skill:
 *   - absent in target        → copied in                 (created)
 *   - present, byte-identical → left alone                (unchanged)
 *   - present, differs, force → overwritten with canonical (updated)
 *   - present, differs, !force→ left alone + reported     (skipped-divergent)
 */
export function adoptSkills(
  canonicalPath: string,
  targetDir: string,
  opts: EnsureMirrorOptions = {},
): AdoptSkillResult[] {
  const results: AdoptSkillResult[] = [];
  mkdirSync(targetDir, { recursive: true });
  for (const skill of listCanonicalSkills(canonicalPath)) {
    const src = join(canonicalPath, skill);
    const dest = join(targetDir, skill);
    if (!existsSync(dest)) {
      cpSync(src, dest, { recursive: true });
      results.push({ skill, action: "created" });
      continue;
    }
    if (dirTreeHash(dest) === dirTreeHash(src)) {
      results.push({ skill, action: "unchanged" });
      continue;
    }
    if (opts.force) {
      rmSync(dest, { recursive: true, force: true });
      cpSync(src, dest, { recursive: true });
      results.push({ skill, action: "updated" });
    } else {
      results.push({ skill, action: "skipped-divergent" });
    }
  }
  return results;
}

export interface EnsureMirrorOptions {
  /**
   * If true, replace a non-matching target even if it looks like user data
   * (e.g. a non-empty directory that isn't a symlink and isn't byte-identical to the source).
   */
  force?: boolean;
}

export interface EnsureMirrorResult {
  mode: ResolvedLinkMode;
  target: string;
  action: "created" | "repaired" | "unchanged" | "blocked";
  driftDetected: boolean;
  reason?: string;
}

/**
 * Choose the concrete link mode for the current platform.
 * Unix (darwin/linux) → symlink; Windows → copy. `auto` walks this table.
 */
export function resolveLinkMode(requested: LinkMode | undefined): ResolvedLinkMode {
  const mode = requested ?? "auto";
  if (mode === "symlink" || mode === "copy") return mode;
  return platform() === "win32" ? "copy" : "symlink";
}

/**
 * Ensure `target` mirrors `source`. Idempotent.
 *
 * - `symlink` mode: `target` is a symlink pointing at a relative path to `source`.
 * - `copy` mode: `target` is a recursive copy of `source`. Re-running replaces it.
 *
 * Refuses to clobber a non-empty directory that doesn't already look like our mirror
 * unless `force: true`. Returns a structured result so the caller can log cleanly.
 */
export function ensureMirror(
  source: string,
  target: string,
  mode: ResolvedLinkMode,
  opts: EnsureMirrorOptions = {},
): EnsureMirrorResult {
  const absSource = resolve(source);
  const absTarget = resolve(target);
  const parent = dirname(absTarget);

  if (!existsSync(absSource)) {
    return {
      mode,
      target: absTarget,
      action: "blocked",
      driftDetected: false,
      reason: `source does not exist: ${source}`,
    };
  }

  mkdirSync(parent, { recursive: true });

  if (mode === "symlink") {
    return ensureSymlink(absSource, absTarget, parent, opts);
  }
  return ensureCopy(absSource, absTarget, opts);
}

function ensureSymlink(
  absSource: string,
  absTarget: string,
  parent: string,
  opts: EnsureMirrorOptions,
): EnsureMirrorResult {
  const desiredTarget = relative(parent, absSource);
  let targetStat: Stats | null = null;
  try {
    targetStat = lstatSync(absTarget);
  } catch {
    targetStat = null;
  }

  if (!targetStat) {
    symlinkSync(desiredTarget, absTarget, "dir");
    return { mode: "symlink", target: absTarget, action: "created", driftDetected: false };
  }

  if (targetStat.isSymbolicLink()) {
    const currentTarget = readlinkSync(absTarget);
    if (currentTarget === desiredTarget) {
      return { mode: "symlink", target: absTarget, action: "unchanged", driftDetected: false };
    }
    // Symlink points somewhere else — repair.
    // Use unlinkSync so we remove the symlink itself without following it into the
    // (possibly wrong) target directory; rmSync on a directory-symlink trips over
    // Node's "Path is a directory" guard.
    unlinkSync(absTarget);
    symlinkSync(desiredTarget, absTarget, "dir");
    return {
      mode: "symlink",
      target: absTarget,
      action: "repaired",
      driftDetected: true,
      reason: `symlink pointed at '${currentTarget}', expected '${desiredTarget}'`,
    };
  }

  // Target exists and isn't a symlink
  if (!opts.force) {
    return {
      mode: "symlink",
      target: absTarget,
      action: "blocked",
      driftDetected: true,
      reason: `target is a regular ${targetStat.isDirectory() ? "directory" : "file"} — pass --force to replace with a symlink`,
    };
  }
  rmSync(absTarget, { recursive: true, force: true });
  symlinkSync(desiredTarget, absTarget, "dir");
  return {
    mode: "symlink",
    target: absTarget,
    action: "repaired",
    driftDetected: true,
    reason: `replaced pre-existing ${targetStat.isDirectory() ? "directory" : "file"} with a symlink`,
  };
}

function ensureCopy(
  absSource: string,
  absTarget: string,
  opts: EnsureMirrorOptions,
): EnsureMirrorResult {
  let targetStat: Stats | null = null;
  try {
    targetStat = lstatSync(absTarget);
  } catch {
    targetStat = null;
  }

  if (targetStat?.isSymbolicLink()) {
    // Switching from symlink → copy. Always allowed; no user data at risk.
    // unlinkSync to delete the symlink itself (not its target).
    unlinkSync(absTarget);
    cpSync(absSource, absTarget, { recursive: true });
    return {
      mode: "copy",
      target: absTarget,
      action: "repaired",
      driftDetected: true,
      reason: "replaced symlink with file copy",
    };
  }

  if (!targetStat) {
    cpSync(absSource, absTarget, { recursive: true });
    return { mode: "copy", target: absTarget, action: "created", driftDetected: false };
  }

  // Target is a directory with content. We can't easily tell if it's "our" copy or
  // user data. Require --force to overwrite.
  if (!opts.force) {
    return {
      mode: "copy",
      target: absTarget,
      action: "blocked",
      driftDetected: true,
      reason: `target directory already exists — pass --force to overwrite with a fresh copy of '${absSource}'`,
    };
  }
  rmSync(absTarget, { recursive: true, force: true });
  cpSync(absSource, absTarget, { recursive: true });
  return {
    mode: "copy",
    target: absTarget,
    action: "repaired",
    driftDetected: true,
    reason: "replaced pre-existing directory with a fresh copy",
  };
}
