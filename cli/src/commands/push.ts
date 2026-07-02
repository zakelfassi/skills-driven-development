import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { assertSafeManifestNames } from "../lib/commons.js";
import { loadConfig } from "../lib/config.js";
import { ensureGlobalColony, skddHome } from "../lib/global.js";
import { logger } from "../lib/logger.js";
import { parseSkill } from "../lib/skill.js";
import { NAME_REGEX } from "../lib/spec.js";

export interface PushOptions {
  cwd?: string;
  global?: boolean;
  /** Target Commons: `owner/repo`, or a local repo path (dry-run and tests). */
  to?: string;
  /** Existing drop id a NEW skill should join (updates drops.json in the PR). */
  drop?: string;
  dryRun?: boolean;
}

interface PushItem {
  name: string;
  localDir: string;
  /** Stripped SKILL.md content that will travel upstream. */
  content: string;
  description: string;
  forgedReason: string;
  /** Drop that already contains this skill upstream, or null when it's new. */
  upstreamDrop: string | null;
  /** Repo-relative destination directory in the Commons. */
  destDir: string;
  diffSummary: string | null;
  /** Allowlisted payload that travels (paths relative to the skill dir). */
  files: string[];
  /** Local files that will NOT travel, with the reason. */
  skipped: string[];
}

interface PlannedPr {
  repo: string;
  branch: string;
  title: string;
  body: string;
  items: PushItem[];
  updatesManifest: boolean;
}

