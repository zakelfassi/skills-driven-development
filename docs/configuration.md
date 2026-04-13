# Configuration

> How to wire SkDD into each supported agent harness.

SkDD is a set of conventions plus a meta-skill (`skillforge`). The actual loading, matching, and invocation of skills is done by your agent harness — Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, OpenCode, Goose, or Amp. This doc walks through the wiring for each one so you can go from "interested" to "first skill forged" in a few minutes.

All harnesses follow the same three-move pattern:

1. **Place the skillforge meta-skill** somewhere the harness will find it.
2. **Tell the harness about the registry** (usually via a project-level instruction file).
3. **Prompt the agent** to use or forge a skill, then verify.

If your harness isn't listed here, check its Agent Skills docs — SkDD only requires that the harness can read a `SKILL.md` file following the [agentskills.io](https://agentskills.io/specification.md) spec. Every item in this doc is a thin wrapper around that.

---

## Claude Code

Claude Code honors skills at four scopes: enterprise (managed), personal (`~/.claude/skills/`), project (`.claude/skills/`), and plugin (`<plugin>/skills/`). SkDD uses the **project** scope by default so each colony is versioned with the code.

### Install

```bash
mkdir -p .claude/skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o .claude/skills/skillforge/SKILL.md
touch .skills-registry.md
```

### Configure

