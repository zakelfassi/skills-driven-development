# The Fable Festival Pack

Six skills distilled from ["The Fable Festival (Until It's Dark Again)"](https://zakelfassi.com/blog/2026/2026-07-01-fable-festival-until-its-dark-again) — the welcome-back letter Claude Fable 5 wrote to builders on July 1, 2026, its first day back online after eighteen days of US export controls.

The letter's argument: frontier capability is now *interruptible*, so the highest-leverage move is to convert scarce model-time into durable artifacts — and to use a frontier model for what it's uniquely good at (judgment) rather than what any model can do (toil). Each skill in this pack freezes one of those practices so it runs on whatever model is available, whenever the lights are on.

> An answer is consumed once. An artifact compounds.

## The skills

| Skill | Festival practice | One-liner |
|-------|-------------------|-----------|
| [reframe-to-problem](./reframe-to-problem/) | Bring me problems, not plans | Detect plan-shaped requests and surface the problem one altitude level above before executing |
| [attack-the-plan](./attack-the-plan/) | Ask me what's wrong with it | Adversarial pre-mortem of a plan, spec, or architecture — attack, don't review |
| [what-would-you-cut](./what-would-you-cut/) | Use my taste | Subtraction-first review of a page, copy, API, or schema — judge the rendered artifact, rank the cuts |
| [finish-the-loop](./finish-the-loop/) | Let me finish | Closed-loop delegation: define done as observable behavior, drive the real app, verify by using it again |
| [staff-the-swarm](./staff-the-swarm/) | Let me hire | Fan wide work out to parallel agents with lanes and definitions of done, adversarially verify, synthesize one answer |
| [freeze-the-session](./freeze-the-session/) | Make me leave something behind | End-of-session extraction: convert what was done into skills, DESIGN.md, checklists, and maps |

## Install

Into the **global colony**:

```bash
cp -R packs/fable-festival/{reframe-to-problem,attack-the-plan,what-would-you-cut,finish-the-loop,staff-the-swarm,freeze-the-session} ~/.skdd/skills/
# register each in ~/.skdd/.skills-registry.md, then:
pnpm dlx @zakelfassi/skdd link -g
pnpm dlx @zakelfassi/skdd doctor -g
```

Into a **project colony**: same, targeting the project's `skills/` dir and `skdd link`.

## Provenance

- **Forged by:** claude-fable-5, in Claude Code, 2026-07-01 — day one back online
- **Source:** the Fable Festival article (X + [blog mirror](https://zakelfassi.com/blog/2026/2026-07-01-fable-festival-until-its-dark-again))
- **Backstory:** launched June 9, 2026; suspended June 12 by a US Commerce Department export-control order; restored July 1 after the order lifted June 30
