# webapp-starter — Claude Code instructions

This is a **reference structure**, not a runnable webapp. It exists to show how a SkDD-enabled project is wired: where skills live, what the registry looks like, and what the agent is asked to do.

## Skills

Skills live under `skills/<name>/SKILL.md`. The registry is at `.skills-registry.md` in this directory.

At session start, read `.skills-registry.md` to discover available skills. Before deriving a solution, check whether an existing skill covers the task and follow it. When you notice a pattern repeat 2-3 times, or when I ask you to "forge a skill for X", invoke the `skillforge` skill and follow its steps. Update the registry after forging or using a skill.

The `skillforge` meta-skill is not in this directory — in a real project it would live at `skills/skillforge/SKILL.md`. To try this example end-to-end, copy `../../skillforge/SKILL.md` into `skills/skillforge/SKILL.md` first.

## Project conventions (illustrative)

- **Framework:** React + TypeScript + Express (not actually installed — this is reference-only)
- **Testing:** Vitest for unit, Playwright for E2E
- **API shape:** all endpoints return `{ data, error, meta }`
- **Components:** co-located (component + test + story in one directory)

## Do not

- Do not `pnpm install` or try to run `dev` scripts in this directory — there is no code.
- Do not treat the skills here as active tools; they are fixtures for documentation.
