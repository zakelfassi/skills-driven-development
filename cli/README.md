# skdd — Skills-Driven Development CLI

> Validate, init, forge, list, link, doctor, and import SkDD skill colonies —
> project-scoped by default, or `-g`/`--global` for a personal `~/.skdd/`
> colony every harness on your machine reads.

## Install

```bash
pnpm add -D @zakelfassi/skdd
# or globally
pnpm add -g @zakelfassi/skdd
# or one-shot
pnpm dlx @zakelfassi/skdd init --harness=claude
```

This repo uses pnpm exclusively — do not use npm or yarn.

## Usage

```
skdd init [--harness=claude|codex|cursor|copilot|gemini|opencode|goose|amp|auto] [--no-canonical] [-g]
skdd validate [path...] [--strict]
skdd forge <name> [--from-description="..."] [--non-interactive] [--no-canonical] [--skip-link] [-g]
skdd list [--format=table|json] [-g]
skdd link [--mode=symlink|copy|auto] [--harness=<list>] [--force] [--quiet] [-g]
skdd doctor [--json] [-g]
skdd import [target] [--json] [--apply] [--canonical=<dir>] [--skip-link] [-g]
skdd add <source> [selector] [--rename=<name>] [--dry-run] [--json] [--non-interactive] [-g]
skdd push <skill|pack> [--to=<owner/repo>] [--drop=<id>] [--dry-run] [-g]
skdd drops [--from=<source>] [--format=table|json]
skdd hub
skdd mcp <subcommand>
```

