import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import matter from "gray-matter";
import { logger, pc } from "../lib/logger.js";
import { HARNESSES } from "../lib/harness.js";
import { findSkills } from "../lib/skill.js";
import { runLink } from "./link.js";

export interface ImportOptions {
  cwd?: string;
  json?: boolean;
  apply?: boolean;
  canonical?: string;
  skipLink?: boolean;
}

interface ImportEntry {
  absPath: string;
  relPath: string;
  hash: string;
  skillName: string | null;
  origin: string; // "canonical" | harness id
}

interface DuplicateGroup {
  hash: string;
  skillName: string | null;
  entries: ImportEntry[];
}

interface NameCollisionVariant {
  hash: string;
  paths: string[];
}

interface NameCollision {
  name: string;
  variants: NameCollisionVariant[];
}

interface ImportReport {
  root: string;
  canonical: string;
  scanned: Array<{ dir: string; origin: string; skillCount: number }>;
  totalSkills: number;
  uniqueByHash: number;
  duplicates: DuplicateGroup[];
  nameCollisions: NameCollision[];
}

export async function runImport(
  target: string | undefined,
  opts: ImportOptions = {},
): Promise<number> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const root = target ? resolve(cwd, target) : cwd;

  if (!existsSync(root)) {
    logger.error(`Target directory does not exist: ${target ?? root}`);
    return 1;
  }

  const canonical = opts.canonical ?? detectCanonicalFromColony(root) ?? "skills";
  const report = scanForSkills(root, canonical);

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }

  if (!opts.apply) return 0;
  return applyConsolidation(root, report, opts);
}

function detectCanonicalFromColony(root: string): string | null {
  const p = join(root, ".colony.json");
  if (!existsSync(p)) return null;
  try {
    const manifest = JSON.parse(readFileSync(p, "utf8")) as { canonicalSkillsDir?: string };
    if (typeof manifest.canonicalSkillsDir === "string" && manifest.canonicalSkillsDir.length > 0) {
      return manifest.canonicalSkillsDir;
    }
  } catch {
    // ignore malformed .colony.json — doctor reports it separately
  }
  return null;
}

function scanForSkills(root: string, canonical: string): ImportReport {
  const dirsToScan: Array<{ dir: string; origin: string }> = [];
  const seenRealpaths = new Set<string>();

  const add = (dir: string, origin: string) => {
    if (!existsSync(dir)) return;
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      real = dir;
    }
    if (seenRealpaths.has(real)) return; // symlink mirror pointing at canonical — already counted
    seenRealpaths.add(real);
    dirsToScan.push({ dir, origin });
  };

  // Canonical first so it wins realpath dedup over any symlinked mirror.
  add(join(root, canonical), "canonical");
  for (const profile of Object.values(HARNESSES)) {
    add(join(root, profile.skillsDir), profile.id);
  }

  const entries: ImportEntry[] = [];
  const scanned: Array<{ dir: string; origin: string; skillCount: number }> = [];
  for (const { dir, origin } of dirsToScan) {
    const skillPaths = findSkills(dir);
    scanned.push({
      dir: relative(root, dir) || dir,
      origin,
      skillCount: skillPaths.length,
    });
    for (const p of skillPaths) {
      const content = readFileSync(p, "utf8");
      const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
      let skillName: string | null = null;
      try {
        const parsed = matter(content);
        if (typeof parsed.data?.name === "string") skillName = parsed.data.name;
      } catch {
        // ignore — parsing failures are a validation concern, not an import concern
      }
      entries.push({
        absPath: p,
        relPath: relative(root, p),
        hash,
        skillName,
        origin,
      });
    }
  }

  // Duplicate groups: same content hash, 2+ entries
  const byHash = new Map<string, ImportEntry[]>();
  for (const e of entries) {
    const bucket = byHash.get(e.hash) ?? [];
    bucket.push(e);
    byHash.set(e.hash, bucket);
  }
  const duplicates: DuplicateGroup[] = [];
  for (const [hash, group] of byHash) {
    if (group.length > 1) {
      duplicates.push({ hash, skillName: group[0]!.skillName, entries: group });
    }
  }

  // Name collisions: same frontmatter.name, different content hashes
  const byName = new Map<string, Map<string, ImportEntry[]>>();
  for (const e of entries) {
    if (!e.skillName) continue;
    const sub = byName.get(e.skillName) ?? new Map<string, ImportEntry[]>();
    const bucket = sub.get(e.hash) ?? [];
    bucket.push(e);
    sub.set(e.hash, bucket);
    byName.set(e.skillName, sub);
  }
  const nameCollisions: NameCollision[] = [];
  for (const [name, sub] of byName) {
    if (sub.size <= 1) continue;
    const variants: NameCollisionVariant[] = [];
    for (const [hash, es] of sub) {
      variants.push({ hash, paths: es.map((e) => e.relPath) });
    }
    nameCollisions.push({ name, variants });
  }

  return {
    root,
    canonical,
    scanned,
    totalSkills: entries.length,
    uniqueByHash: byHash.size,
    duplicates,
    nameCollisions,
  };
}