export async function runPush(target: string, opts: PushOptions = {}): Promise<number> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const colonyRoot = opts.global ? skddHome() : cwd;
  if (opts.global) ensureGlobalColony();
  const canonicalDir = join(colonyRoot, "skills");

  // ── locate what we're pushing: one skill dir, or every skill in a pack ─────
  const skillDirs: Array<{ name: string; dir: string }> = [];
  const directDir = join(canonicalDir, target);
  if (existsSync(join(directDir, "SKILL.md"))) {
    // Guard BEFORE any read: parseSkill/readFileSync follow symlinks, so a
    // symlinked skill dir or SKILL.md must be rejected up front — otherwise a
    // pointer at an ssh key or /etc/passwd gets dereferenced into memory.
    if (skillDirIsSymlinked(directDir)) {
      logger.error(
        `'${target}' is (or its SKILL.md is) a symlink — refusing to push linked content. Replace it with a real file to share it.`,
      );
      return 1;
    }
    skillDirs.push({ name: target, dir: directDir });
  } else if (existsSync(canonicalDir)) {
    for (const entry of readdirSync(canonicalDir)) {
      const dir = join(canonicalDir, entry);
      const skillMd = join(dir, "SKILL.md");
      if (!statSync(dir).isDirectory() || !existsSync(skillMd)) continue;
      // Skip symlinked skills during pack discovery so they are never read.
      // A canonical skills/ entry should be a real dir; a symlink here is
      // suspicious (mirrors point the other way), so exclude and warn.
      if (skillDirIsSymlinked(dir)) {
        logger.warn(`Skipping '${entry}' from pack push — it is a symlink, not a real skill dir.`);
        continue;
      }
      try {
        const parsed = parseSkill(skillMd);
        if (
          (parsed.frontmatter.metadata as Record<string, unknown> | undefined)?.["pack"] === target
        ) {
          skillDirs.push({ name: entry, dir });
        }
      } catch {
        // unparseable skills can't be pushed; skip
      }
    }
  }
  if (skillDirs.length === 0) {
    logger.error(
      `'${target}' is neither a skill in ${canonicalDir} nor a pack id any local skill belongs to.`,
    );
    return 1;
  }

  // ── resolve the target Commons ─────────────────────────────────────────────
  const toRaw = opts.to ?? loadConfig().commons;
  const localTarget = resolveLocalTarget(toRaw, cwd);
  const isLocalTarget = localTarget !== null;

  if (!isLocalTarget && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(toRaw)) {
    logger.error(`--to must be owner/repo or a local Commons path (got '${toRaw}').`);
    return 1;
  }

  if (!isLocalTarget && !ghAvailable()) {
    logger.error(
      "`skdd push` needs the GitHub CLI (`gh`) installed and authenticated to read the target repo and open the PR.",
    );
    logger.dim("Install: https://cli.github.com — then `gh auth login` and re-run.");
    return 1;
  }

  // ── read the upstream manifest to classify each skill (new vs evolve) ──────
  let upstream: { manifest: UpstreamManifest; readFile: (path: string) => string | null };
  try {
    upstream = isLocalTarget ? localUpstream(localTarget) : remoteUpstream(toRaw);
  } catch (err) {
    logger.error(`Cannot read the target Commons (${toRaw}): ${(err as Error).message}`);
    return 1;
  }

  if (opts.drop && !upstream.manifest.drops.some((d) => d.id === opts.drop)) {
    logger.error(
      `--drop '${opts.drop}' does not exist upstream. Existing drops: ${upstream.manifest.drops.map((d) => d.id).join(", ")}. Creating drops is a maintainer act.`,
    );
    return 1;
  }

  const items: PushItem[] = [];
  for (const { name, dir } of skillDirs) {
    // The name becomes a path segment in the Commons clone — hold local dirs
    // to the same grammar the manifest is held to.
    if (!NAME_REGEX.test(name)) {
      logger.error(
        `'${name}' is not a valid skill name (lowercase kebab-case) — refusing to push.`,
      );
      return 1;
    }
    // Defense in depth: discovery already rejected symlinks, but re-check here
    // so no future refactor can slip a dereferenced skill past the guard.
    if (skillDirIsSymlinked(dir)) {
      logger.error(
        `'${name}' is (or its SKILL.md is) a symlink — refusing to push linked content. Replace it with a real file to share it.`,
      );
      return 1;
    }
    const raw = readFileSync(join(dir, "SKILL.md"), "utf8");
    const content = stripMachineLocalMetadata(raw);
    const payload = collectPublishablePayload(dir);
    const parsed = parseSkill(join(dir, "SKILL.md"));
    const meta = (parsed.frontmatter.metadata ?? {}) as Record<string, unknown>;
    const upstreamDrop = upstream.manifest.drops.find((d) => d.skills.includes(name))?.id ?? null;
    const destDir = upstreamDrop
      ? `packs/${upstreamDrop}/${name}`
      : opts.drop
        ? `packs/${opts.drop}/${name}`
        : `incoming/${name}`;
    let diffSummary: string | null = null;
    if (upstreamDrop) {
      const upstreamContent = upstream.readFile(`packs/${upstreamDrop}/${name}/SKILL.md`);
      if (upstreamContent !== null) diffSummary = summarizeDiff(upstreamContent, content);
    }
    items.push({
      name,
      localDir: dir,
      content,
      description: String(parsed.frontmatter.description ?? ""),
      forgedReason: String(meta["forged-reason"] ?? ""),
      upstreamDrop,
      destDir,
      diffSummary,
      files: payload.files,
      skipped: payload.skipped,
    });
  }

  const pr = buildPr(toRaw, target, items, opts);

  // ── dry run: print the would-be PR, write nothing ──────────────────────────
  if (opts.dryRun) {
    logger.heading("skdd push — dry run");
    logger.dim(`target repo: ${pr.repo}`);
    logger.dim(`branch:      ${pr.branch}`);
    console.log("");
    for (const item of pr.items) {
      logger.info(
        `  ${item.upstreamDrop ? "evolve" : "new"}: ${item.name} → ${item.destDir}/SKILL.md`,
      );
      for (const f of item.files) logger.dim(`      travels: ${f}`);
      for (const s of item.skipped) logger.dim(`      stays home: ${s}`);
    }
    console.log("");
    logger.info(`PR title: ${pr.title}`);
    console.log(`\n${pr.body}`);
    logger.dim("\nNo network writes (--dry-run).");
    return 0;
  }

  if (isLocalTarget) {
    logger.error(
      "A local --to target supports --dry-run only. Point --to at owner/repo to open a real PR.",
    );
    return 1;
  }

  return openPr(toRaw, pr, opts);
}

// ── upstream readers ──────────────────────────────────────────────────────────

interface UpstreamManifest {
  drops: Array<{ id: string; skills: string[] }>;
}

function resolveLocalTarget(to: string, cwd: string): string | null {
  if (to.includes("://") || to.startsWith("git@")) return null;
  const abs = resolve(cwd, to);
  // owner/repo shorthand would only collide with a real dir containing drops.json
  return existsSync(join(abs, "drops.json")) ? abs : null;
}

function localUpstream(dir: string): {
  manifest: UpstreamManifest;
  readFile: (path: string) => string | null;
} {
  const manifest = JSON.parse(readFileSync(join(dir, "drops.json"), "utf8")) as UpstreamManifest;
  // The upstream manifest is untrusted input and its ids feed destDir paths.
  for (const d of manifest.drops) assertSafeManifestNames(d);
  return {
    manifest,
    readFile: (path: string) => {
      const p = join(dir, path);
      return existsSync(p) ? readFileSync(p, "utf8") : null;
    },
  };
}

