# Skill Discovery

> How agents find the right skill for the right task.

## Discovery Flow

When an agent starts a task, it should check for relevant skills before working:

```
1. Read .skills-registry.md
2. Match task description against skill descriptions
3. If match found → load SKILL.md → follow it
4. If no match → work normally → consider forging if pattern emerges
```

## Matching Strategies

### Description matching (recommended)
The `description` field in SKILL.md is the primary discovery surface. Write descriptions that include:
- **What the skill does** ("Scaffold a REST API endpoint")
- **When to use it** ("Use when creating new API endpoints")
- **Trigger phrases** ("when asked to build a new backend route")

Good descriptions make discovery automatic. Bad descriptions make skills invisible.

### Registry scanning
The `.skills-registry.md` provides a quick index. Agents read it at session start to build a mental model of what's available.

### Cross-project discovery
When working across multiple projects:
1. Check the current project's `.skills-registry.md`
2. Check a shared/central skills repo (if configured)
3. Search by description similarity

## Discovery Anti-Patterns

### Silent skills
A skill exists but its description doesn't match common task phrasings. Fix: add more trigger phrases to the description.

### Phantom skills
A skill is referenced in the registry but the directory is missing. Fix: clean the registry periodically.

### Discovery bypass
An agent re-derives a solution that already exists as a skill. Fix: make registry scanning a mandatory first step in agent configuration (see AGENTS.md).
