---
title: "Examples gallery"
description: "Persona: a TypeScript + React/Express team shipping a web application. Four skills that map to the patterns every webapp team repeats."
---

Three reference colonies that show SkDD working across different project types. Each colony ships with real structure, a lived-in registry, and at least one executable script — so you can see the loop in action before adapting it to your own project.

Every example passes `skdd validate` and `skdd doctor`:

```bash
node cli/dist/index.js validate \
  examples/webapp-starter/skills \
  examples/cli-tool/skills \
  examples/data-pipeline/skills
```

---

## webapp-starter

> **Persona:** a TypeScript + React/Express team shipping a web application. Four skills that map to the patterns every webapp team repeats.

**GitHub:** [`examples/webapp-starter/`](https://github.com/zakelfassi/skills-driven-development/tree/main/examples/webapp-starter)

### Skill roster

| Skill | Real script? | Description |
|-------|-------------|-------------|
| `deploy-preview` | ✅ `scripts/deploy-preview.sh` | Deploy a preview branch to staging, log the URL |
| `api-endpoint` | — | Scaffold a REST endpoint: route, handler, types, test |
| `component-scaffold` | — | Generate a React component with co-located test and story |
| `bug-triage` | — | Triage a bug report into a GitHub issue with labels and severity |

### File tree

```
examples/webapp-starter/
├── AGENTS.md
├── CLAUDE.md
├── package.json                     # Stub — anchors the project root
├── .colony.json                     # Validates against colony-v1.json
├── .skills-registry.md              # 4 active rows + 1 archived (notify-hook → removed)
└── skills/
    ├── deploy-preview/
    │   ├── SKILL.md
    │   └── scripts/deploy-preview.sh  # Runs — echoes a fake preview URL
    ├── api-endpoint/SKILL.md
    ├── bug-triage/SKILL.md
    └── component-scaffold/SKILL.md
```

### Try it in 60 seconds

```bash
cp -r examples/webapp-starter /tmp/skdd-demo
cd /tmp/skdd-demo
mkdir -p skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o skills/skillforge/SKILL.md
# open /tmp/skdd-demo with Claude Code, Codex, or your harness of choice
# ask: "What skills are available in this project?"
pnpm skills:deploy-preview my-feature-branch   # runs the real stub
```

### What runs vs. what's illustrative

| Path | Status |
|------|--------|
| `skills/deploy-preview/scripts/deploy-preview.sh` | **Runs** — dry-run stub echoes a fake preview URL |
| `skills/*/SKILL.md` | **Illustrative** — the agent reads them like real skills |
| `.skills-registry.md` | **Illustrative** — the agent parses it |
| `pnpm skills:list` / `skills:deploy-preview` | Work |
| React/Express source code | Does not exist |

---

## cli-tool

> **Persona:** a team building a cross-platform CLI (`shipctl`). Five skills that cover the full release and maintenance lifecycle for a compiled CLI tool.

**GitHub:** [`examples/cli-tool/`](https://github.com/zakelfassi/skills-driven-development/tree/main/examples/cli-tool)

### Skill roster

| Skill | Real script? | Description |
|-------|-------------|-------------|
| `release-cut` | ✅ `scripts/release-cut.sh` | Bump version, changelog from conventional commits, tag, draft GH release |
| `cross-compile-matrix` | — | Add a new target triple to the CI yaml + Makefile + smoke test |
| `flag-add` | — | Add a CLI flag end-to-end: parser, help text, completion scripts, docs, test |
| `manpage-sync` | — | Regenerate man pages + shell completions from the command tree |
| `breaking-change-audit` | — | Pre-release audit: diff public flags/exit codes/output formats vs last tag |

### File tree

```
examples/cli-tool/
├── AGENTS.md
├── CLAUDE.md
├── package.json                     # Stub; scripts: skills:list, skills:release-cut
├── .colony.json                     # canonicalSkillsDir: "skills"
├── .skills-registry.md              # 5 active rows + 1 archived (goreleaser-config → migrated)
└── skills/
    ├── release-cut/
    │   ├── SKILL.md
    │   └── scripts/release-cut.sh   # Runs — echoes a dry-run release plan
    ├── cross-compile-matrix/SKILL.md
    ├── flag-add/SKILL.md
    ├── manpage-sync/SKILL.md
    └── breaking-change-audit/SKILL.md
```

### Try it in 60 seconds

```bash
cp -r examples/cli-tool /tmp/skdd-cli-demo
cd /tmp/skdd-cli-demo
mkdir -p skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o skills/skillforge/SKILL.md
# open with your agent; ask: "What skills are available in this project?"
npm run skills:release-cut -- v1.2.0   # prints a dry-run release plan
```

### What runs vs. what's illustrative

| Path | Status |
|------|--------|
| `skills/release-cut/scripts/release-cut.sh` | **Runs** — dry-run stub prints a release plan |
| `skills/*/SKILL.md` | **Illustrative** — the agent reads them like real skills |
| `.skills-registry.md` | **Illustrative** — the agent parses it |
| `npm run skills:list` / `skills:release-cut` | Work |
| Rust / Go source code | Does not exist |

---

## data-pipeline

> **Persona:** a team running dbt-style transforms, pandas ETL pipelines, and a lightweight model-training loop. Five skills for the data-engineering lifecycle, including one forked from a sister colony.

**GitHub:** [`examples/data-pipeline/`](https://github.com/zakelfassi/skills-driven-development/tree/main/examples/data-pipeline)

### Skill roster

| Skill | Real script? | Description |
|-------|-------------|-------------|
| `dataset-onboard` | — | Schema sniff, profiling notebook, ingestion job, data dictionary entry |
| `pipeline-stage` | — | Scaffold an idempotent transform stage with schema contract and tests |
| `experiment-log` | ✅ `scripts/log-experiment.sh` | Record params + metrics; append structured row to experiments ledger |
| `data-quality-gate` | — | Add/extend validation checks — forked from `analytics-core` colony |
| `backfill-runbook` | — | Safe historical backfill: scope, dry-run, chunked execution, verification |

### File tree

```
examples/data-pipeline/
├── AGENTS.md
├── CLAUDE.md
├── package.json                     # Stub; scripts: skills:list, skills:experiment-log
├── .colony.json                     # canonicalSkillsDir: "skills"
├── .skills-registry.md              # 5 active rows; data-quality-gate has forked: provenance
└── skills/
    ├── dataset-onboard/SKILL.md
    ├── pipeline-stage/SKILL.md
    ├── experiment-log/
    │   ├── SKILL.md
    │   └── scripts/log-experiment.sh  # Runs — appends a fake row, prints it
    ├── data-quality-gate/SKILL.md
    └── backfill-runbook/SKILL.md
```

### Try it in 60 seconds

```bash
cp -r examples/data-pipeline /tmp/skdd-data-demo
cd /tmp/skdd-data-demo
mkdir -p skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o skills/skillforge/SKILL.md
# open with your agent; ask: "What skills are available in this project?"
npm run skills:experiment-log   # appends a fake experiment row and prints it
```

### What runs vs. what's illustrative

| Path | Status |
|------|--------|
| `skills/experiment-log/scripts/log-experiment.sh` | **Runs** — appends a fake experiment row and prints it |
| `skills/*/SKILL.md` | **Illustrative** — the agent reads them like real skills |
| `.skills-registry.md` | **Illustrative** — the agent parses it |
| `npm run skills:list` / `skills:experiment-log` | Work |
| Python / dbt source code | Does not exist |

---

## Adapting to your own project

1. Copy the colony closest to your stack into your project root.
2. Replace the skill stubs with ones you forge while doing real work.
3. Wire in the actual scripts (the `deploy-preview.sh` / `release-cut.sh` pattern scales up).
4. Run `skdd validate skills/` to confirm every skill passes the spec.
5. Run `skdd doctor` from your project root to check symlinks and registry health.

See [Configuration](./configuration/) for harness-specific wiring, and [Forging skills](./forging-skills/) for the full forging workflow.
