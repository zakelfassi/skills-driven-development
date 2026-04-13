---
description: List the SkDD skills registered in this project
argument-hint: "[filter]"
---

# /skills

You are being asked to list the skills available in this project's SkDD colony.

## What the user typed

```
/skills $ARGUMENTS
```

## Your task

1. Look for the colony registry in this order:
   - `.skills-registry.json` at the project root (machine-readable)
   - `.skills-registry.md` at the project root (human-readable)
   - If neither exists, report: "No SkDD colony detected. Run `skdd init` (if you have the CLI) or see docs/integrations/claude-code.md for setup. No skills registered yet."
2. Parse the registry. For each active skill, show: name, source, last-used (if present), uses (if present), and description.
3. If `$ARGUMENTS` is non-empty, treat it as a case-insensitive filter — only show skills whose name or description contains the filter string.
4. Also list the skills actually present on disk under `.claude/skills/` (or whichever plugin/scope provides them). If a skill is on disk but not in the registry, flag it as "unregistered — consider adding to `.skills-registry.md`". If a skill is in the registry but not on disk, flag it as "dangling — file missing".
5. Format the output as a table with columns: **Skill**, **Source**, **Status**, **Description**. Use Markdown so it renders cleanly in Claude Code's chat.

## What to do next

After listing, suggest one follow-up based on what you see:

- If the registry is empty: suggest `/forge <name>` to create the first skill.
- If there are unregistered skills on disk: suggest updating `.skills-registry.md` (offer to do it inline).
- If there are dangling entries: suggest running `skdd validate` to clean them up, or ask whether to remove them.
- If everything is tidy: suggest the user look for repeated work in the current session that could become a new skill.

## Rules

- **Never** invent skills that aren't in the registry or on disk.
- **Never** modify the registry without asking first — listing is read-only by default.
- If `skdd` CLI is available on the user's PATH, mention that they can also run `skdd list` from a terminal for a harness-agnostic view.