function remoteUpstream(repo: string): {
  manifest: UpstreamManifest;
  readFile: (path: string) => string | null;
} {
  const readFile = (path: string): string | null => {
    const res = gh(["api", `repos/${repo}/contents/${path}`, "--jq", ".content"]);
    if (res.status !== 0) return null;
    return Buffer.from(res.stdout.trim(), "base64").toString("utf8");
  };
  const raw = readFile("drops.json");
  if (raw === null) {
    throw new Error("no readable drops.json — is it a SkDD Commons repo you can access?");
  }
  const manifest = JSON.parse(raw) as UpstreamManifest;
  for (const d of manifest.drops) assertSafeManifestNames(d);
  return { manifest, readFile };
}

// ── PR assembly ───────────────────────────────────────────────────────────────

function buildPr(repo: string, target: string, items: PushItem[], opts: PushOptions): PlannedPr {
  const single = items.length === 1 ? items[0]! : null;
  const isEvolve = single ? single.upstreamDrop !== null : false;
  const branch = single ? `${isEvolve ? "evolve" : "skill"}/${single.name}` : `pack/${target}`;
  const title = single
    ? isEvolve
      ? `evolve(${single.name}): ${truncate(single.description, 60)}`
      : `skill(${single.name}): ${truncate(single.description, 60)}`
    : `pack(${target}): push ${items.length} skills`;

  const sections: string[] = [];
  for (const item of items) {
    if (items.length > 1) sections.push(`## ${item.name}`);
    if (item.upstreamDrop) {
      sections.push(`Evolution of \`${item.name}\` in drop \`${item.upstreamDrop}\`.`);
      if (item.diffSummary) sections.push(`**Diff summary:** ${item.diffSummary}`);
      sections.push(`### The edge case\n\n<!-- what the skill missed in the wild -->`);
    } else {
      sections.push(
        `## Why this skill\n\n${item.forgedReason || "<!-- forged-reason missing -->"}`,
      );
      sections.push(`## Summary\n\n${item.description}`);
      sections.push(
        item.destDir.startsWith("incoming/")
          ? `## Proposed drop\n\nmaintainer triage (no --drop given; lands in \`incoming/\`)`
          : `## Proposed drop\n\n\`${item.destDir.split("/")[1]}\``,
      );
    }
  }
  sections.push(
    `---\n*Opened by \`skdd push\` — machine-local state (usage-count, last-used) stripped; \`forged-*\` provenance preserved.*`,
  );

  return {
    repo,
    branch,
    title,
    body: sections.join("\n\n"),
    items,
    updatesManifest: items.some((i) => !i.upstreamDrop && opts.drop !== undefined),
  };
}

function truncate(s: string, max: number): string {
  const firstSentence = s.split(/(?<=\.)\s/)[0] ?? s;
  return firstSentence.length > max ? `${firstSentence.slice(0, max - 1)}…` : firstSentence;
}

/**
 * Machine-local state stays home: usage-count resets, last-used is dropped.
 * Line-based on purpose — gray-matter round-trips would reformat the YAML.
 */
export function stripMachineLocalMetadata(raw: string): string {
  return raw.replace(/^(\s*usage-count:\s*).+$/m, `$1"0"`).replace(/^\s*last-used:.*\r?\n/m, "");
}

/**
 * True if the skill directory itself, or its SKILL.md, is a symlink.
 * `readFileSync`/`parseSkill`/`cpSync` all follow symlinks, so a symlinked
 * skill would exfiltrate whatever it points at (ssh keys, /etc/passwd) into a
 * public PR. Must run BEFORE any read of the skill.
 */
function skillDirIsSymlinked(dir: string): boolean {
  if (lstatSync(dir).isSymbolicLink()) return true;
  const skillMd = join(dir, "SKILL.md");
  return existsSync(skillMd) && lstatSync(skillMd).isSymbolicLink();
}

// Only the spec-defined skill payload travels upstream. Everything else in the
// skill dir — dotfiles, logs, local notes, .env, symlinks — stays home: push is
// a SHARING command and must never exfiltrate machine-local files.
const PUBLISHABLE_SUBDIRS = new Set(["scripts", "references", "assets"]);

