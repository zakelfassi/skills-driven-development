---
description: Forge a new SkDD skill from a repeated pattern (shortcut for the skillforge meta-skill)
argument-hint: "<skill-name> [-- description]"
---

# /forge

You are being asked to forge a new skill as part of a Skills-Driven Development workflow.

## What the user typed

```
/forge $ARGUMENTS
```

## Your task

1. Parse `$ARGUMENTS`. The first whitespace-delimited token is the skill name. Everything after `--` (if present) is an optional description. Examples:
   - `/forge deploy-preview` → name = `deploy-preview`, no description yet
   - `/forge deploy-preview -- Deploy the current branch to staging for review` → name = `deploy-preview`, description = `Deploy the current branch to staging for review`
2. Validate the name against the Agent Skills spec:
   - Lowercase alphanumeric and hyphens only
   - 1-64 characters
   - Must not start or end with a hyphen; must not contain `--` (unless used as the description separator)
   - If invalid, tell the user exactly what's wrong and stop.
3. Load the skillforge skill (`skdd-claude:skillforge`, or the project-scope `skillforge` if present). Follow its steps literally:
   - Ask the user for inputs you don't have (description, triggers, steps, conventions, edge cases) — do not fabricate.
   - Write the new `SKILL.md` to `.claude/skills/<name>/SKILL.md`.
   - Append a row to `.skills-registry.md` at the project root.
   - Update `.skills-registry.json` too if it exists.
4. When done, summarize in one paragraph:
   - Where the skill was written
   - What the registry now contains
   - What the next session will see

## Rules

- **Never** skip the registry update. A forged skill that isn't registered is invisible to future agents.
- **Never** fabricate steps for the skill body. Ask the user if you don't know.
- **Always** include trigger language in the description (`Use when …`) so future sessions can discover the skill.
- **Prefer** updating an existing skill over forging a new similar one. If a skill with the same name already exists, stop and ask the user whether to update it instead.

After forging, suggest the user commit the new skill (`git add .claude/skills/<name> .skills-registry.md && git commit -m "forge: <name>"`).
