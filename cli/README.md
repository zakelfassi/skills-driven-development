# skdd — Skills-Driven Development CLI

> Validate, init, forge, list, and (soon) sync/export SkDD skill colonies.

## Install

```bash
pnpm add -D skdd
# or globally
pnpm add -g skdd
```

This repo uses pnpm exclusively — do not use npm or yarn.

## Usage

```
skdd init [--harness=claude|codex|cursor|copilot|auto]
skdd validate [path]
skdd forge <name> [--from-description="..."] [--non-interactive]
skdd list [--format=table|json]
skdd sync <registry-url>       # stub — implemented in a future release
```

### `skdd init`

Scaffold a SkDD colony in the current project. Detects the harness from existing files (`CLAUDE.md`, `.cursor/`, `.github/copilot-instructions.md`, etc.) and writes the skillforge meta-skill plus an empty registry to the right location. Pass `--harness=<name>` to override detection.

### `skdd validate`

Validates one or more `SKILL.md` files against the [Agent Skills specification](https://agentskills.io/specification.md). Checks frontmatter required fields, the `name` regex, description length, and directory structure. Exits non-zero if any file fails — wire it into CI.

```bash
skdd validate                                    # walks the current dir
skdd validate skillforge/                         # one directory
skdd validate .claude/skills/*/SKILL.md           # glob
```

### `skdd forge`

Interactive wizard that writes a spec-compliant SKILL.md skeleton and appends it to `.skills-registry.md`. Non-interactive mode is supported for agent-driven use.

```bash
skdd forge api-endpoint
skdd forge deploy-preview --from-description="Deploy current branch to staging" --non-interactive
```

### `skdd list`

Parses `.skills-registry.md` (and `.skills-registry.json` if present) and prints the registry. Use `--format=json` for machine-readable output.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## License

MIT