function printHumanReport(report: ImportReport): void {
  logger.heading("skdd import — scan report");
  logger.dim(`root:      ${report.root}`);
  logger.dim(`canonical: ${report.canonical}/`);
  console.log("");

  if (report.scanned.length === 0) {
    logger.warn("No skill directories found.");
    logger.dim(
      `Looked for: ${report.canonical}/, .claude/skills, .codex/skills, .cursor/skills, .github/skills, .gemini/skills, .opencode/skills, .goose/skills, .amp/skills`,
    );
    return;
  }

  console.log(pc.bold("Scanned"));
  for (const s of report.scanned) {
    console.log(`  ${pc.cyan(s.origin.padEnd(10))} ${s.dir || "."} — ${s.skillCount} skill(s)`);
  }
  console.log("");

  console.log(pc.bold("Summary"));
  console.log(`  total SKILL.md files: ${report.totalSkills}`);
  console.log(`  unique content hashes: ${report.uniqueByHash}`);
  console.log(`  duplicate groups: ${report.duplicates.length}`);
  console.log(`  name collisions: ${report.nameCollisions.length}`);
  console.log("");

  if (report.duplicates.length > 0) {
    console.log(pc.bold("Duplicates (same content across locations)"));
    for (const group of report.duplicates) {
      const name = group.skillName ?? pc.dim("(no frontmatter.name)");
      console.log(
        `  ${pc.yellow("!")} ${name} — ${group.entries.length} copies, hash ${group.hash}`,
      );
      for (const e of group.entries) {
        console.log(`      ${pc.dim(`[${e.origin}]`)} ${e.relPath}`);
      }
    }
    console.log("");
  }

  if (report.nameCollisions.length > 0) {
    console.log(pc.bold("Name collisions (same name, different content)"));
    for (const c of report.nameCollisions) {
      console.log(`  ${pc.red("✗")} ${c.name} — ${c.variants.length} variants`);
      for (const v of c.variants) {
        console.log(`      hash ${v.hash}:`);
        for (const p of v.paths) {
          console.log(`        ${p}`);
        }
      }
    }
    console.log("");
    logger.warn("Resolve name collisions before running 'skdd import --apply'.");
    console.log("");
  }

  if (report.duplicates.length === 0 && report.nameCollisions.length === 0) {
    logger.success("No duplicates or name collisions found.");
  }
}

