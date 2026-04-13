import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runValidate } from "./commands/validate.js";
import { runForge } from "./commands/forge.js";
import { runList } from "./commands/list.js";
import { runSync } from "./commands/sync.js";
import { runLink } from "./commands/link.js";
import { logger } from "./lib/logger.js";
import type { Harness } from "./lib/harness.js";
import type { LinkMode } from "./lib/fs-link.js";

const VERSION = "0.2.0";

const program = new Command();

program
  .name("skdd")
  .description("Skills-Driven Development CLI — validate, init, forge, list, and sync skill colonies.")
  .version(VERSION);

program
  .command("init")
  .description("Scaffold a SkDD colony in the current project (canonical skills/ + harness mirror)")
  .option(
    "-H, --harness <name>",
    "Target harness: claude|codex|cursor|copilot|gemini|opencode|goose|amp|auto",
    "auto",
  )
  .option("-f, --force", "Overwrite existing skillforge stub", false)
  .option(
    "--no-canonical",
    "Use the flat per-harness layout instead of canonical skills/ + symlink mirror",
  )
  .action(
    async (opts: { harness: Harness | "auto"; force: boolean; canonical: boolean }) => {
      const code = await runInit({
        harness: opts.harness,
        force: opts.force,
        canonical: opts.canonical,
      });
      process.exit(code);
    },
  );

program
  .command("validate")
  .description("Validate SKILL.md files against the Agent Skills spec")
  .argument("[paths...]", "Files or directories to validate (defaults to current dir)")
  .option("--strict", "Treat warnings as errors (exit 1 on any issue)", false)
  .action(async (paths: string[], opts: { strict: boolean }) => {
    const code = await runValidate(paths, { strict: opts.strict });
    process.exit(code);
  });

program
  .command("forge")
  .description("Forge a new skill: write a SKILL.md skeleton in skills/, register it, refresh mirrors")
  .argument("<name>", "Skill name (kebab-case, ≤64 chars)")
  .option("-d, --from-description <text>", "Skill description (required in non-interactive mode)")
  .option("-n, --non-interactive", "Skip interactive prompts (CI / agent-driven use)", false)
  .option(
    "-H, --harness <name>",
    "Target harness: claude|codex|cursor|copilot|gemini|opencode|goose|amp|auto",
    "auto",
  )
  .option("--forged-by <id>", "Attribution for metadata.forged-by", "skdd-cli")
  .option("--no-canonical", "Write to the harness-specific dir instead of canonical skills/")
  .option("--skip-link", "Skip the post-forge mirror refresh (canonical mode only)", false)
  .action(
    async (
      name: string,
      opts: {
        fromDescription?: string;
        nonInteractive: boolean;
        harness: Harness | "auto";
        forgedBy: string;
        canonical: boolean;
        skipLink: boolean;
      },
    ) => {
      const code = await runForge(name, {
        fromDescription: opts.fromDescription,
        nonInteractive: opts.nonInteractive,
        harness: opts.harness,
        forgedBy: opts.forgedBy,
        canonical: opts.canonical,
        skipLink: opts.skipLink,
      });
      process.exit(code);
    },
  );

program
  .command("link")
  .description("Sync canonical skills/ into harness-specific mirrors (.claude/skills, etc.)")
  .option("-m, --mode <mode>", "Link mode: symlink|copy|auto (default: auto — symlink on Unix, copy on Windows)", "auto")
  .option(
    "-H, --harness <list>",
    "Comma-separated harness list; defaults to every harness detected in the project",
  )
  .option("-f, --force", "Overwrite existing non-matching targets (e.g., a populated directory)", false)
  .option("-q, --quiet", "Suppress per-mirror progress output", false)
  .action(
    async (opts: { mode: LinkMode; harness?: string; force: boolean; quiet: boolean }) => {
      const harnesses = opts.harness
        ? (opts.harness.split(",").map((s) => s.trim()) as Harness[])
        : undefined;
      const code = await runLink({
        mode: opts.mode,
        harnesses,
        force: opts.force,
        quiet: opts.quiet,
      });
      process.exit(code);
    },
  );

program
  .command("list")
  .description("List skills in the current colony")
  .option("-f, --format <fmt>", "Output format: table|json", "table")
  .action(async (opts: { format: "table" | "json" }) => {
    const code = await runList({ format: opts.format });
    process.exit(code);
  });

program
  .command("sync")
  .description("Sync skills from a remote colony (not yet implemented)")
  .argument("[url]", "Remote registry URL")
  .action(async (url: string | undefined) => {
    const code = await runSync(url);
    process.exit(code);
  });

program.parseAsync(process.argv).catch((err) => {
  logger.error((err as Error).message);
  process.exit(1);
});