Add this block to `CLAUDE.md` at the repo root (create the file if it doesn't exist):

```markdown
## Skills

Skills live under `.claude/skills/<name>/SKILL.md`. The registry is at `.skills-registry.md` in the project root.

At session start, read `.skills-registry.md` to discover available skills. Before deriving a solution, check whether an existing skill covers the task and follow it. When you notice a pattern repeat 2-3 times, or when I ask you to "forge a skill for X", invoke the `skillforge` skill and follow its steps. Update the registry after forging or using a skill.
```

### Verify

In a fresh Claude Code session, ask:

- *"What skills are available in this project?"* — the agent should read `.skills-registry.md` and list at least `skillforge`.
- *"Forge a skill for running database migrations."* — the agent should read `skillforge/SKILL.md`, write a new `SKILL.md`, and update the registry.
- *"List skills."* (in a second session) — the new skill should appear.

### Monorepo note

Claude Code auto-discovers nested `.claude/skills/` directories. In a monorepo, place per-package skills at `packages/<pkg>/.claude/skills/` and they'll activate when the agent is working in that subdirectory.

---

## OpenAI Codex

Codex reads skills from a user-level or project-level directory (`~/.codex/skills/` or `.codex/skills/` depending on your version; see [developers.openai.com/codex/skills](https://developers.openai.com/codex/skills)).

### Install

```bash
mkdir -p .codex/skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o .codex/skills/skillforge/SKILL.md
touch .skills-registry.md
```

### Configure

Codex reads `AGENTS.md` if it exists. Add:

```markdown
## Skills

Skills live under `.codex/skills/<name>/SKILL.md`. The registry is at `.skills-registry.md` in the project root. Load the registry at session start, prefer existing skills over re-derivation, and invoke `skillforge` when you notice a repeated pattern or when I ask you to forge a skill.
```

### Verify

- Start a Codex session, ask *"What skills are available?"* — it should list `skillforge` from the registry.
- Ask *"Forge a skill for bumping package versions."* — the agent should walk through the skillforge checklist and produce a new skill directory.
- In a fresh session, ask *"Run the bump-version skill."* — the agent should discover it via the registry and follow its steps.

---

## Cursor

Cursor supports Agent Skills via its built-in agent mode. See [cursor.com/docs/context/skills](https://cursor.com/docs/context/skills). Skills are placed under `.cursor/skills/`.

### Install

```bash
mkdir -p .cursor/skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o .cursor/skills/skillforge/SKILL.md
touch .skills-registry.md
```

### Configure

Cursor reads `.cursor/rules/*.mdc` and `AGENTS.md` / `CLAUDE.md`. Add a rules file at `.cursor/rules/skills.mdc`:

```markdown
---
description: Skills-Driven Development colony wiring
alwaysApply: true
---

Skills live under `.cursor/skills/<name>/SKILL.md`. The registry is at `.skills-registry.md` in the project root.

At session start, read `.skills-registry.md` to discover available skills. Prefer existing skills over re-derivation. When you notice a repeated pattern or when I ask you to "forge a skill", invoke the `skillforge` skill and follow its steps. Update `.skills-registry.md` whenever a skill is forged or used.
```

### Verify

- In Cursor's agent chat, ask *"List the skills you can see."*
- Ask *"Forge a skill for writing Changesets."* — the agent should read `skillforge/SKILL.md` and produce a new skill.
- Reload the window and ask *"What skills are available?"* to confirm persistence.

---

## GitHub Copilot

Copilot reads skills from `.github/skills/` in the repo. See [docs.github.com/en/copilot/concepts/agents/about-agent-skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills). Only the Copilot agent surfaces (chat, workspace, coding agent) honor skills — the inline completions ignore them.

### Install

```bash
mkdir -p .github/skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o .github/skills/skillforge/SKILL.md
touch .skills-registry.md
```

### Configure

Copilot uses `.github/copilot-instructions.md` as its project-level instruction surface. Create or extend it:

```markdown
## Skills

Skills live under `.github/skills/<name>/SKILL.md`. The registry is at `.skills-registry.md` at the repo root.

Before working on any task, scan `.skills-registry.md` for a matching skill and follow it if one exists. When a pattern repeats or the user asks for a skill, invoke `skillforge` and follow its steps. Update `.skills-registry.md` after forging or using.
```

### Verify

- In Copilot Chat, ask *"@workspace what skills are registered?"*
- Ask *"Forge a skill for rotating secrets."* — Copilot should walk through skillforge and produce a new skill under `.github/skills/`.
- Open a fresh chat and ask the same question; the new skill should appear.

---

## Gemini CLI

Gemini CLI (`gemini` binary, open-source) loads skills from `.gemini/skills/`. See [geminicli.com/docs/cli/skills/](https://geminicli.com/docs/cli/skills/).

### Install

```bash
mkdir -p .gemini/skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o .gemini/skills/skillforge/SKILL.md
touch .skills-registry.md
```

### Configure

Add instructions to `AGENTS.md` (Gemini CLI reads it by default):

```markdown
## Skills

Skills live under `.gemini/skills/<name>/SKILL.md`. The registry is at `.skills-registry.md`. Load the registry at session start, prefer existing skills, and invoke `skillforge` when you notice a repeated pattern or when I ask to forge a skill.
```

### Verify

- Run `gemini` in the project directory, ask *"What skills are available?"*
- Ask *"Forge a skill for publishing release notes."* — the agent should produce a skill and update the registry.
- Close the session, start a new one, ask again — the skill should persist.

---

## OpenCode

OpenCode is an open-source CLI agent that supports the Agent Skills spec at `.opencode/skills/`. See [opencode.ai/docs/skills/](https://opencode.ai/docs/skills/).

### Install

```bash
mkdir -p .opencode/skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o .opencode/skills/skillforge/SKILL.md
touch .skills-registry.md
```

### Configure

OpenCode reads `AGENTS.md`. Add the same skills block as Gemini CLI above, with `.opencode/skills/` in place of `.gemini/skills/`.

### Verify

Same three-question verification: list skills → forge a skill → reopen and confirm persistence.

---

## Goose

Goose is Block's open-source agent. Skills go under `~/.config/goose/skills/` (user scope) or project-level via Goose's extension config. See [block.github.io/goose/docs/guides/context-engineering/using-skills/](https://block.github.io/goose/docs/guides/context-engineering/using-skills/).

### Install

```bash
mkdir -p .goose/skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o .goose/skills/skillforge/SKILL.md
touch .skills-registry.md
```

### Configure

Add a Goose project instruction file (or reuse `AGENTS.md`) with the skills block pointing at `.goose/skills/`.

### Verify

Same three-question verification pattern.

---

## Amp

Amp (from Sourcegraph) supports Agent Skills as of late 2025. See [ampcode.com/manual#agent-skills](https://ampcode.com/manual#agent-skills). Skills are loaded from `.amp/skills/`.

### Install

```bash
mkdir -p .amp/skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o .amp/skills/skillforge/SKILL.md
touch .skills-registry.md
```

### Configure

Amp reads `AGENTS.md`. Same skills block as above with `.amp/skills/`.

### Verify

Same three-question verification pattern.

---

## Using one colony across multiple harnesses

If your project is worked on by more than one harness (e.g., Claude Code *and* Codex), you have two options:

1. **Symlink** `.claude/skills` → `.skills` → `.codex/skills` → `.cursor/skills`. Each harness reads the same underlying directory. This is the simplest setup but relies on each harness honoring the symlink.
2. **Use `skdd export`** (Milestone D) to materialize harness-specific directories from a single source of truth. Good for CI-driven workflows and cases where symlinks are awkward (Windows, zipped archives).

Either way, keep one `.skills-registry.md` at the project root — all harnesses should update the same registry.

---

## Troubleshooting

**Agent doesn't discover the skillforge.** The skills block in your instruction file is probably missing or mis-scoped. Open a fresh session and explicitly prompt: *"Read `.skills-registry.md` and list what's there."* If that works but the agent doesn't auto-scan, the instruction file isn't being loaded — check the harness docs for the exact filename and scope.

**Agent forges skills but they don't persist.** Check `.skills-registry.md` — if new rows aren't landing, the agent isn't following the full skillforge checklist. Re-prompt with *"After writing the skill, update `.skills-registry.md` with a new row."*

**Multiple agents forge the same skill differently.** That's the colony doing its job — let them coexist, and use `skdd list` (Milestone C) to see usage counts. The more-used one wins; the other can be deprecated.

**Scripts in a forged skill don't run.** Skills can include `scripts/` but the harness has to grant the agent tool permissions to execute them. Check your harness's tool-use policy and, if necessary, add an `allowed-tools` line to the skill's frontmatter.
