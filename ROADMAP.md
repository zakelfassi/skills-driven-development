# SkDD Roadmap

> What's shipped, what's in flight, and what's deferred.

## Current release

**v0.3.0** (2026-04-13) — `skdd doctor` + `skdd import` + VS Code extension scaffold + visual identity + docs site scaffold + community files. See [CHANGELOG.md](CHANGELOG.md) for the full list.

## Status by tranche

SkDD is being built in named tranches (P0 → P5). Each tranche ships as a batch of commits.

| Tranche | Scope | Status |
|---|---|---|
| **P0 — Correctness bugs** | legacy-handle rename holes, broken README steps, missing `.gitignore`, broken anchors, missing scripts in examples | ✅ Shipped (v0.1.0) |
| **P1 — Onboarding UX** | `docs/configuration.md`, quick-start rewrite, `CONTRIBUTING.md`, terminology glossary, examples polish | ✅ Shipped (v0.1.0) |
| **P2 — Tooling** | `skdd` CLI (init/validate/forge/list/sync), registry JSON format, inter-skill composition spec, vendored spec snapshot, CI, pre-commit | ✅ Shipped (v0.1.0) |
| **P3 — Platform integrations** | `.colony.json` manifest, 11 harness integration docs, Claude Code plugin scaffold | ✅ Shipped (v0.1.0) |
| **Canonical + mirror pattern** | `skdd link`, `fs-link.ts`, `sync-state.ts`, canonical default in init/forge, 11 docs updated | ✅ Shipped (v0.2.0) |
| **E — Alpha features** | `skdd doctor`, `skdd import`, VS Code extension scaffold, SchemaStore PR prep | ✅ Shipped (v0.3.0) |
| **F — Shareability** | Logo/wordmark SVGs, Mermaid diagrams, README badges, `docs/why-skdd.md`, Starlight docs site | ✅ Shipped (v0.3.0) |
| **G — Community scaffolding** | SECURITY, CoC, CODEOWNERS, issue/PR templates, FUNDING, CHANGELOG, ROADMAP | ✅ Shipped (v0.3.0) |
| **H — CLI depth + quality bar** | `skdd stats`, `search`, `migrate`, `compose`, `link --watch`, `completion`, ESLint/Prettier, Changesets, e2e tests, `SkddError` class, man pages | ⏸ Deferred |
| **P4 — Strategy / Ecosystem** | Marketplace submissions, RFC upstream for lifecycle metadata, security doc, SkDD rename debate, governance | ⏸ Deferred |
| **Commons** ([plan](docs/plans/2026-07-skdd-commons.md)) | Phase 1: [`skdd-commons`](https://github.com/zakelfassi/skdd-commons) repo + `2026-07-frontier` drop + safety-lint CI · Phase 2: `skdd add`/`push`/`drops` + `.skdd-lock.json` provenance · Phase 3: opt-in plugin hooks (`finish-the-loop` gate, `freeze-the-session` reminder) · Phase 4: docs + launch | 🚧 Shipped, launch pending |

### Commons v2 (deferred)

Explicitly cut from Commons v1 — candidates for a follow-up tranche:

- **`skdd update`** — three-way evolution merge against the upstream drop; highest-value item, because a local/upstream divergence *is a PR waiting to be pushed* (`.skdd-lock.json` already records the base sha)
- **Hub "Commons" pane** — list drops with an install action inside `skdd hub`
- **npm drops** (`@skdd/drop-*`) — git transport is enough for v1
- **`attack-the-plan` as a plan-approval gate** — deferred for nag risk; stays a skill

## Manual steps (not automatable — GitHub settings)

These have to be flipped in the repo Settings UI. Checked as they land:

- [ ] **Social preview image** — upload `.github/social-preview.png` (1280×640) via GitHub Settings → Social preview
- [ ] **GitHub Discussions** — enable at Settings → Features → Discussions, then pin a "Welcome / RFC" post
- [ ] **Repo topics** — add `agent-skills`, `claude-code`, `codex`, `cursor`, `agentskills-io`, `skills-driven-development`, `ai-agents`, `cli`, `typescript`, `skill-colony`
- [ ] **GitHub Pages** — Settings → Pages → Source = "GitHub Actions" (enables the `deploy-docs.yml` workflow output)
- [ ] **Branch protection on `main`** — require PR review + passing CI (once there's more than one maintainer)
- [ ] **Secrets** — `NPM_TOKEN` for `publish-skills.yml` once we're ready to publish to npm

## Near-term (next tranche after H/P4)

None committed. When the dust settles, candidates include:

- **Marketplace submissions** — SkillsMP, Skills.sh, ClawHub, LobeHub, Claude Code Plugin Marketplace
- **SchemaStore.org PR** — submit `.colony.json` using `docs/schemastore-submission.md` as the draft body
- **Upstream RFC** to agentskills.io for the SkDD lifecycle metadata profile (`forged-by`, `usage-count`, `last-used`, `status`, etc.)
- **Content ingestion for the docs site** — decide between per-build copy, symlink, or a Starlight content loader, and wire `site/` to consume the repo's `docs/` directory
- **VS Code extension publish** — package `extensions/vscode` as a `.vsix` and submit to the VS Code Marketplace
- **`skdd migrate`** — one-shot converter from flat per-harness layout to canonical + mirror
- **`skdd link --watch`** — fs watcher for continuous sync
- **`SkddError` class + documented exit codes** — better CI ergonomics
- **Integration tests** — end-to-end tests that spawn the built binary (`cli/test/e2e/`)

## Explicit non-goals

Things SkDD is deliberately *not* doing. If you want these, SkDD is not the right project:

- A runtime that executes skills (your harness does that)
- A hosted colony registry or server-side skill index
- A review gate on every skill creation (SkDD's bias is forge-then-evolve)
- Semantic/AI-based skill search (the registry is plain text; search is up to the harness)
- A governance body — SkDD is currently a solo-maintained project; governance docs arrive only if the community does

## How to influence the roadmap

- **Small feature**: open an issue with the [feature request template](.github/ISSUE_TEMPLATE/feature-request.yml)
- **Big feature or methodology change**: file an RFC via the [RFC template](.github/ISSUE_TEMPLATE/rfc.yml) or open a draft PR with `[RFC]` in the title
- **New skill**: use the [new skill template](.github/ISSUE_TEMPLATE/new-skill.yml)
- **Security issue**: use GitHub's [private advisory flow](https://github.com/zakelfassi/skills-driven-development/security/advisories) — see [SECURITY.md](SECURITY.md)
