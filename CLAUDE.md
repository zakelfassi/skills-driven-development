# SkDD — agent instructions

## Active goal

**The current build goal is [`docs/plans/2026-07-skdd-commons.md`](docs/plans/2026-07-skdd-commons.md)** — SkDD Commons + the July 2026 Frontier drop + CLI `add`/`push` + plugin hooks. If you were spun up in this repo without a more specific task, that plan is your task: read it fully, ingest its §1 context list, and execute phase by phase. Check off acceptance boxes and append to its §9 execution log as you go.

## House rules

- **pnpm only.** Node ≥20.
- **Tests:** vitest — `pnpm --dir cli test`. Every new CLI command gets tests in `cli/test/` mirroring the existing style (fixtures under `cli/test/fixtures/`).
- **Lint/format:** biome — `pnpm --dir cli lint` / `format`. No eslint/prettier here.
- **Commits:** conventional commits (`feat:`, `fix:`, `docs:`, `chore:` …). release-please builds `CHANGELOG.md` from them — never hand-edit the changelog.
- **The CLI is published** as `@zakelfassi/skdd` (npm, `cli/` package). Don't break existing command flags; additive changes only unless a major is planned.
- **Skills are spec-bound:** every SKILL.md must pass `skdd validate --strict` (agentskills.io spec + SkDD lifecycle metadata). Author skills per `skillforge/SKILL.md`.

## Non-goals (binding, from ROADMAP.md)

No hosted registry or server-side skill index (git is the registry). No skill-executing runtime. No review gate on *forging* (reviewing *community imports* is different and fine). No semantic search.

## Operational guardrails

- Harness mirror dirs (`~/.claude/skills`, `~/.codex/skills`, …) are often populated regular directories holding skills that live in no colony. **Never `skdd link --force` over them** — it replaces the directory with a symlink and effectively deletes those skills. Mirror logic must stay non-destructive by default.
- `~/.skdd/` on this machine is the maintainer's live global colony, not a test fixture. Use scratch dirs for tests.
