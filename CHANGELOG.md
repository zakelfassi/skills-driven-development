# Changelog

All notable changes to Skills-Driven Development (SkDD) are recorded in this file. The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries are retroactively reconstructed from git history for versions before this file existed.

## [Unreleased]

### Added
- Community scaffolding: `SECURITY.md`, `CODE_OF_CONDUCT.md` (link-based Contributor Covenant 2.1), `.github/CODEOWNERS`, `.github/FUNDING.yml`, `.github/ISSUE_TEMPLATE/*.yml` (bug / feature / new-skill / rfc), `.github/PULL_REQUEST_TEMPLATE.md`, `ROADMAP.md`.

## [0.3.0] — 2026-04-13

### Added
- **`skdd doctor`** — health check over `.colony.json`, canonical `skills/`, registry drift, mirror state, and instruction blocks. `--json` output for CI consumption. 8 tests covering healthy colony, drift, missing mirror, malformed `.colony.json`, and instruction block presence.
- **`skdd import`** — content-hash scan across every known harness mirror path and canonical `skills/`. Detects duplicate groups (same content, multiple locations) and name collisions (same `frontmatter.name`, different content). Realpath dedup so correctly-linked projects report zero duplicates. `--apply` consolidates duplicates and single-source harness skills into canonical `skills/` and runs `skdd link --force` to re-establish mirrors. 10 tests.
- **VS Code extension scaffold** at `extensions/vscode/` — SKILL.md frontmatter snippets (`skill-frontmatter`, `skill-frontmatter-full`, `skill-skeleton`, `skill-registry-row`), `.colony.json` JSON Schema validation, command palette entries for `SkDD: Forge a new skill`, `SkDD: Run doctor`, `SkDD: Refresh harness mirrors`. Shells out to the `skdd` CLI via `vscode.Terminal`. Not yet published to the Marketplace.
- **`docs/schemastore-submission.md`** — draft PR body for submitting `.colony.json` to [SchemaStore.org/json](https://www.schemastore.org/json/), giving every VS Code and JetBrains user global IntelliSense on colony manifests without an extension install.
- **Visual identity** — `assets/logo.svg` and `assets/wordmark.svg` (anvil glyph + feedback-loop arc on a slate gradient). README hero row, shields.io badges (npm version, downloads, CI status, license, stars, spec tag).
- **Mermaid diagrams** replacing ASCII art: the SkDD lifecycle in `README.md`, the colony architecture in `docs/skill-colony.md`, and the canonical + mirror topology in `docs/configuration.md`.
- **`docs/why-skdd.md`** — narrative pitch doc framing SkDD as "a skill whose job is to create skills." Lifecycle diagram, audience table, 60-second experience.
- **Starlight docs site scaffold** under `site/` — Astro + `@astrojs/starlight`, homepage with hero and card grid, brand CSS, sidebar skeleton, `astro.config.mjs` targeting GitHub Pages. Content ingestion from the repo's `docs/` directory is a follow-up (documented in `site/README.md`).
- **`.github/workflows/deploy-docs.yml`** — GitHub Pages deploy triggered by changes to `site/` or `docs/`. Uses `actions/upload-pages-artifact@v4` and `actions/deploy-pages@v4`.

### Changed
- `cli/package.json` version bumped `0.2.0` → `0.3.0`, description updated to mention doctor + import.
- `cli/README.md` expanded with full per-command reference including `doctor` and `import`.
- `cli/src/index.ts` registers `doctor` and `import` subcommands; `--version` now reports `0.3.0`.

## [0.2.0] — 2026-04-12

### Added
- **Canonical `skills/` + harness mirror pattern.** Every supported harness (`claude`, `codex`, `cursor`, `copilot`, `gemini`, `opencode`, `goose`, `amp`) now has a `.<harness>/skills` mirror pointing at a canonical `skills/` directory at the project root. On Unix the mirror is a symlink (`../skills`); on Windows it's a file copy tracked in `.skdd-sync.json`. Edit `skills/` once, every harness sees the same bytes.
- **`skdd link`** — new subcommand. Idempotent sync that creates / repairs mirrors. `--mode=symlink|copy|auto`, `--harness=<list>`, `--force` to override drift blocks, `--quiet` for CI. Backed by `cli/src/lib/fs-link.ts` (platform-aware symlink/copy helpers) and `cli/src/lib/sync-state.ts` (`.skdd-sync.json` parser/writer).
- **`detectAllHarnesses()`** in `cli/src/lib/harness.ts` returns every harness detected in a project (used by `skdd link` to materialize all mirrors in one pass).
- **`renderCanonicalInstructionBlock()`** template emitting a "canonical + mirror" Skills block for `CLAUDE.md` / `AGENTS.md` / `.cursor/rules/skills.mdc` that explicitly tells agents to always write to `skills/`, never to the mirror.
- **Docs updates**: `docs/skill-colony.md` glossary adds "canonical skills directory" and "harness mirror" as first-class terms. `docs/configuration.md` rewritten canonical-first. All 11 `docs/integrations/*.md` updated to show the canonical pattern. `CONTRIBUTING.md` ground rule added for writing to canonical, never the mirror.
- **Schema updates**: `.colony.json` adds `canonicalSkillsDir` (string, default `"skills"`) and `harnessMirrors` (array). `docs/spec/colony-v1.json` reflects both fields.

### Changed
- `skdd init` defaults to canonical mode — creates `skills/skillforge/`, the registry, the instruction block, and calls `skdd link` for the detected harness. `--no-canonical` preserves the flat per-harness layout for users who explicitly don't want mirrors.
- `skdd forge` writes to `skills/<name>/` (not the harness dir) by default, then calls `skdd link` to refresh mirrors. `--no-canonical` and `--skip-link` flags available for escape hatches.

### Fixed
- Symlink deletion on macOS: `cli/src/lib/fs-link.ts` uses `unlinkSync` (not `rmSync`) when removing a symlink to a directory. Node's `rmSync` without `recursive: true` trips on directory-symlinks with "Path is a directory".

## [0.1.0] — 2026-04-11

### Added
- Initial `skdd` CLI with `init`, `validate`, `forge`, `list`, `sync` (stub) subcommands.
- Agent Skills spec validator (`cli/src/lib/spec.ts` + `cli/src/commands/validate.ts`) covering name regex, frontmatter fields, description length, body presence, and the SkDD 200-line recommendation.
- Registry format: `.skills-registry.md` (human-readable markdown table) + optional `.skills-registry.json` (machine-readable). Parser and writer in `cli/src/lib/registry.ts`.
- Harness detection + instruction block templates in `cli/src/lib/harness.ts` + `cli/src/lib/templates.ts`.
- CI workflows: `validate-skills.yml` (spec validation + link check + stale-rename grep) and `publish-skills.yml` (placeholder for future npm publish).
- Methodology docs: `docs/skill-colony.md`, `docs/forging-skills.md`, `docs/configuration.md`, `docs/specification-alignment.md`, vendored spec snapshot at `docs/spec/agent-skills-v1.md`, 11 harness integration docs under `docs/integrations/`.
- Claude Code plugin scaffold at `plugins/skdd-claude/` with `plugin.json`, bundled skillforge skill, `/forge` and `/skills` slash commands.
- `.colony.json` manifest + `docs/spec/colony-v1.json` JSON Schema.
- `CONTRIBUTING.md`, `LICENSE` (MIT), example project under `examples/webapp-starter/`.

[Unreleased]: https://github.com/zakelfassi/skills-driven-development/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/zakelfassi/skills-driven-development/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/zakelfassi/skills-driven-development/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/zakelfassi/skills-driven-development/releases/tag/v0.1.0
