import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { NAME_MAX_LENGTH, NAME_REGEX } from "./spec.js";

/** A drop entry in a Commons repo's drops.json manifest. */
export interface DropEntry {
  id: string;
  title: string;
  date: string;
  skills: string[];
  story?: string;
  forgedBy?: string;
}

export interface DropsManifest {
  version: number;
  drops: DropEntry[];
}

/** Parsed `skdd add` / `skdd drops` source argument. */
export interface CommonsSource {
  kind: "local" | "git";
  /** Human/registry label: `owner/repo` for GitHub sources, the raw path/URL otherwise. */
  label: string;
  cloneUrl?: string;
  localPath?: string;
  ref?: string;
}

const GITHUB_SHORTHAND = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GIT_URL_PREFIX = /^(?:https?:\/\/|git@|ssh:\/\/)/;

/**
 * Parse a Commons source: GitHub shorthand `owner/repo`, a full git URL, or a
 * local path — each with an optional `#ref` (branch/tag/sha) suffix on git forms.
 */
export function parseSource(raw: string, cwd: string): CommonsSource {
  const toLocal = (p: string, ref?: string): CommonsSource => {
    const localPath = p.startsWith("~")
      ? join(process.env.HOME ?? "", p.slice(1))
      : resolve(cwd, p);
    return { kind: "local", label: p, localPath, ref };
  };

  // A path that exists verbatim wins first — this preserves local paths that
  // legitimately contain a literal '#' (no ref is inferred from them).
  if (existsSync(resolve(cwd, raw))) {
    return toLocal(raw);
  }

  const hashIdx = raw.lastIndexOf("#");
  const ref = hashIdx > 0 ? raw.slice(hashIdx + 1) : undefined;
  const base = hashIdx > 0 ? raw.slice(0, hashIdx) : raw;

  // Local by prefix or on-disk existence — computed AFTER stripping the #ref so
  // e.g. ../commons#feature parses as {local ../commons, ref feature} instead of
  // a nonexistent literal path.
  const baseLooksLocal = base.startsWith(".") || base.startsWith("/") || base.startsWith("~");
  if (baseLooksLocal || existsSync(resolve(cwd, base))) {
    return toLocal(base, ref);
  }

  if (GIT_URL_PREFIX.test(base)) {
    // Try to extract owner/repo from common URL shapes for the label.
    const m = base.match(/[/:]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
    return { kind: "git", label: m?.[1] ?? base, cloneUrl: base, ref };
  }

  if (GITHUB_SHORTHAND.test(base)) {
    return { kind: "git", label: base, cloneUrl: `https://github.com/${base}.git`, ref };
  }

  throw new Error(
    `Unrecognized source '${raw}' — expected owner/repo, a git URL, or a local path.`,
  );
}

export interface FetchedCommons {
  /** Absolute path of the working copy (the local dir itself, or a temp clone). */
  dir: string;
  /** Full commit sha of the fetched state, or null when the source isn't a git repo. */
  sha: string | null;
  /** True when the source was a local git repo with uncommitted changes — the
   *  recorded sha does NOT contain the installed bytes, so provenance is marked. */
  dirty: boolean;
  source: CommonsSource;
  /** Remove the temp clone (no-op for local sources read in place). */
  cleanup: () => void;
}

function git(args: string[], cwd?: string): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    status: res.status ?? 1,
    stdout: (res.stdout ?? "").trim(),
    stderr: (res.stderr ?? "").trim(),
  };
}

/**
 * Materialize a Commons source into a readable directory.
 * Git sources are shallow-cloned into a temp dir (`#ref` tries `--branch` first
 * for branches/tags, then falls back to a full clone + checkout for shas).
 */
