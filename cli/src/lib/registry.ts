import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { SkillStatus } from "./spec.js";

export interface RegistryEntry {
  name: string;
  source: string; // "local", "bundled", "forked:<project>", etc.
  path?: string; // relative path to SKILL.md
  lastUsed?: string;
  uses?: number;
  description: string;
  status?: SkillStatus;
}

export interface Registry {
  colony?: { name: string; version: string };
  skills: RegistryEntry[];
  archived: RegistryEntry[];
}

const REGISTRY_MD = ".skills-registry.md";
const REGISTRY_JSON = ".skills-registry.json";

export function resolveRegistryPath(cwd: string, format: "md" | "json" = "md"): string {
  return join(resolve(cwd), format === "md" ? REGISTRY_MD : REGISTRY_JSON);
}

export function registryExists(cwd: string): { md: boolean; json: boolean } {
  return {
    md: existsSync(resolveRegistryPath(cwd, "md")),
    json: existsSync(resolveRegistryPath(cwd, "json")),
  };
}

/** Parse a `.skills-registry.md` file into structured entries. */
export function parseMarkdownRegistry(source: string): Registry {
  const lines = source.split(/\r?\n/);
  const skills: RegistryEntry[] = [];
  const archived: RegistryEntry[] = [];

  let section: "available" | "archived" | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (/^##\s+Available Skills/i.test(trimmed)) {
      section = "available";
      continue;
    }
    if (/^##\s+Archived/i.test(trimmed)) {
      section = "archived";
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      section = null;
      continue;
    }

    if (!section) continue;
    if (!trimmed.startsWith("|")) continue;
    // Skip table header and separator rows
    if (/\|\s*-+\s*\|/.test(trimmed)) continue;
    if (/\|\s*Skill\s*\|/i.test(trimmed)) continue;

    const cells = splitTableRow(trimmed);
    if (cells.length < 2) continue;

    if (section === "available") {
      if (cells.length < 5) continue;
      const [name, source, lastUsed, uses, description] = cells;
      skills.push({
        name: name!.trim(),
        source: source!.trim(),
        lastUsed: lastUsed?.trim() || undefined,
        uses: Number.parseInt(uses ?? "0", 10) || 0,
        description: description!.trim(),
      });
    } else if (section === "archived") {
      // Archived table shape: | Skill | Archived | Reason |
      if (cells.length < 3) continue;
      const [name, lastUsed, description] = cells;
      archived.push({
        name: name!.trim(),
        source: "archived",
        lastUsed: lastUsed?.trim() || undefined,
        description: description!.trim(),
        status: "archived",
      });
    }
  }

  return { skills, archived };
}

function splitTableRow(row: string): string[] {
  const trimmed = row.replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

/** Serialize a Registry back to markdown. Stable ordering: skills as given, archived as given. */
export function writeMarkdownRegistry(registry: Registry, projectName?: string): string {
  const title = projectName ? `# Skills Registry — ${projectName}` : "# Skills Registry";
  const lines: string[] = [
    title,
    "",
    "> Auto-maintained. Agents update this when skills are created, used, or evolved.",
    "",
    "## Available Skills",
    "",
    "| Skill | Source | Last Used | Uses | Description |",
    "|-------|--------|-----------|------|-------------|",
  ];

  for (const s of registry.skills) {
    lines.push(
      `| ${s.name} | ${s.source} | ${s.lastUsed ?? ""} | ${s.uses ?? 0} | ${s.description} |`,
    );
  }

  if (registry.archived.length > 0) {
    lines.push("", "## Archived", "", "| Skill | Archived | Reason |", "|-------|----------|--------|");
    for (const a of registry.archived) {
      lines.push(`| ${a.name} | ${a.lastUsed ?? ""} | ${a.description} |`);
    }
  }

  lines.push(""); // trailing newline
  return lines.join("\n");
}

export interface ColonyManifestJson {
  schema: string;
  colony: { name: string; version: string };
  skills: RegistryEntry[];
  archived: RegistryEntry[];
}

export function parseJsonRegistry(source: string): Registry {
  const data = JSON.parse(source) as Partial<ColonyManifestJson>;
  return {
    colony: data.colony,
    skills: data.skills ?? [],
    archived: data.archived ?? [],
  };
}

export function writeJsonRegistry(registry: Registry, colonyName = "colony", version = "0.1.0"): string {
  const manifest: ColonyManifestJson = {
    schema: "https://agentskills.io/registry/v1.json",
    colony: registry.colony ?? { name: colonyName, version },
    skills: registry.skills,
    archived: registry.archived,
  };
  return JSON.stringify(manifest, null, 2) + "\n";
}

/** Load the project registry from whichever formats exist (md, json, or empty). */
export function loadRegistry(cwd: string): Registry {
  const mdPath = resolveRegistryPath(cwd, "md");
  const jsonPath = resolveRegistryPath(cwd, "json");
  if (existsSync(jsonPath)) {
    return parseJsonRegistry(readFileSync(jsonPath, "utf8"));
  }
  if (existsSync(mdPath)) {
    return parseMarkdownRegistry(readFileSync(mdPath, "utf8"));
  }
  return { skills: [], archived: [] };
}

/** Append a new entry to the registry on disk, syncing both formats if both exist. */
export function addRegistryEntry(
  cwd: string,
  entry: RegistryEntry,
  opts: { projectName?: string } = {},
): void {
  const registry = loadRegistry(cwd);
  // De-dupe: replace existing entry with same name
  registry.skills = registry.skills.filter((s) => s.name !== entry.name);
  registry.skills.push(entry);

  const mdPath = resolveRegistryPath(cwd, "md");
  const jsonPath = resolveRegistryPath(cwd, "json");

  ensureDir(dirname(mdPath));
  writeFileSync(mdPath, writeMarkdownRegistry(registry, opts.projectName));
  if (existsSync(jsonPath)) {
    writeFileSync(jsonPath, writeJsonRegistry(registry, opts.projectName));
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