export function collectPublishablePayload(skillDir: string): {
  files: string[];
  skipped: string[];
} {
  if (lstatSync(join(skillDir, "SKILL.md")).isSymbolicLink()) {
    throw new Error(`${skillDir}/SKILL.md is a symlink — linked content is not publishable`);
  }
  const files: string[] = ["SKILL.md"];
  const skipped: string[] = [];

  const walk = (rel: string) => {
    for (const entry of readdirSync(join(skillDir, rel))) {
      const relPath = join(rel, entry);
      const stat = lstatSync(join(skillDir, relPath));
      if (stat.isSymbolicLink()) {
        skipped.push(`${relPath} (symlink)`);
      } else if (entry.startsWith(".")) {
        skipped.push(`${relPath}${stat.isDirectory() ? "/" : ""} (dotfile)`);
      } else if (stat.isDirectory()) {
        walk(relPath);
      } else {
        files.push(relPath);
      }
    }
  };

  for (const entry of readdirSync(skillDir)) {
    if (entry === "SKILL.md") continue;
    const stat = lstatSync(join(skillDir, entry));
    if (stat.isSymbolicLink()) {
      skipped.push(`${entry} (symlink)`);
    } else if (entry.startsWith(".")) {
      skipped.push(`${entry}${stat.isDirectory() ? "/" : ""} (dotfile)`);
    } else if (stat.isDirectory() && PUBLISHABLE_SUBDIRS.has(entry)) {
      walk(entry);
    } else {
      skipped.push(
        `${entry}${stat.isDirectory() ? "/" : ""} (outside SKILL.md + scripts/references/assets)`,
      );
    }
  }
  return { files, skipped };
}

/** Dependency-free diff stat between two SKILL.md revisions. */
export function summarizeDiff(before: string, after: string): string {
  const beforeLines = new Set(before.split(/\r?\n/));
  const afterLines = new Set(after.split(/\r?\n/));
  let added = 0;
  let removed = 0;
  for (const l of afterLines) if (!beforeLines.has(l)) added++;
  for (const l of beforeLines) if (!afterLines.has(l)) removed++;
  return `~${added} line(s) added, ~${removed} removed`;
}

// ── real PR flow (gh required) ────────────────────────────────────────────────

function gh(args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("gh", args, { encoding: "utf8" });
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

function ghAvailable(): boolean {
  return gh(["auth", "status"]).status === 0;
}

function git(args: string[], cwd?: string): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function openPr(repo: string, pr: PlannedPr, opts: PushOptions): number {
  const owner = repo.split("/")[0]!;
  const login = gh(["api", "user", "--jq", ".login"]).stdout.trim();
  if (!login) {
    logger.error("Cannot determine the authenticated GitHub user (`gh api user` failed).");
    return 1;
  }

  // Fork unless we own the target repo; a branch on the upstream works then.
  let headRepo = repo;
  if (login !== owner) {
    const fork = gh(["repo", "fork", repo, "--clone=false"]);
    if (fork.status !== 0) {
      logger.error(`Could not fork ${repo}: ${fork.stderr.trim()}`);
      return 1;
    }
    headRepo = `${login}/${repo.split("/")[1]}`;
  }

  const tmp = mkdtempSync(join(tmpdir(), "skdd-push-"));
  try {
    const clone = git(["clone", "--depth", "1", `https://github.com/${repo}.git`, tmp]);
    if (clone.status !== 0) {
      logger.error(`Clone failed: ${clone.stderr.trim()}`);
      return 1;
    }
    git(["checkout", "-b", pr.branch], tmp);

    for (const item of pr.items) {
      const dest = join(tmp, item.destDir);
      // Copy ONLY the allowlisted payload — never the whole local directory.
      for (const rel of item.files) {
        if (rel === "SKILL.md") continue; // written below from the stripped content
        mkdirSync(dirname(join(dest, rel)), { recursive: true });
        copyFileSync(join(item.localDir, rel), join(dest, rel));
      }
      mkdirSync(dest, { recursive: true });
      writeFileSync(join(dest, "SKILL.md"), item.content);
    }
    // A new skill headed for an existing drop must also appear in drops.json,
    // or the Commons' manifest-check job fails the PR on a stray directory.
    if (opts.drop) {
      const manifestPath = join(tmp, "drops.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const drop = manifest.drops.find((d: { id: string }) => d.id === opts.drop);
      for (const item of pr.items) {
        if (!item.upstreamDrop && !drop.skills.includes(item.name)) drop.skills.push(item.name);
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }

    git(["add", "-A"], tmp);
    const commit = git(["commit", "-m", pr.title], tmp);
    if (commit.status !== 0) {
      logger.error(`Nothing to push — the Commons already has this exact content.`);
      return 1;
    }
    const pushRemote = headRepo === repo ? "origin" : `https://github.com/${headRepo}.git`;
    const push = git(["push", "-u", pushRemote, pr.branch], tmp);
    if (push.status !== 0) {
      logger.error(`git push failed: ${push.stderr.trim()}`);
      return 1;
    }

    const head = headRepo === repo ? pr.branch : `${login}:${pr.branch}`;
    const create = gh([
      "pr",
      "create",
      "--repo",
      repo,
      "--head",
      head,
      "--title",
      pr.title,
      "--body",
      pr.body,
    ]);
    if (create.status !== 0) {
      logger.error(`gh pr create failed: ${create.stderr.trim()}`);
      return 1;
    }
    logger.success(`PR opened: ${create.stdout.trim()}`);
    return 0;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
