# Packs

A **pack** is a themed, importable set of skills that travel together — forged around one methodology, event, or workflow family rather than one project.

Packs are just directories of spec-compliant skills plus a README. There is no special tooling beyond the CLI: `skdd add <owner>/<repo> <drop-id>` installs a pack from a Commons repo, validates every skill, registers them with provenance, and refreshes harness mirrors.

## Where packs live

Community packs live in **[SkDD Commons](https://github.com/zakelfassi/skdd-commons)** — *skills that evolve in public* — released as curated, dated **drops** (`YYYY-MM-<theme>`). Drops sort chronologically, and every skill carries its `forged-*` provenance. Skills live in one place only (the Commons); this directory documents the concept and indexes featured drops.

## Featured drops

| Drop | Skills | Theme |
|------|--------|-------|
| [2026-07-frontier](https://github.com/zakelfassi/skdd-commons/tree/main/packs/2026-07-frontier) — *the Fable Festival drop* | 6 | Working practices for frontier-model sessions — delegation altitude, adversarial review, subtraction, closed loops, swarms, and artifact extraction. Forged by claude-fable-5 on 2026-07-01, its first day back from the export-control shutdown. |

## Install a drop

```bash
pnpm dlx @zakelfassi/skdd add zakelfassi/skdd-commons 2026-07-frontier        # project colony
pnpm dlx @zakelfassi/skdd add zakelfassi/skdd-commons 2026-07-frontier -g    # global colony
```
