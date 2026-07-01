# skdd-claude — SkDD plugin for Claude Code

> One-click install of the Skills-Driven Development meta-skill plus `/forge` and `/skills` slash commands.

## Install

From the SkDD repo root:

```bash
claude plugin install ./plugins/skdd-claude
```

Or install directly from GitHub once SkDD is published:

```bash
claude plugin install github.com/zakelfassi/skills-driven-development/plugins/skdd-claude
```

## What you get

| Component | Path | Purpose |
|-----------|------|---------|
| `skillforge` skill | `skills/skillforge/SKILL.md` | Guides the agent through forging a new, spec-compliant skill. |
| `/forge` slash command | `commands/forge.md` | Shortcut that tells the agent to invoke the skillforge for a named pattern. |
| `/skills` slash command | `commands/skills.md` | Lists the skills currently in `.skills-registry.md`. |
| `/skdd-hooks` slash command | `commands/skdd-hooks.md` | Toggles the two enforcement hooks on/off per project. |
| Enforcement hooks | `hooks/hooks.json` + `scripts/*.mjs` | Opt-in gates for `finish-the-loop` and `freeze-the-session` (see below). |
| Plugin README | `README.md` | This file. |

## Enforcement hooks (opt-in, off by default)

> A skill is a procedure the model follows when it decides to; a hook is a gate for when it forgets.

Two hooks ship with the plugin, both **inert until you enable them** with `/skdd-claude:skdd-hooks on` (state lives in `.claude/skdd.local.md`, per project, survives sessions):

- **`finish-the-loop`** (Stop gate) — when the session changed non-test product source and the final report claims success without observed evidence ("should work now", "likely fixed"), the stop is bounced **once** with instructions to drive the change and attach what was seen — or state plainly that it's unverified. It blocks at most once per session, so a stubborn report can never trap the loop. Docs-only and test-only diffs never trigger it.
- **`freeze-the-session`** (SessionEnd + PreCompact reminder) — when a substantive session ends (or is about to be compacted) and the colony registry hasn't been touched since session start, a non-blocking reminder surfaces: extract the learnings — skills, conventions, checklists — before the context dies. Deterministic heuristics only; silent when unsure.

The scripts use Node ≥20 built-ins exclusively (no dependencies) and exit in milliseconds on the inactive path. Toggle each gate independently: `/skdd-claude:skdd-hooks finish-the-loop on`.

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
cd path/to/skills-driven-development && git pull && claude plugin install --force ./plugins/skdd-claude
```

## Uninstall

```bash
claude plugin uninstall skdd-claude
```

Skills you forged in your own projects remain — only the plugin's bundled meta-skill and slash commands are removed.

## Relationship to the `skdd` CLI

The CLI (`skdd` npm package) and this plugin are independent but complementary:

- **CLI** — runs outside Claude Code, works with any harness, useful in CI and scripts.
- **Plugin** — runs inside Claude Code only, provides slash commands and namespaced skills.

You can use one, the other, or both. Teams that standardize on Claude Code usually install the plugin and optionally add the CLI for CI validation.
