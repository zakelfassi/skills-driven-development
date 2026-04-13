import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { platform } from "node:os";

export type LinkMode = "symlink" | "copy" | "auto";

export type ResolvedLinkMode = "symlink" | "copy";

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
  let targetStat;
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
  let targetStat;
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