export function fetchCommons(source: CommonsSource): FetchedCommons {
  if (source.kind === "local") {
    const dir = source.localPath!;
    if (!existsSync(dir)) {
      throw new Error(`Local source does not exist: ${dir}`);
    }
    // A local source with a #ref must be checked out from a clean clone —
    // never mutate the user's working repo. This also yields honest provenance.
    if (source.ref) {
      const tmp = mkdtempSync(join(tmpdir(), "skdd-commons-"));
      const cleanup = () => rmSync(tmp, { recursive: true, force: true });
      // `--branch <ref>` resolves branches AND tags (a fresh clone of a local
      // repo only has origin/<branch>, so a bare `checkout --detach <branch>`
      // would fail). Fall back to a plain clone + detach for a raw sha.
      let cloned = git(["clone", "--quiet", "--branch", source.ref, dir, tmp]).status === 0;
      if (!cloned) {
        const cl = git(["clone", "--quiet", dir, tmp]);
        if (cl.status !== 0) {
          cleanup();
          throw new Error(`cannot clone local source '${dir}': ${cl.stderr || cl.stdout}`);
        }
        const co = git(["checkout", "--detach", source.ref], tmp);
        if (co.status !== 0) {
          cleanup();
          throw new Error(
            `cannot check out ref '${source.ref}' in '${dir}': ${co.stderr || co.stdout}`,
          );
        }
        cloned = true;
      }
      const rev = git(["rev-parse", "HEAD"], tmp);
      return { dir: tmp, sha: rev.status === 0 ? rev.stdout : null, dirty: false, source, cleanup };
    }
    const rev = git(["rev-parse", "HEAD"], dir);
    // Working-tree read in place: if the repo is dirty, HEAD doesn't contain
    // the bytes we're about to copy, so flag it for provenance.
    const status = git(["status", "--porcelain"], dir);
    const dirty = rev.status === 0 && status.status === 0 && status.stdout.length > 0;
    return {
      dir,
      sha: rev.status === 0 ? rev.stdout : null,
      dirty,
      source,
      cleanup: () => {},
    };
  }

  const tmp = mkdtempSync(join(tmpdir(), "skdd-commons-"));
  const cleanup = () => rmSync(tmp, { recursive: true, force: true });
  const url = source.cloneUrl!;

  let cloned = false;
  if (source.ref) {
    const res = git(["clone", "--depth", "1", "--branch", source.ref, url, tmp]);
    cloned = res.status === 0;
  }
  if (!cloned) {
    const args = source.ref
      ? ["clone", url, tmp] // ref wasn't a branch/tag — full clone, then checkout the sha
      : ["clone", "--depth", "1", url, tmp];
    const res = git(args, undefined);
    if (res.status !== 0) {
      cleanup();
      throw new Error(`git clone failed for ${source.label}: ${res.stderr || res.stdout}`);
    }
    if (source.ref) {
      const co = git(["checkout", "--detach", source.ref], tmp);
      if (co.status !== 0) {
        cleanup();
        throw new Error(`cannot check out ref '${source.ref}': ${co.stderr || co.stdout}`);
      }
    }
  }

  const rev = git(["rev-parse", "HEAD"], tmp);
  return { dir: tmp, sha: rev.status === 0 ? rev.stdout : null, dirty: false, source, cleanup };
}

