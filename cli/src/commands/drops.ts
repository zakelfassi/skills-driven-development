import { fetchCommons, parseSource, readDropsManifest } from "../lib/commons.js";
import { loadConfig } from "../lib/config.js";
import { logger, pc } from "../lib/logger.js";

export interface DropsOptions {
  cwd?: string;
  from?: string;
  format?: "table" | "json";
}

export async function runDrops(opts: DropsOptions = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const from = opts.from ?? loadConfig().commons;

  let fetched: ReturnType<typeof fetchCommons>;
  try {
    fetched = fetchCommons(parseSource(from, cwd));
  } catch (err) {
    logger.error((err as Error).message);
    return 1;
  }

  try {
    const manifest = readDropsManifest(fetched.dir);

    if (opts.format === "json") {
      console.log(JSON.stringify({ source: fetched.source.label, drops: manifest.drops }, null, 2));
      return 0;
    }

    if (manifest.drops.length === 0) {
      logger.warn(`${fetched.source.label} has no drops yet.`);
      return 0;
    }

    logger.heading(`Drops — ${fetched.source.label}`);
    const rows = manifest.drops.map((d) => [
      d.id,
      d.title,
      d.date,
      String(d.skills.length),
      d.story ?? "—",
    ]);
    printTable(["Drop", "Title", "Date", "Skills", "Story"], rows);
    console.log("");
    logger.dim(`Install one: skdd add ${fetched.source.label} <drop-id>`);
    return 0;
  } catch (err) {
    logger.error((err as Error).message);
    return 1;
  } finally {
    fetched.cleanup();
  }
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0)));
  const pad = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join(" │ ");
  console.log(pc.bold(pad(headers)));
  console.log(widths.map((w) => "─".repeat(w)).join("─┼─"));
  for (const row of rows) console.log(pad(row));
}
