import { Command } from "commander";
import { runDoctor } from "./commands/doctor.js";
import { runForge } from "./commands/forge.js";
import { runHub } from "./commands/hub.js";
import { runImport } from "./commands/import.js";
import { runInit } from "./commands/init.js";
import { runLink } from "./commands/link.js";
import { runList } from "./commands/list.js";
import { runMcpAdd, runMcpList, runMcpRemove, runMcpSync } from "./commands/mcp.js";
import { runShow } from "./commands/show.js";
import { runValidate } from "./commands/validate.js";
import type { LinkMode } from "./lib/fs-link.js";
import type { Harness } from "./lib/harness.js";
import { logger } from "./lib/logger.js";
import type { McpHostId } from "./lib/mcp/schema.js";
import { parseShellArgs } from "./lib/parse-shell-args.js";

declare const __SKDD_VERSION__: string;
const VERSION = typeof __SKDD_VERSION__ !== "undefined" ? __SKDD_VERSION__ : "0.0.0-dev";

const program = new Command();

program
  .name("skdd")
  .description(
    "Skills-Driven Development CLI — validate, init, forge, list, show, link, doctor, and import skill colonies.",
  )
  .version(VERSION);

program
  .command("init")
  .description("Scaffold a SkDD colony in the current project (canonical skills/ + harness mirror)")
  .option(
    "-H, --harness <name>",
    "Target harness: claude|codex|cursor|copilot|gemini|opencode|goose|amp|droid|auto",
    "auto",
  )
  .option("-f, --force", "Overwrite existing skillforge stub", false)
  .option(
    "--no-canonical",
    "Use the flat per-harness layout instead of canonical skills/ + symlink mirror",
  )
  .option(
    "-g, --global",
    "Initialize the global colony at ~/.skdd/ (links to all found harness dirs)",
  )
  .action(
    async (opts: {
      harness: Harness | "auto";
      force: boolean;
      canonical: boolean;
      global: boolean;
    }) => {
      const code = await runInit({
        harness: opts.harness,
        force: opts.force,
        canonical: opts.canonical,
        global: opts.global,
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
  .description(
    "Forge a new skill: write a SKILL.md skeleton in skills/, register it, refresh mirrors",
  )
  .argument("<name>", "Skill name (kebab-case, ≤64 chars)")
  .option("-d, --from-description <text>", "Skill description (required in non-interactive mode)")
  .option("-n, --non-interactive", "Skip interactive prompts (CI / agent-driven use)", false)
  .option(
    "-H, --harness <name>",
    "Target harness: claude|codex|cursor|copilot|gemini|opencode|goose|amp|droid|auto",
    "auto",
  )
  .option("--forged-by <id>", "Attribution for metadata.forged-by", "skdd-cli")
  .option("--no-canonical", "Write to the harness-specific dir instead of canonical skills/")
  .option("--skip-link", "Skip the post-forge mirror refresh (canonical mode only)", false)
  .option("-g, --global", "Forge into the global colony (~/.skdd/skills/) instead of the project")
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
        global: boolean;
      },
    ) => {
      const code = await runForge(name, {
        fromDescription: opts.fromDescription,
        nonInteractive: opts.nonInteractive,
        harness: opts.harness,
        forgedBy: opts.forgedBy,
        canonical: opts.canonical,
        skipLink: opts.skipLink,
        global: opts.global,
      });
      process.exit(code);
    },
  );

program
  .command("link")
  .description("Sync canonical skills/ into harness-specific mirrors (.claude/skills, etc.)")
  .option(
    "-m, --mode <mode>",
    "Link mode: symlink|copy|auto (default: auto — symlink on Unix, copy on Windows)",
    "auto",
  )
  .option(
    "-H, --harness <list>",
    "Comma-separated harness list: claude|codex|cursor|copilot|gemini|opencode|goose|amp|droid; defaults to detected",
  )
  .option(
    "-f, --force",
    "Overwrite existing non-matching targets (e.g., a populated directory)",
    false,
  )
  .option("-q, --quiet", "Suppress per-mirror progress output", false)
  .option("-g, --global", "Link global colony (~/.skdd/skills/) into harness global dirs")
  .action(
    async (opts: {
      mode: LinkMode;
      harness?: string;
      force: boolean;
      quiet: boolean;
      global: boolean;
    }) => {
      const harnesses = opts.harness
        ? (opts.harness.split(",").map((s) => s.trim()) as Harness[])
        : undefined;
      const code = await runLink({
        mode: opts.mode,
        harnesses,
        force: opts.force,
        quiet: opts.quiet,
        global: opts.global,
      });
      process.exit(code);
    },
  );

program
  .command("list")
  .description("List skills in the current colony")
  .option("-f, --format <fmt>", "Output format: table|json", "table")
  .option("-g, --global", "List skills in the global colony (~/.skdd/)", false)
  .action(async (opts: { format: "table" | "json"; global: boolean }) => {
    const code = await runList({ format: opts.format, global: opts.global });
    process.exit(code);
  });

program
  .command("show")
  .description("Print a skill's full SKILL.md body")
  .argument("<name>", "Skill name (kebab-case)")
  .option(
    "-f, --format <fmt>",
    "Output format: raw (default) — only raw is implemented today",
    "raw",
  )
  .action(async (name: string, opts: { format: "raw" | "rendered" }) => {
    const code = await runShow(name, { format: opts.format });
    process.exit(code);
  });

program
  .command("doctor")
  .description(
    "Health check: canonical skills/, registry, mirror drift, instruction blocks, .colony.json",
  )
  .option("-j, --json", "Emit a machine-readable JSON report instead of the human layout", false)
  .option(
    "-g, --global",
    "Check the global colony (~/.skdd/) instead of the current project",
    false,
  )
  .action(async (opts: { json: boolean; global: boolean }) => {
    const code = await runDoctor({ json: opts.json, global: opts.global });
    process.exit(code);
  });

program
  .command("import")
  .description(
    "Scan an existing project for SKILL.md duplicates across harness mirrors; --apply consolidates into canonical skills/",
  )
  .argument("[target]", "Project root to scan (defaults to current directory)")
  .option("-j, --json", "Emit a machine-readable JSON report", false)
  .option(
    "--apply",
    "Consolidate duplicates/single-source skills into canonical skills/ and refresh mirrors via a safe non-forced 'skdd link'. Leftover unrecognized files block the link; review them and rerun 'skdd link [-g] --force' to replace the dir.",
    false,
  )
  .option(
    "--canonical <dir>",
    "Override the canonical skills directory (default: 'skills' or .colony.json's canonicalSkillsDir)",
  )
  .option("--skip-link", "Skip the post-consolidation 'skdd link' step (requires --apply)", false)
  .option(
    "-g, --global",
    "Import into the global colony (~/.skdd/), scanning harness global dirs",
    false,
  )
  .action(
    async (
      target: string | undefined,
      opts: {
        json: boolean;
        apply: boolean;
        canonical?: string;
        skipLink: boolean;
        global: boolean;
      },
    ) => {
      const code = await runImport(target, {
        json: opts.json,
        apply: opts.apply,
        canonical: opts.canonical,
        skipLink: opts.skipLink,
        global: opts.global,
      });
      process.exit(code);
    },
  );

// ── mcp subcommand group ─────────────────────────────────────────────────────

const mcp = new Command("mcp").description(
  "Manage the canonical MCP server registry (~/.skdd/mcp.json)",
);

mcp
  .command("list")
  .description("List all MCP servers in the canonical registry")
  .option("-f, --format <fmt>", "Output format: table|json", "table")
  .action(async (opts: { format: "table" | "json" }) => {
    const code = await runMcpList({ format: opts.format });
    process.exit(code);
  });

mcp
  .command("add <name>")
  .description("Add or update an MCP server in the canonical registry")
  .option("-c, --command <cmd>", "Executable to run (stdio server)")
  .option(
    "--args <args>",
    "Arguments for the command. Tokens are split on whitespace; quote segments that contain spaces (single or double quotes), e.g. --args '-y @pkg \"/path/with spaces\"'",
  )
  .option(
    "--env <pairs>",
    "Comma-separated KEY=VALUE environment variables, e.g. API_KEY=${MY_KEY}",
  )
  .option("-u, --url <url>", "URL of the remote MCP server")
  .option("--type <type>", "Remote server type: http|sse", "http")
  .option(
    "--headers <pairs>",
    "Comma-separated KEY=VALUE request headers for remote MCP servers (remote only), e.g. Authorization=Bearer ${TOK}",
  )
  .option(
    "--hosts <list>",
    "Comma-separated host IDs to target, e.g. claude-code,droid (default: all)",
  )
  .option("--disabled", "Mark the server as disabled", false)
  .option("-f, --force", "Overwrite existing server entry", false)
  .action(
    async (
      name: string,
      opts: {
        command?: string;
        args?: string;
        env?: string;
        url?: string;
        type?: string;
        headers?: string;
        hosts?: string;
        disabled: boolean;
        force: boolean;
      },
    ) => {
      const args = opts.args ? parseShellArgs(opts.args) : undefined;
      const parseKeyValuePairs = (raw: string): Record<string, string> =>
        Object.fromEntries(
          raw.split(",").map((pair) => {
            const idx = pair.indexOf("=");
            return idx === -1
              ? [pair.trim(), ""]
              : [pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()];
          }),
        );
      const env = opts.env ? parseKeyValuePairs(opts.env) : undefined;
      const headers = opts.headers ? parseKeyValuePairs(opts.headers) : undefined;
      const hosts = opts.hosts
        ? (opts.hosts.split(",").map((h) => h.trim()) as McpHostId[])
        : undefined;
      const code = await runMcpAdd(name, {
        command: opts.command,
        args,
        env,
        url: opts.url,
        type: opts.type as "http" | "sse" | undefined,
        headers,
        hosts,
        disabled: opts.disabled || undefined,
        force: opts.force,
      });
      process.exit(code);
    },
  );

mcp
  .command("remove <name>")
  .description("Remove an MCP server from the canonical registry")
  .option("-f, --force", "Exit 0 even when the server does not exist", false)
  .action(async (name: string, opts: { force: boolean }) => {
    const code = await runMcpRemove(name, { force: opts.force });
    process.exit(code);
  });
mcp
  .command("sync")
  .description("Sync the canonical MCP registry (~/.skdd/mcp.json) to all available host configs")
  .option("-n, --dry-run", "Print planned changes without writing any files", false)
  .action(async (opts: { dryRun: boolean }) => {
    const code = await runMcpSync({ dryRun: opts.dryRun });
    process.exit(code);
  });

program.addCommand(mcp);

// ── hub ───────────────────────────────────────────────────────────────────────

program
  .command("hub")
  .description("Open the skdd TUI dashboard (skills, mirrors, MCP matrix, doctor)")
  .action(async () => {
    const code = await runHub();
    process.exit(code);
  });

// ── main ─────────────────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err) => {
  logger.error((err as Error).message);
  process.exit(1);
});
