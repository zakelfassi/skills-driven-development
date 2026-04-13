import { resolve } from "node:path";
import { logger, pc } from "../lib/logger.js";
import { loadRegistry, registryExists } from "../lib/registry.js";

export interface ListOptions {
  cwd?: string;
  format?: "table" | "json";
}

export async function runList(opts: ListOptions = {}): Promise<number> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const has = registryExists(cwd);

  if (!has.md && !has.json) {
    logger.warn("No .skills-registry.md or .skills-registry.json found in the current directory.");
    logger.dim("Run `skdd init` to create one, or cd into a project with a colony.");
    return 1;
  }

  const registry = loadRegistry(cwd);

  if (opts.format === "json") {
    console.log(
      JSON.stringify(
        {
          colony: registry.colony ?? null,
          skills: registry.skills,
          archived: registry.archived,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  // Table view
  if (registry.skills.length === 0) {
    logger.dim("No active skills in the registry.");
  } else {
    logger.heading(`Active skills (${registry.skills.length})`);
    const rows = registry.skills.map((s) => [
      s.name,
      s.source,
      s.lastUsed ?? "—",
      String(s.uses ?? 0),
      truncate(s.description, 60),
    ]);
    printTable(["Skill", "Source", "Last Used", "Uses", "Description"], rows);
  }

  if (registry.archived.length > 0) {
    logger.heading(`Archived skills (${registry.archived.length})`);
    const rows = registry.archived.map((s) => [s.name, s.lastUsed ?? "—", truncate(s.description, 60)]);
    printTable(["Skill", "Archived", "Reason"], rows);
  }

  return 0;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0)));
  const sep = widths.map((w) => "─".repeat(w)).join("─┼─");
  const pad = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join(" │ ");
  console.log(pc.bold(pad(headers)));
  console.log(sep);
  for (const row of rows) console.log(pad(row));
}
