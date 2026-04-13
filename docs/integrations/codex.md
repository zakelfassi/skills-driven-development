# OpenAI Codex

> Codex adopted the Agent Skills spec as its customization format — SkDD skills work natively without adapters.

## Install

```bash
mkdir -p .codex/skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o .codex/skills/skillforge/SKILL.md
touch .skills-registry.md
```

Or with the CLI:

```bash
pnpm dlx skdd init --harness=codex
```

## Configure

Codex reads `AGENTS.md` at the project root. Append:

```markdown
## Skills

Skills live under `.codex/skills/<name>/SKILL.md`. The registry is at `.skills-registry.md` in the project root.

At session start, read `.skills-registry.md` to discover available skills. Before deriving a solution, check whether an existing skill covers the task and follow it. When you notice a pattern repeat 2-3 times, or when I ask you to "forge a skill for X", invoke the `skillforge` skill and follow its steps. Update the registry after forging or using a skill.
```

See [developers.openai.com/codex/skills](https://developers.openai.com/codex/skills) for Codex's own skill documentation and scope rules.

## Verify

Start a Codex session in the project and run:

1. *"What skills do we have?"* — Codex lists skills from `.skills-registry.md`.
2. *"Forge a skill for scaffolding a new CLI subcommand."* — Codex follows `skillforge/SKILL.md` and writes a new skill.
3. *(New session)* *"List skills."* — the new skill persists.

## User vs project scope

Codex supports both user-level (`~/.codex/skills/`) and project-level (`.codex/skills/`) skills. SkDD recommends project-level for colonies that encode project conventions, and user-level only for cross-project personal skills.

## Interop with other harnesses

A team using both Claude Code and Codex on the same repo should symlink the skills directories:

```bash
ln -sf .codex/skills .claude/skills      # or vice versa
```

Keep one registry at `.skills-registry.md`. Both harnesses will pick up any forged skill immediately.

## Troubleshooting

**"Skills aren't being discovered."** Codex's scope rules changed mid-2025; make sure your Codex CLI is current (`codex --version`). Older versions only read `~/.codex/skills/`.

**"AGENTS.md isn't being loaded."** Check that the file is at the repo root, not a subdirectory. Codex looks for `AGENTS.md` exactly one level up from the working directory.
