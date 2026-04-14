# SkDD for Visual Studio Code

Snippets, validation hints, and command-palette actions for [Skills-Driven Development](https://github.com/zakelfassi/skills-driven-development).

## What it does

- **SKILL.md frontmatter snippets**
  - `skill-frontmatter` — minimal spec-compliant stub (name + description)
  - `skill-frontmatter-full` — with SkDD lifecycle metadata (`forged-by`, `forged-from`, `status`)
  - `skill-skeleton` — full SKILL.md with Inputs / Steps / Conventions / Edge Cases
  - `skill-registry-row` — a row for `.skills-registry.md`
- **`.colony.json` validation** via the JSON Schema at `docs/spec/colony-v1.json` — live IntelliSense and diagnostics when editing a colony manifest.
- **Command palette actions** that shell out to the `skdd` CLI:
  - `SkDD: Forge a new skill` — prompts for a name and description, runs `skdd forge`
  - `SkDD: Run doctor health check` — runs `skdd doctor`
  - `SkDD: Refresh harness mirrors` — runs `skdd link`

## Requirements

- [Node.js ≥ 20](https://nodejs.org/)
- The [`skdd` CLI](https://www.npmjs.com/package/@zakelfassi/skdd) on `PATH` (`pnpm add -g @zakelfassi/skdd` or invoke via `pnpm dlx @zakelfassi/skdd`)

If `skdd` is not on `PATH`, set `skdd.cliPath` in settings to an absolute path.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `skdd.cliPath` | `"skdd"` | Path to the skdd CLI binary |
| `skdd.openTerminalOnCommand` | `true` | Open a terminal when running a SkDD command (vs. run as a background task) |

## Status

This is a scaffold extension — not yet published to the Visual Studio Marketplace. Install locally with `code --install-extension` from a packaged `.vsix`, or open the `extensions/vscode/` folder in VS Code and hit `F5` to run the Extension Development Host.

## Development

```bash
cd extensions/vscode
pnpm install
pnpm run compile      # build dist/extension.js
# then press F5 in VS Code to launch the Extension Development Host
```

## License

MIT — same as the parent project.
