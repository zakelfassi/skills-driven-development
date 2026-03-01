# Agent Configuration — webapp-starter

This is a sample project demonstrating Skills-Driven Development.

## Agent Setup

This project uses AI agents for development. Agents should:

1. **Load skills at session start** — read `.skills-registry.md` to discover available skills
2. **Use skills before re-deriving** — if a skill exists for the task, follow it
3. **Forge new skills** — when you notice a repeated pattern (2-3 occurrences), invoke `skillforge`
4. **Evolve existing skills** — when you encounter an edge case a skill doesn't cover, update it

## Available Skills

See `.skills-registry.md` for the current inventory.

## Project Conventions

- **Framework:** React + TypeScript + Express
- **Testing:** Vitest for unit, Playwright for E2E
- **Deployment:** Preview branches deploy to staging automatically
- **API shape:** All endpoints return `{ data, error, meta }`
- **Components:** Co-locate styles, tests, and stories with components

## Skill Directories

```
.skills/
├── skillforge/           # Meta-skill: create new skills
├── deploy-preview/       # Deploy preview branches to staging
├── component-scaffold/   # Create React components with tests
├── api-endpoint/         # Scaffold REST API endpoints
└── bug-triage/           # Triage bug reports into issues
```

## When to Forge vs. When to Code

| Signal | Action |
|--------|--------|
| You've done the same steps 3 times | **Forge a skill** |
| A convention isn't written down | **Forge a skill** |
| It's a one-off fix | **Just code it** |
| A skill exists but misses an edge case | **Update the skill** |
| A skill is over 200 lines | **Split it** |
