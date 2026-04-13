# skdd-claude — SkDD plugin for Claude Code

> One-click install of the Skills-Driven Development meta-skill plus `/forge` and `/skills` slash commands.

## Install

From the SkDD repo root:

```bash
claude plugins install ./plugins/skdd-claude
```

Or point Claude Code's plugin marketplace at this directory once SkDD is published.

## What you get

| Component | Path | Purpose |
|-----------|------|---------|
| `skillforge` skill | `skills/skillforge/SKILL.md` | Guides the agent through forging a new, spec-compliant skill. |
| `/forge` slash command | `commands/forge.md` | Shortcut that tells the agent to invoke the skillforge for a named pattern. |
| `/skills` slash command | `commands/skills.md` | Lists the skills currently in `.skills-registry.md`. |
| Plugin README | `README.md` | This file. |

The plugin does **not** bundle the example webapp-starter or the broader SkDD docs — it's a minimal runtime drop-in. For the full methodology, see the repo root at [`../../README.md`](../../README.md).

## First run

After install, open any project and try:

```
/skills
```

If the project has a `.skills-registry.md`, Claude Code lists its entries. If it doesn't, the command suggests running `skdd init` (or the manual setup from [`../../docs/integrations/claude-code.md`](../../docs/integrations/claude-code.md)).

Then try:

```
/forge bump-package-version
```

Claude Code loads the skillforge skill (namespaced as `skdd-claude:skillforge`), walks through its checklist, and writes a new skill to `.claude/skills/bump-package-version/SKILL.md`.

## Namespacing

Plugin-scope skills are namespaced in Claude Code as `<plugin>:<skill>`. So the plugin's skillforge is addressable as `skdd-claude:skillforge`. If you also drop a copy of the skillforge into your project's `.claude/skills/skillforge/`, both will coexist — Claude Code picks the right one based on context. For production use, prefer the plugin-scope version (updates automatically when the plugin is bumped).

## Updating

```bash
cd path/to/skills-driven-development && git pull && claude plugins install --force ./plugins/skdd-claude
```

## Uninstall

```bash
claude plugins uninstall skdd-claude
```

Skills you forged in your own projects remain — only the plugin's bundled meta-skill and slash commands are removed.

## Relationship to the `skdd` CLI

The CLI (`skdd` npm package) and this plugin are independent but complementary:

- **CLI** — runs outside Claude Code, works with any harness, useful in CI and scripts.
- **Plugin** — runs inside Claude Code only, provides slash commands and namespaced skills.

You can use one, the other, or both. Teams that standardize on Claude Code usually install the plugin and optionally add the CLI for CI validation.
