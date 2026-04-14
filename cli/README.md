# skdd — Skills-Driven Development CLI

> Validate, init, forge, list, link, doctor, import, and (soon) sync SkDD skill colonies.

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
skdd init [--harness=claude|codex|cursor|copilot|gemini|opencode|goose|amp|auto] [--no-canonical]
skdd validate [path...] [--strict]
skdd forge <name> [--from-description="..."] [--non-interactive] [--no-canonical] [--skip-link]
skdd list [--format=table|json]
skdd link [--mode=symlink|copy|auto] [--harness=<list>] [--force] [--quiet]
skdd doctor [--json]
skdd import [target] [--json] [--apply] [--canonical=<dir>] [--skip-link]
skdd sync <registry-url>       # stub — implemented in a future release
```

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

### `skdd sync`

Stub. Planned: pull a remote colony manifest and fork selected skills into the local project. Not implemented yet — the command exits 2 with a pointer to this note.

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
