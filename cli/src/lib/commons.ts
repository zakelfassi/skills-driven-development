import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
  // Local path forms first: explicit path prefixes, or a path that exists on disk.
  if (
    raw.startsWith(".") ||
    raw.startsWith("/") ||
    raw.startsWith("~") ||
    existsSync(resolve(cwd, raw))
  ) {
    const localPath = raw.startsWith("~")
      ? join(process.env.HOME ?? "", raw.slice(1))
      : resolve(cwd, raw);
    return { kind: "local", label: raw, localPath };
  }

  const hashIdx = raw.lastIndexOf("#");
  const ref = hashIdx > 0 ? raw.slice(hashIdx + 1) : undefined;
  const base = hashIdx > 0 ? raw.slice(0, hashIdx) : raw;

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
  source: CommonsSource;
  /** Remove the temp clone (no-op for local sources). */
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
    const rev = git(["rev-parse", "HEAD"], dir);
    return {
      dir,
      sha: rev.status === 0 ? rev.stdout : null,
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
  return { dir: tmp, sha: rev.status === 0 ? rev.stdout : null, source, cleanup };
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
  }
  return { version: manifest.version ?? 1, drops: manifest.drops as DropEntry[] };
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

/** Registry Source column label for an added skill: `owner/repo@shortsha (drop-id)`. */
export function provenanceLabel(source: CommonsSource, sha: string | null, dropId: string): string {
  const shortSha = sha ? sha.slice(0, 7) : "local";
  return `${source.label}@${shortSha} (${dropId})`;
}
