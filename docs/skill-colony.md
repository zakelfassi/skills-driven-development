# The Skill Colony

> A shared, evolving library of agent capabilities that grows through use.

## What is a Skill Colony?

A skill colony is what happens when skills stop being static files and start behaving like living organisms:

- They're **born** when an agent notices a repeatable pattern
- They **grow** when agents encounter edge cases and update the skill
- They **reproduce** when skills are forked across projects
- They **compete** when multiple skills solve the same problem (the better one gets used more)
- They **decay** when they go unused (and can be archived)

## Colony vs. Library

| Aspect | Skill Library | Skill Colony |
|--------|--------------|--------------|
| Creation | Human authors skills | Agents forge skills during work |
| Maintenance | Human updates manually | Agents evolve skills through use |
| Discovery | Explicit import/reference | Agents search and match by description |
| Sharing | Copy-paste between projects | Fork, adapt, contribute back |
| Quality | Review-gated | Usage-weighted (popular skills survive) |

## Colony Architecture

```
┌─────────────────────────────────────────────┐
│              Colony Registry                 │
│  (shared index of available skills)          │
│                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ Project A │ │ Project B │ │ Project C │    │
│  │ skills/   │ │ skills/   │ │ skills/   │    │
│  │  deploy   │ │  deploy*  │ │  review   │    │
│  │  scaffold │ │  scaffold*│ │  scaffold*│    │
│  │  review   │ │  monitor  │ │  deploy*  │    │
│  └──────────┘ └──────────┘ └──────────┘    │
│       │              │             │         │
│       └──────────────┼─────────────┘         │
│                      │                        │
│              Fork / Evolve / Share            │
└─────────────────────────────────────────────┘

* = forked from another project
```

## Colony Lifecycle

### Phase 1: Genesis
An agent is working on a task and notices friction:

```
"I've scaffolded 3 API endpoints this session,
each time doing the same steps. This should be a skill."
```

The agent invokes `skillforge` and creates `.skills/api-endpoint/SKILL.md`.

### Phase 2: Refinement
The same agent (or another) uses the skill and hits an edge case:

```
"The api-endpoint skill doesn't handle authentication middleware.
Let me update it."
```

The skill evolves. The SKILL.md gets a new section. Maybe a script gets added.

### Phase 3: Colony Spread
Another project needs API endpoint scaffolding. The agent discovers the skill via the colony registry:

```
"Found api-endpoint skill from project-alpha.
Forking and adapting for this project's conventions."
```

The skill is forked. The fork diverges (different auth patterns, different frameworks). Both versions are valid.

### Phase 4: Natural Selection
Over time, some skills get used constantly. Others rot. The colony registry tracks usage:

```
api-endpoint        ████████████  (used 47 times across 5 projects)
deploy-preview      ██████████    (used 31 times across 3 projects)
xml-parser          █             (used once, 4 months ago)
```

Low-usage skills can be archived. High-usage skills can be promoted to "core" status.

## Registry Format

The colony registry is a simple markdown file that lives at the colony level:

```markdown
# .skills-registry.md

## Available Skills

| Skill | Source | Last Used | Uses | Description |
|-------|--------|-----------|------|-------------|
| api-endpoint | local | 2026-02-28 | 12 | Scaffold REST endpoints with validation |
| deploy-preview | forked:project-alpha | 2026-02-27 | 8 | Deploy preview branches to staging |
| component-scaffold | local | 2026-02-25 | 15 | Create React components with tests |
| bug-triage | forked:ops-team | 2026-02-20 | 5 | Triage bug reports into actionable issues |
```

Agents read this file at session start to know what's available. They update it when skills are used, created, or evolved.

## Discovery Mechanisms

How does an agent in Project C find a skill from Project A?

### Option 1: Explicit registry (simplest)
A shared `.skills-registry.md` that lists skills across projects. Works for small teams.

### Option 2: Git-based discovery
Skills live in a central repo (like this one). Projects fork what they need. Updates flow through PRs.

### Option 3: Agent-to-agent sharing
Agents publish skills to a shared endpoint. Other agents query by description similarity. This is the most autonomous but requires infrastructure.

### Recommended starting point: Option 2
Fork skills from a central repo. Evolve locally. Contribute improvements back via PR. Simple, auditable, human-reviewable.

## Anti-Patterns

### Over-forging
Creating a skill for every single task. A skill should be reused at least 3 times before it earns its place.

### Skill sprawl
Too many overlapping skills with no curation. The registry should be reviewed periodically (by humans or agents).

### Frozen skills
Skills that were forged once and never updated. If a skill hasn't been touched in 90 days and isn't being used, archive it.

### Monolith skills
Skills that try to do too much. If a SKILL.md is over 300 lines, it should probably be split into composed skills.
