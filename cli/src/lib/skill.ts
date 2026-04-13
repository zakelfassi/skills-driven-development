import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import matter from "gray-matter";

export interface SkillFrontmatter {
  name?: unknown;
  description?: unknown;
  license?: unknown;
  compatibility?: unknown;
  metadata?: Record<string, unknown>;
  "allowed-tools"?: unknown;
  [key: string]: unknown;
}

export interface ParsedSkill {
  path: string; // absolute path to SKILL.md
  dir: string; // absolute path to the skill's directory
  dirName: string; // basename of the skill directory
  frontmatter: SkillFrontmatter;
  body: string;
  lineCount: number;
  hasScripts: boolean;
  hasReferences: boolean;
  hasAssets: boolean;
}

export function parseSkill(skillMdPath: string): ParsedSkill {
  const absPath = resolve(skillMdPath);
  if (!existsSync(absPath)) {
    throw new Error(`SKILL.md not found: ${absPath}`);
  }
  const raw = readFileSync(absPath, "utf8");
  const parsed = matter(raw);
  const dir = dirname(absPath);
  const dirName = basename(dir);
  const lineCount = raw.split(/\r?\n/).length;

  return {
    path: absPath,
    dir,
    dirName,
    frontmatter: (parsed.data ?? {}) as SkillFrontmatter,
    body: parsed.content,
    lineCount,
    hasScripts: existsSync(join(dir, "scripts")),
    hasReferences: existsSync(join(dir, "references")),
    hasAssets: existsSync(join(dir, "assets")),
  };
}

/**
 * Recursively walk a directory and yield every SKILL.md path found.
 * Skips common noise directories (node_modules, dist, .git).
 */
export function findSkills(root: string): string[] {
  const results: string[] = [];
  const absRoot = resolve(root);

  if (!existsSync(absRoot)) {
    return results;
  }

  const rootStat = statSync(absRoot);
  if (rootStat.isFile()) {
    if (basename(absRoot) === "SKILL.md") results.push(absRoot);
    return results;
  }

  walk(absRoot, results);
  return results;
}

const IGNORED_DIRS = new Set(["node_modules", "dist", ".git", ".turbo", "build", "coverage", ".next"]);

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      walk(full, out);
    } else if (s.isFile() && entry === "SKILL.md") {
      out.push(full);
    }
  }
}
