# Forging Skills

> How agents create skills on the fly — and when they should.

## The Forge Trigger

An agent should forge a new skill when it notices **repeated friction** — the same pattern appearing 2-3 times in the same session or across sessions.

### Trigger phrases the agent should recognize

When the user (or an agent talking to itself) says any of these, treat it as an explicit forge request:

- "forge a skill for X", "let's make this a skill", "save this as a skill"
- "scaffold a new skill", "create a skill that does Y"
- "every project I touch needs this — capture it"
- "we've done this three times this week, write it down"

When the agent *notices on its own*, the following are self-talk signals to act on:

- "I just did this same sequence of steps for the third time"
- "This workaround keeps coming up and I keep re-explaining it"
- "There's a project convention that isn't written down anywhere"
- "I solved a hard problem and the solution has reusable parts"

Once triggered, load `skillforge/SKILL.md` (or the `skillforge` skill from the active colony) and follow its steps. Explicit user requests override the "2-3 repeats" heuristic — if the user asks, forge it.

### Signals that a skill should NOT be forged

- One-time task with no reuse potential
- The pattern is too specific to a single context
- An existing skill already covers it (update instead of creating)
- The "skill" is really just a single command (use a script, not a skill)

## The Forging Process

### Step 1: Recognize the pattern
The agent identifies repeated work during a task:

```
"I've now set up 3 API endpoints this session. Each time I:
1. Create the route file
2. Add validation middleware
3. Write the controller
4. Add the test file
5. Update the route index

This should be a skill."
```

### Step 2: Abstract the pattern
Strip away the specific details. Keep the structure:

- What are the **inputs**? (entity name, fields, auth requirement)
- What are the **steps**? (the sequence, in order)
- What are the **outputs**? (files created, configs updated)
- What are the **edge cases**? (auth vs no-auth, nested routes, etc.)

### Step 3: Write the SKILL.md
Follow the [Agent Skills spec](https://agentskills.io/specification.md):

```markdown
---
name: api-endpoint
description: Scaffold a REST API endpoint with route, controller, validation, and tests. Use when creating new API endpoints or when asked to add a new resource.
---

# API Endpoint Scaffold

## Inputs
- Entity name (singular, e.g., "comment")
- Fields (name:type pairs)
- Auth required? (boolean)

## Steps
1. Create route file at `src/routes/{entity}.ts`
2. Add validation schema using project's validator
3. Create controller at `src/controllers/{entity}.controller.ts`
4. Create test file at `tests/{entity}.test.ts`
5. Register route in `src/routes/index.ts`

## Conventions
- Use plural for route paths (`/comments`)
- Use singular for file names (`comment.ts`)
- All endpoints return JSON with `{ data, error, meta }` shape
- Tests use the project's test factory for fixtures

## Edge Cases
- If auth required: add auth middleware to route registration
- If nested route (e.g., post/comments): use parent ID in path
```

### Step 4: Add scripts (optional)
If the skill involves file generation, add executable scripts:

```
.skills/api-endpoint/
├── SKILL.md
└── scripts/
    └── scaffold.sh    # Creates the boilerplate files
```

### Step 5: Register in the colony
Update `.skills-registry.md`:

```markdown
| api-endpoint | local | 2026-02-28 | 1 | Scaffold REST endpoints with validation |
```

## Skill Evolution

Skills aren't write-once. They evolve through use:

### Adding edge cases
An agent uses the skill and encounters something it doesn't cover:

```
"The api-endpoint skill doesn't handle file upload endpoints.
Adding a section for multipart/form-data routes."
```

### Improving scripts
A script fails on an edge case. The agent fixes it and updates the skill.

### Splitting skills
A skill grows too large. The agent splits it into focused sub-skills:

```
api-endpoint (original, 200+ lines)
  → api-endpoint (core, 80 lines)
  → api-endpoint-auth (auth patterns, 60 lines)
  → api-endpoint-upload (file handling, 50 lines)
```

### Deprecating skills
A skill becomes obsolete (framework change, convention shift). The agent marks it:

```yaml
---
name: api-endpoint-v1
description: "[DEPRECATED: use api-endpoint-v2] Old endpoint scaffold..."
---
```

## Skills as Living Memory

The key insight of SkDD is that skills are a form of **externalized agent memory**:

| Memory Type | Traditional Agent | SkDD Agent |
|-------------|------------------|-----------|
| How to do a task | Re-derived from training data each time | Read from skill |
| Project conventions | Lost between sessions | Encoded in skill conventions section |
| Learned edge cases | Forgotten | Added to skill over time |
| Workflow improvements | Never captured | Skill evolves to include better approaches |

Skills are **process memory that persists across sessions, agents, and projects.**

This is why SkDD treats skill forging not as overhead, but as one of the most valuable things an agent can do: every skill forged is future context saved.
