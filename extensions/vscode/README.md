# SkDD — Agent Skills

Snippets, `.colony.json` validation, and command-palette actions for
[Skills-Driven Development](https://github.com/zakelfassi/skills-driven-development) (SkDD).

## Features

- **SKILL.md frontmatter snippets** — type `skill-frontmatter`, `skill-frontmatter-full`,
  `skill-skeleton`, or `skill-registry-row` in any Markdown file to scaffold spec-compliant
  skills in seconds.
- **`.colony.json` IntelliSense** — live validation and autocomplete for colony manifests via
  the [colony-v1.json](https://github.com/zakelfassi/skills-driven-development/blob/main/docs/spec/colony-v1.json)
  JSON Schema. Catches missing required fields, wrong enum values, and invalid version strings
  as you type.
- **Command palette** — three commands that delegate to the `skdd` CLI without leaving VS Code:
  - `SkDD: Forge a new skill` — prompts for a name and description, runs `skdd forge`
  - `SkDD: Run doctor health check` — runs `skdd doctor` against the current colony
  - `SkDD: Refresh harness mirrors` — runs `skdd link` to sync harness mirror directories

## Requirements

- [Node.js ≥ 20](https://nodejs.org/)
- The [`skdd` CLI](https://www.npmjs.com/package/@zakelfassi/skdd) on `PATH`:
  ```
  pnpm add -g @zakelfassi/skdd
  ```
  Or invoke on demand with `pnpm dlx @zakelfassi/skdd`.

If `skdd` is not on `PATH`, set `skdd.cliPath` in settings to an absolute path.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `skdd.cliPath` | `"skdd"` | Path to the skdd CLI binary |
| `skdd.openTerminalOnCommand` | `true` | Open a terminal when running a SkDD command (vs. run as a background task) |

## Note on publishing

A publisher ID must exist in the VS Code Marketplace before any `vsce publish` or
`vsce package --no-dependencies` upload. Publishing is managed by the SkDD maintainers.
To install a local build, download the `.vsix` from a release and run:

```
code --install-extension skdd-vscode-<version>.vsix
```

## License

MIT — see [LICENSE](https://github.com/zakelfassi/skills-driven-development/blob/main/LICENSE).
