# data-pipeline — try SkDD in 60 seconds

> Reference colony for a Python data-engineering and ML project. **Not a runnable pipeline** — no Python, no dbt project, no database connection. What you get instead is the exact *shape* of a project that uses skills: where they live, what the registry looks like, and what the agent is told to do.

## What's in here

```
data-pipeline/
├── AGENTS.md                         # Harness-agnostic agent config
├── CLAUDE.md                         # Claude Code project instructions
├── package.json                      # Minimal stub — anchors the project; not a real build
├── .skills-registry.md               # The colony registry (markdown table)
└── skills/
    ├── dataset-onboard/SKILL.md      # Onboard a new raw dataset
    ├── pipeline-stage/SKILL.md       # Scaffold a new transform stage
    ├── experiment-log/
    │   ├── SKILL.md                  # Record a training run
    │   └── scripts/
    │       └── log-experiment.sh     # The one real, executable script (a stub)
    ├── data-quality-gate/SKILL.md    # Add / extend data validation checks
    └── backfill-runbook/SKILL.md     # Safe historical backfill runbook
```

## Try it (60 seconds)

1. **Copy this directory somewhere you'll open with your agent**:
   ```bash
   cp -r examples/data-pipeline /tmp/skdd-data-demo
   cd /tmp/skdd-data-demo
   ```
2. **Drop in the skillforge meta-skill**:
   ```bash
   mkdir -p skills/skillforge
   curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
     -o skills/skillforge/SKILL.md
   ```
3. **Open it with Claude Code** (or the harness of your choice — see [`docs/configuration.md`](../../docs/configuration.md)).
4. **Ask the agent**: *"What skills are available in this project?"* — the agent should read `.skills-registry.md` and list all five skills plus `skillforge`.
5. **Run the one real script**: `npm run skills:experiment-log` — it appends a fake row to the experiments ledger and prints it.

## What's illustrative vs. what actually runs

| Path | Status |
|------|--------|
| `skills/experiment-log/scripts/log-experiment.sh` | **Runs** — stub that appends a fake experiment row and prints it |
| `skills/*/SKILL.md` | **Read-only fixtures** — the agent reads them like real skills |
| `.skills-registry.md` | **Read-only fixture** — the agent parses it |
| `package.json` scripts | `skills:list` and `skills:experiment-log` work; there are no other commands |
| Imagined Python / dbt source | Does not exist |
| `dbt run`, `pytest`, `python train.py` | Will not work — no source code |

## Skill roster

| Skill | Real script? | Description |
|-------|-------------|-------------|
| `dataset-onboard` | — | Schema sniff, profiling notebook, ingestion job, data dictionary entry |
| `pipeline-stage` | — | Scaffold an idempotent transform stage with schema contract and tests |
| `experiment-log` | ✅ `scripts/log-experiment.sh` | Record params, metrics, artifacts; append structured row to experiments ledger |
| `data-quality-gate` | — | Add/extend validation checks (forked from `analytics-core`) |
| `backfill-runbook` | — | Safe historical backfill: scope, dry-run, chunked execution, verification |

## Forked skill

`data-quality-gate` was forked from the `analytics-core` colony. The original skill enforced numeric-range checks; this version adds null-percentage and referential-integrity checks specific to this pipeline. See the `fork-of` metadata field in `skills/data-quality-gate/SKILL.md`.

## Next steps

- Fork this into a real Python/dbt project, replace the example skills with ones you forge while working, and wire in a real `log-experiment.sh`.
- Read [`../../docs/configuration.md`](../../docs/configuration.md) for harness-specific setup.
- Read [`../../docs/forging-skills.md`](../../docs/forging-skills.md) for the forging workflow.
