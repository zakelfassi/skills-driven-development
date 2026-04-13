import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runValidate } from "./commands/validate.js";
import { runForge } from "./commands/forge.js";
import { runList } from "./commands/list.js";
import { runSync } from "./commands/sync.js";
import { logger } from "./lib/logger.js";
import type { Harness } from "./lib/harness.js";

const VERSION = "0.1.0";

const program = new Command();

program
  .name("skdd")
  .description("Skills-Driven Development CLI — validate, init, forge, list, and sync skill colonies.")
  .version(VERSION);

program
  .command("init")
  .description("Scaffold a SkDD colony in the current project (skills dir, registry, instruction block)")
  .option(
    "-H, --harness <name>",
    "Target harness: claude|codex|cursor|copilot|gemini|opencode|goose|amp|auto",
    "auto",
  )
  .option("-f, --force", "Overwrite existing skillforge stub", false)
  .action(async (opts: { harness: Harness | "auto"; force: boolean }) => {
    const code = await runInit({ harness: opts.harness, force: opts.force });
    process.exit(code);
  });

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
  .description("Forge a new skill: write a SKILL.md skeleton and register it")
  .argument("<name>", "Skill name (kebab-case, ≤64 chars)")
  .option("-d, --from-description <text>", "Skill description (required in non-interactive mode)")
  .option("-n, --non-interactive", "Skip interactive prompts (CI / agent-driven use)", false)
  .option(
    "-H, --harness <name>",
    "Target harness: claude|codex|cursor|copilot|gemini|opencode|goose|amp|auto",
    "auto",
  )
  .option("--forged-by <id>", "Attribution for metadata.forged-by", "skdd-cli")
  .action(
    async (
      name: string,
      opts: {
        fromDescription?: string;
        nonInteractive: boolean;
        harness: Harness | "auto";
        forgedBy: string;
      },
    ) => {
      const code = await runForge(name, {
        fromDescription: opts.fromDescription,
        nonInteractive: opts.nonInteractive,
        harness: opts.harness,
        forgedBy: opts.forgedBy,
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