`-g` / `--global` retargets `init`, `forge`, `list`, `link`, `doctor`, and
`import` at a personal `~/.skdd/` colony instead of the project in `cwd` —
skills that travel with you across every repo and harness on the machine,
rather than versioned with one project. See
[`docs/global-colony.md`](https://github.com/zakelfassi/skills-driven-development/blob/main/docs/global-colony.md)
for the directory layout, migration path for existing harness skill dirs, and
per-harness global-path table. `skdd hub` is an interactive TUI over the same
state (project or global); `skdd mcp` manages the canonical MCP server
catalogue at `~/.skdd/mcp.json` (see
[`docs/mcp-sync.md`](https://github.com/zakelfassi/skills-driven-development/blob/main/docs/mcp-sync.md)).

### `skdd init`

Scaffold a SkDD colony in the current project. Creates a canonical `skills/` directory with a `skillforge` stub, writes `.skills-registry.md`, appends a Skills block to your harness instruction file (`CLAUDE.md` / `AGENTS.md` / `.cursor/rules/skills.mdc` / `.github/copilot-instructions.md`), and runs `skdd link` to materialize the harness mirror. Detects the harness from existing files; pass `--harness=<name>` to override. `--no-canonical` uses the flat per-harness layout instead.

### `skdd validate`

Validates `SKILL.md` files against the [Agent Skills specification](https://agentskills.io/specification.md). Checks frontmatter required fields, the `name` regex, description length, directory structure, and SkDD's recommended size cap. Exits non-zero on errors — wire it into CI. `--strict` promotes warnings to errors.

```bash
skdd validate                                    # walks the current dir
skdd validate skills/                             # one directory
skdd validate .claude/skills/*/SKILL.md           # glob
```

### `skdd forge`

Interactive wizard that writes a spec-compliant `SKILL.md` skeleton in canonical `skills/<name>/`, appends it to `.skills-registry.md`, and runs `skdd link` to refresh mirrors. Non-interactive mode is supported for agent-driven use.

```bash
skdd forge api-endpoint
skdd forge deploy-preview \
  --from-description="Deploy the current branch to staging. Use when I say 'push preview'." \
  --non-interactive
```

### `skdd list`

Parses `.skills-registry.md` (and `.skills-registry.json` if present) and prints the registry. `--format=json` for machine-readable output.

### `skdd link`

Idempotently syncs the canonical `skills/` directory into every harness-expected mirror location (`.claude/skills`, `.codex/skills`, `.cursor/skills`, `.github/skills`, `.gemini/skills`, `.opencode/skills`, `.goose/skills`, `.amp/skills`). On Unix the mirror is a symlink → `../skills`; on Windows it's a file copy tracked in `.skdd-sync.json` so re-running detects drift. `--force` repairs a mirror target that has user data.

```bash
skdd link                             # every detected harness
skdd link --harness=claude,codex       # just these two
skdd link --mode=copy                  # force copy mode on Unix
skdd link --force                      # replace a non-matching target
```

**`--adopt`** — for a harness dir that is a **populated real directory** holding skills that aren't in the colony (common with a global `~/.claude/skills`, `~/.codex/skills`, …). Instead of replacing the whole dir with a symlink (which `--force` would do, deleting those skills), `--adopt` **copies the colony's skills into the dir**, leaving every non-colony skill untouched. Per skill: created if absent, skipped if byte-identical, and left as-is if it diverges (add `--force` to overwrite a *colony* skill that diverges — never a foreign one). Adopted copies aren't tracked in `.skdd-sync.json`; it's a one-way additive push, not a managed mirror.

```bash
skdd link -g --adopt                   # push the global colony into every populated harness dir
skdd link -g --adopt --harness=claude  # just Claude Code's global dir
skdd link -g --adopt --force           # also refresh colony skills that diverge in the target
```

### `skdd doctor`

Health check for a SkDD-enabled project. Inspects:

- `.colony.json` (parses + surfaces canonical dir)
- Canonical `skills/` directory (existence + SKILL.md count)
- Spec validation across every skill (delegates to `skdd validate`)
- `.skills-registry.md` + `.skills-registry.json` (parses + detects disk ↔ registry drift)
- `.skdd-sync.json` mirror state (symlink target drift, missing mirrors, mode mismatches)
- Instruction files (`CLAUDE.md` / `AGENTS.md` / `.cursor/rules/skills.mdc` / `.github/copilot-instructions.md`) — presence of a `## Skills` block

Exits 0 on a clean bill of health (warnings allowed), 1 on any error. `--json` emits a structured report for CI consumption.

```bash
skdd doctor
skdd doctor --json | jq '.counts'
```

### `skdd import`

Scans an existing project for `SKILL.md` files across every known harness mirror path and canonical `skills/`, content-hashes each file, groups by hash, and reports:

- **Duplicate groups** — same content across multiple harness mirrors (e.g., `.claude/skills/foo/SKILL.md` and `.cursor/skills/foo/SKILL.md` byte-identical)
- **Name collisions** — same `frontmatter.name` but different content (must be resolved manually before `--apply`)
- **Scan coverage** — how many skills were found in each origin (canonical, each harness)

Symlinked mirrors are deduplicated via `realpathSync` so a correctly-linked project reports zero duplicates.

`--apply` **consolidates**: for every skill without a name collision, it copies/moves the content into canonical `skills/<name>/`, removes the non-canonical copies from each harness dir, and runs `skdd link --force` to re-establish clean symlink mirrors. This is how a pre-SkDD project migrates to the canonical + mirror layout in one shot.

```bash
skdd import                                     # scan report only
skdd import --json                              # machine-readable
skdd import --apply                             # migrate + link
skdd import ../some-other-project --apply       # operate on a different root
```

### `skdd add`

Install skills from a **Commons repo** — a git repo with a `drops.json` manifest and `packs/<drop-id>/<skill>/` directories (see [SkDD Commons](https://github.com/zakelfassi/skdd-commons)). Sources: GitHub shorthand (`owner/repo`), a full git URL, or a local path, each with an optional `#ref`. Selector: a drop id, `drop/skill` for a single skill, or omitted for an interactive pick.

Every skill is validated with `--strict` before install (refused on failure), checked for name collisions against the target colony (`--rename` resolves single-skill collisions), registered with provenance (`owner/repo@shortsha (drop-id)` in the Source column, full sha in `.skdd-lock.json`), and mirrored via the same **safe, never-forced** link path as `skdd link`. The manifest is treated as hostile input: drop ids and skill names must match the lowercase-kebab-case grammar (no slashes, no `..`), so a malicious `drops.json` can never write outside your `skills/` directory.

```bash
skdd add zakelfassi/skdd-commons 2026-07-frontier                       # whole drop
skdd add zakelfassi/skdd-commons 2026-07-frontier/finish-the-loop -g    # one skill, global colony
skdd add ../my-commons 2026-01-test --dry-run                           # local source, plan only
```

### `skdd push`

Ship a skill (or every local skill sharing a `metadata.pack` id) upstream to a Commons as a PR. Needs the [GitHub CLI](https://cli.github.com) authenticated. The default target repo comes from `~/.skdd/config.toml` (`commons = "owner/repo"`).

Machine-local state is stripped before travel (`usage-count` resets to `"0"`, `last-used` is dropped); `forged-*` provenance is preserved. **Only the skill payload travels** — `SKILL.md` plus regular files under `scripts/`, `references/`, and `assets/`; dotfiles, symlinks, and anything else in the skill directory stay home, and `--dry-run` enumerates exactly which files travel and which don't. Skills that already exist upstream branch as `evolve/<name>` with a diff summary; new skills branch as `skill/<name>` and land in `incoming/` for maintainer triage, or in an existing drop with `--drop <id>`.

```bash
skdd push what-would-you-cut --dry-run     # inspect the PR before sending it
skdd push what-would-you-cut               # fork, branch, PR
skdd push my-new-skill --drop 2026-07-frontier
```

### `skdd drops`

List the drops a Commons offers (id, title, date, skill count, story link). `--from` accepts the same source forms as `add`; defaults to the configured commons.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

All commands must pass before a PR lands. CI re-runs them on every push.

## License

MIT
