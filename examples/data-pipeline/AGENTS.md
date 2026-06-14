# Agent Configuration — data-pipeline

> **Heads up — this is a reference structure, not a runnable pipeline.** There is no Python source code, no dbt project, and no database connection here. The files exist to show the *shape* of a SkDD-enabled data/ML project: where `.skills-registry.md` lives, what forged SKILL.md files look like, and how `AGENTS.md` / `CLAUDE.md` should describe the colony. Scripts referenced from the skills (e.g. `scripts/log-experiment.sh`) are **stubs** that print what a real step would do; others are intentionally absent. Fork this into a real project to make the skills actually execute.

This is a reference colony for a Python data-engineering and ML project. It demonstrates SkDD for teams running dbt-style transforms, pandas/Spark ETL pipelines, and a lightweight model-training loop.

## Agent Setup

This project uses AI agents for development. Agents should:

1. **Load skills at session start** — read `.skills-registry.md` to discover available skills
2. **Use skills before re-deriving** — if a skill exists for the task, follow it
3. **Forge new skills** — when you notice a repeated pattern (2-3 occurrences), invoke `skillforge`
4. **Evolve existing skills** — when you encounter an edge case a skill doesn't cover, update it

## Available Skills

See `.skills-registry.md` for the current inventory.

## Project Conventions

- **Language:** Python 3.11+
- **Transform layer:** dbt-core (illustrative) or pandas-based ETL
- **Experiment tracking:** custom ledger in `experiments/log.csv` + artifact store
- **Data quality:** Great Expectations (illustrative) or custom assertion framework
- **Testing:** pytest with fixture datasets in `tests/fixtures/`
- **Scheduler:** Airflow / Prefect DAGs (illustrative)

## Skill Directories

```
skills/
├── dataset-onboard/      # Onboard a new raw dataset
├── pipeline-stage/       # Scaffold a new transform stage
├── experiment-log/       # Record a training run
├── data-quality-gate/    # Add / extend validation checks
└── backfill-runbook/     # Safe historical data backfill
```

## When to Forge vs. When to Code

| Signal | Action |
|--------|--------|
| You've done the same steps 3 times | **Forge a skill** |
| A convention isn't written down | **Forge a skill** |
| It's a one-off fix | **Just code it** |
| A skill exists but misses an edge case | **Update the skill** |
| A skill is over 200 lines | **Split it** |