async function applyConsolidation(
  root: string,
  report: ImportReport,
  opts: ImportOptions,
): Promise<number> {
  if (report.nameCollisions.length > 0) {
    logger.error(
      `Cannot --apply: ${report.nameCollisions.length} name collision(s) detected. Resolve them first, then re-run.`,
    );
    return 1;
  }

  const canonicalPath = join(root, report.canonical);
  mkdirSync(canonicalPath, { recursive: true });

  // Re-walk to get the flat entry list. The JSON report only carries duplicates + collisions,
  // so we re-scan to pick up single-source skills that still need migration into canonical.
  const entries = rescanForApply(root, report.canonical);
  const byName = new Map<string, ImportEntry[]>();
  for (const e of entries) {
    if (!e.skillName) continue;
    const bucket = byName.get(e.skillName) ?? [];
    bucket.push(e);
    byName.set(e.skillName, bucket);
  }

  if (!opts.json) {
    console.log("");
    logger.heading("Applying consolidation");
  }

  let moved = 0;
  let removed = 0;
  let skipped = 0;
  for (const [name, es] of byName) {
    // With no name collisions, every entry in this group shares the same hash. So it's
    // either already in canonical (do nothing but clean up harness copies) or needs to
    // be migrated.
    const canonicalEntry = es.find((e) => e.origin === "canonical");
    const destSkillDir = join(canonicalPath, name);

    if (!canonicalEntry) {
      // Migrate: pick the first harness entry, cpSync its whole directory into canonical.
      const source = es[0]!;
      const sourceSkillDir = dirname(source.absPath);
      if (existsSync(destSkillDir)) {
        // Canonical already has a skill with this name but it wasn't in our scan (e.g., the
        // canonical dir doesn't exist yet but was detected via .colony.json). Skip to be safe.
        skipped++;
        if (!opts.json) logger.dim(`  ${name} — already at ${report.canonical}/${name}/, skipping`);
      } else {
        cpSync(sourceSkillDir, destSkillDir, { recursive: true });
        moved++;
        if (!opts.json) logger.success(`  ${name} → ${report.canonical}/${name}/ (migrated from ${source.origin})`);
      }
    }

    // Remove non-canonical copies (harness-dir real directories — symlinks were realpath-deduped).
    for (const e of es) {
      if (e.origin === "canonical") continue;
      const skillDir = dirname(e.absPath);
      try {
        rmSync(skillDir, { recursive: true, force: true });
        removed++;
        if (!opts.json) logger.dim(`    removed ${e.relPath}`);
      } catch (err) {
        logger.warn(`    failed to remove ${e.relPath}: ${(err as Error).message}`);
      }
    }
  }

  if (!opts.json) {
    console.log("");
    logger.success(
      `Consolidation complete: ${moved} migrated, ${removed} duplicate(s) removed${
        skipped > 0 ? `, ${skipped} skipped` : ""
      }.`,
    );
  }

  if (opts.skipLink) return 0;

  if (!opts.json) logger.dim("Running 'skdd link --force' to refresh harness mirrors…");
  // --force is safe here: we just consolidated every skill out of the harness dirs,
  // so whatever's left is either empty or non-skill cruft that the user can recreate.
  const linkCode = await runLink({ cwd: root, quiet: opts.json ?? false, force: true });
  return linkCode;
}

function rescanForApply(root: string, canonical: string): ImportEntry[] {
  // Re-walk the directories and return a flat ImportEntry list.
  // Kept separate from scanForSkills so the JSON report stays small.
  const entries: ImportEntry[] = [];
  const seenRealpaths = new Set<string>();
  const add = (dir: string, origin: string) => {
    if (!existsSync(dir)) return;
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      real = dir;
    }
    if (seenRealpaths.has(real)) return;
    seenRealpaths.add(real);
    for (const p of findSkills(dir)) {
      const content = readFileSync(p, "utf8");
      const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
      let skillName: string | null = null;
      try {
        const parsed = matter(content);
        if (typeof parsed.data?.name === "string") skillName = parsed.data.name;
      } catch {
        // ignore
      }
      entries.push({
        absPath: p,
        relPath: relative(root, p),
        hash,
        skillName,
        origin,
      });
    }
  };
  add(join(root, canonical), "canonical");
  for (const profile of Object.values(HARNESSES)) {
    add(join(root, profile.skillsDir), profile.id);
  }
  return entries;
}
