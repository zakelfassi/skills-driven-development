---
name: skillforge
description: Create or update a reusable agent skill. Use when you notice a repeated pattern, when a workflow should be persisted for future sessions, or when asked to forge/create/scaffold a new skill.
metadata:
  author: zakelfassi
  version: "2.0"
  spec: agentskills.io
---

# SkillForge

Create well-formed, spec-compliant skills from observed patterns.

## When to Forge

✅ **Forge when:**
- You've done the same sequence 2-3 times in a session
- A project convention isn't documented anywhere
- You solved a hard problem with a reusable solution
- Someone asks you to create a skill

❌ **Don't forge when:**
- It's a one-time task
- An existing skill already covers it (update instead)
- The "skill" is just a single command (use a script alias)

## Steps

### 1. Name the pattern
- What problem does this skill solve?
- What triggers it? (be specific — the `description` field is the discovery surface)
- What are the inputs and outputs?

### 2. Choose a name
- `kebab-case`, 1-64 characters
- Verb-led when possible: `deploy-preview`, `scaffold-component`, `triage-bug`
- One responsibility per skill

### 3. Create the skill directory

```bash
mkdir -p .skills/<skill-name>
```

### 4. Write SKILL.md

Use this skeleton:

```markdown
---
name: <skill-name>
description: <what it does>. Use when <triggers>.
metadata:
  forged-by: <agent-id>
  forged-from: <session-or-context>
  forged-reason: "<why this was created>"
---

# <Skill Name>

## Inputs
- ...

## Steps
1. ...
2. ...

## Conventions
- Project-specific patterns that apply

## Edge Cases
- Known gotchas or special handling
```

### 5. Add scripts (optional)
If the skill involves file generation or automation:

```
.skills/<skill-name>/
├── SKILL.md
├── scripts/
│   └── run.sh         # Executable automation
└── references/
    └── conventions.md # Detailed reference (keeps SKILL.md lean)
```

### 6. Register the skill
Update `.skills-registry.md` (create if it doesn't exist):

```markdown
| <skill-name> | local | <today> | 1 | <description> |
```

## Updating an Existing Skill

When you use a skill and encounter something it doesn't cover:

1. Add the new edge case or step to the existing SKILL.md
2. If the skill is getting too long (>200 lines), split it
3. Update `last-used` and increment `usage-count` in the registry

## Quality Checklist

Before committing a new skill:

- [ ] `name` is kebab-case, ≤64 chars
- [ ] `description` includes what it does AND when to use it
- [ ] Steps are numbered and actionable
- [ ] No hardcoded paths, secrets, or environment-specific values
- [ ] SKILL.md is under 200 lines (move details to `references/`)
- [ ] Registered in `.skills-registry.md`