/** Read and minimally validate a Commons repo's drops.json. */
export function readDropsManifest(dir: string): DropsManifest {
  const p = join(dir, "drops.json");
  if (!existsSync(p)) {
    throw new Error(`No drops.json found — '${dir}' does not look like a SkDD Commons repo.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, "utf8"));
  } catch (err) {
    throw new Error(`Malformed drops.json: ${(err as Error).message}`);
  }
  const manifest = raw as Partial<DropsManifest>;
  if (!Array.isArray(manifest.drops)) {
    throw new Error(`Malformed drops.json: missing "drops" array.`);
  }
  for (const d of manifest.drops) {
    if (typeof d.id !== "string" || !Array.isArray(d.skills)) {
      throw new Error(`Malformed drops.json: each drop needs an "id" and a "skills" array.`);
    }
    assertSafeManifestNames(d);
  }
  return { version: manifest.version ?? 1, drops: manifest.drops as DropEntry[] };
}

/**
 * drops.json comes from an UNTRUSTED repo, and its ids/names become filesystem
 * paths on both the read side (packs/<drop>/<skill>) and the write side
 * (skills/<skill>). Enforce the skill-name grammar before any path is built —
 * it admits no slashes, dots, or absolute paths, so traversal is impossible.
 */
export function assertSafeManifestNames(drop: { id: string; skills: unknown[] }): void {
  if (!NAME_REGEX.test(drop.id) || drop.id.length > NAME_MAX_LENGTH) {
    throw new Error(
      `Unsafe drop id '${drop.id}' in drops.json — ids must be lowercase kebab-case (letters, digits, dashes only).`,
    );
  }
  for (const s of drop.skills) {
    if (typeof s !== "string" || s.length > NAME_MAX_LENGTH || !NAME_REGEX.test(s)) {
      throw new Error(
        `Unsafe skill name '${String(s)}' in drop '${drop.id}' — names must be lowercase kebab-case (letters, digits, dashes only).`,
      );
    }
  }
}

/** Defense-in-depth: assert a resolved path stayed inside its expected root. */
export function assertWithin(child: string, parent: string, label: string): void {
  const rel = relative(resolve(parent), resolve(child));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`${label} resolves outside ${parent} — refusing.`);
  }
}

/**
 * Assert `child`'s REAL path (symlinks resolved) stays inside `parent`'s real
 * path. Catches a symlinked ancestor (e.g. a Commons making `packs/` a symlink)
 * that a plain string containment check would miss.
 */
export function assertRealpathWithin(child: string, parent: string, label: string): void {
  let realChild: string;
  let realParent: string;
  try {
    realParent = realpathSync(parent);
    realChild = realpathSync(child);
  } catch {
    throw new Error(`${label} could not be resolved (dangling symlink?) — refusing.`);
  }
  const rel = relative(realParent, realChild);
  if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) {
    throw new Error(`${label} resolves (via symlink) outside ${parent} — refusing.`);
  }
}

/**
 * Whether `name` is a safe single git branch/ref component: rejects `..`,
 * a trailing `.lock`, control/space/special chars, leading/trailing dots or
 * dashes, and `@{` — matching what `git check-ref-format` would reject, without
 * shelling out.
 */
export function isGitRefComponent(name: string): boolean {
  if (!name || name.length > 200) return false;
  if (name.includes("..") || name.includes("@{")) return false;
  if (name.endsWith(".lock") || name.endsWith(".") || name.endsWith("/")) return false;
  if (name.startsWith(".") || name.startsWith("-") || name.startsWith("/")) return false;
  // No spaces, control chars, or any of the git-forbidden set ~^:?*[\
  // (also excludes '/', keeping this a single component).
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name);
}

export interface ResolvedSelection {
  drop: DropEntry;
  /** Skill names selected within the drop. */
  skills: string[];
}

/**
 * Resolve an `add` selector against a manifest:
 * - `<drop-id>` → every skill in the drop
 * - `<drop-id>/<skill>` → a single skill
 */
export function resolveSelector(manifest: DropsManifest, selector: string): ResolvedSelection {
  const slash = selector.indexOf("/");
  const dropId = slash === -1 ? selector : selector.slice(0, slash);
  const skillName = slash === -1 ? null : selector.slice(slash + 1);

  const drop = manifest.drops.find((d) => d.id === dropId);
  if (!drop) {
    const available = manifest.drops.map((d) => d.id).join(", ") || "(none)";
    throw new Error(`Drop '${dropId}' not found. Available drops: ${available}`);
  }
  if (skillName === null) {
    return { drop, skills: [...drop.skills] };
  }
  if (!drop.skills.includes(skillName)) {
    throw new Error(
      `Skill '${skillName}' is not in drop '${drop.id}'. Its skills: ${drop.skills.join(", ")}`,
    );
  }
  return { drop, skills: [skillName] };
}

/** Registry Source column label for an added skill: `owner/repo@shortsha (drop-id)`.
 *  A dirty local source is marked `@shortsha-dirty` so the sha isn't mistaken
 *  for a commit that actually contains the installed bytes. */
export function provenanceLabel(
  source: CommonsSource,
  sha: string | null,
  dropId: string,
  dirty = false,
): string {
  const shortSha = sha ? `${sha.slice(0, 7)}${dirty ? "-dirty" : ""}` : "local";
  return `${source.label}@${shortSha} (${dropId})`;
}

/** True if `entry` (a file or dir path) is a symlink, or — for a directory —
 *  contains any symlink at any depth. Used to keep symlinked payload out of a
 *  provenance-pinned copy. */
export function treeHasSymlink(entry: string): boolean {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(entry);
  } catch {
    return false;
  }
  if (stat.isSymbolicLink()) return true;
  if (!stat.isDirectory()) return false;
  for (const child of readdirSync(entry)) {
    if (treeHasSymlink(join(entry, child))) return true;
  }
  return false;
}
