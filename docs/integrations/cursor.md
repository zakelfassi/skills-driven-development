# Cursor

> Cursor's agent mode reads Agent Skills natively. SkDD plugs in via `.cursor/skills/` and a rules file.

## Install

```bash
mkdir -p .cursor/skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o .cursor/skills/skillforge/SKILL.md
touch .skills-registry.md
```

Or with the CLI:

```bash
pnpm dlx skdd init --harness=cursor
```

## Configure

Cursor has two instruction surfaces: `.cursor/rules/*.mdc` (rules) and the legacy `AGENTS.md` / `CLAUDE.md`. SkDD uses a rules file so the instructions apply to Cursor's agent mode specifically.

Create `.cursor/rules/skills.mdc`:

```markdown
---
description: Skills-Driven Development colony wiring
alwaysApply: true
---

Skills live under `.cursor/skills/<name>/SKILL.md`. The registry is at `.skills-registry.md` in the project root.

At session start, read `.skills-registry.md` to discover available skills. Before deriving a solution, check whether an existing skill covers the task and follow it. When you notice a pattern repeat 2-3 times, or when I ask you to "forge a skill for X", invoke the `skillforge` skill and follow its steps. Update the registry after forging or using a skill.
```

The `alwaysApply: true` frontmatter ensures Cursor injects the rule into every agent conversation.

## Verify

In Cursor's agent chat, run the three-question check:

1. *"List the skills you can see."*
2. *"Forge a skill for writing Changesets with pnpm."*
3. *(Reload the window)* *"What skills are available?"*

## Rules file vs settings

Cursor also supports project-level settings at `.cursor/settings.json`. SkDD does not use it — rules files are better for skill wiring because they're markdown-native and easy to review in PRs. If you already have project settings for other purposes, leave them alone; the rules file and settings coexist.

## Troubleshooting

**Agent mode doesn't pick up the rule.** Confirm the rule file is at `.cursor/rules/` not `.cursor/` directly. Also confirm the frontmatter has `alwaysApply: true` — without it, the rule only activates when Cursor matches specific files.

**Non-agent chats don't see skills.** Correct: skills are an agent-mode feature. Classic Cursor chat doesn't honor them. Use agent mode (Cmd+L → agent toggle) for skill-aware sessions.
