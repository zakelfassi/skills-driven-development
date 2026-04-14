# OpenAI Codex

> Codex adopted the Agent Skills spec as its customization format — SkDD skills work natively without adapters.

## Install

```bash
pnpm dlx @zakelfassi/skdd init --harness=codex
```

Creates `skills/skillforge/SKILL.md` (canonical) + `.skills-registry.md` + `AGENTS.md` with the skills block + `.codex/skills → ../skills` symlink + `.skdd-sync.json` state.

Manual fallback:

```bash
mkdir -p skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o skills/skillforge/SKILL.md
touch .skills-registry.md
mkdir -p .codex && ln -s ../skills .codex/skills
```

## Configure

Codex reads `AGENTS.md` at the project root. `skdd init` appends:

```markdown
## Skills

Skills live at `skills/<name>/SKILL.md` (canonical, single source of truth). The registry is at `.skills-registry.md` in the project root. `.codex/skills` is a mirror maintained by `skdd link` so Codex can find skills at its conventional path.

At session start, read `.skills-registry.md` to discover available skills. Before deriving a solution, check whether an existing skill covers the task and follow it. When you notice a pattern repeat 2-3 times, or when I ask you to "forge a skill for X", invoke the `skillforge` skill and follow its steps. Always write new skills to `skills/`, never to the mirror.
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

A team using both Claude Code and Codex on the same repo just runs:

```bash
skdd link --harness=claude,codex
```

One canonical `skills/` directory, two mirrors (`.claude/skills → ../skills`, `.codex/skills → ../skills`), no drift. Forging a skill via either harness lands in the same canonical location and is visible through both mirrors.

## Troubleshooting

**"Skills aren't being discovered."** Codex's scope rules changed mid-2025; make sure your Codex CLI is current (`codex --version`). Older versions only read `~/.codex/skills/`.

**"AGENTS.md isn't being loaded."** Check that the file is at the repo root, not a subdirectory. Codex looks for `AGENTS.md` exactly one level up from the working directory.
