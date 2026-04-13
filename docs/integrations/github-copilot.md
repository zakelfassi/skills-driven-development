# GitHub Copilot

> Copilot reads Agent Skills from `.github/skills/`. Only agent surfaces (Chat, Workspace, Coding Agent) honor them — inline completions ignore skills.

## Install

```bash
pnpm dlx skdd init --harness=copilot
```

Creates `skills/skillforge/SKILL.md` (canonical) + `.skills-registry.md` + `.github/copilot-instructions.md` with the skills block + `.github/skills → ../skills` symlink + `.skdd-sync.json` state.

Manual fallback:

```bash
mkdir -p skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o skills/skillforge/SKILL.md
touch .skills-registry.md
mkdir -p .github && ln -s ../skills .github/skills
```

## Configure

Copilot's project-level instruction file is `.github/copilot-instructions.md`. `skdd init` writes:

```markdown
## Skills

Skills live at `skills/<name>/SKILL.md` (canonical, single source of truth). The registry is at `.skills-registry.md` at the repo root. `.github/skills` is a mirror maintained by `skdd link` so Copilot can find skills at its conventional path.

Before working on any task, scan `.skills-registry.md` for a matching skill and follow it if one exists. When a pattern repeats or the user asks for a skill, invoke `skillforge` and follow its steps. Always write new skills to `skills/`, never to the mirror.
```

See [docs.github.com/en/copilot/concepts/agents/about-agent-skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills) for Copilot's own skill documentation.

## Verify

Three-question check in Copilot Chat (not inline completion):

1. *"@workspace what skills are registered?"*
2. *"@workspace forge a skill for rotating secrets."*
3. *(Open a fresh chat)* *"@workspace list skills."*

## Inline completions are not skill-aware

Copilot's ghost-text inline completions run on a smaller model that doesn't load skills. If you want a skill to apply to inline completions, move its patterns into `.github/copilot-instructions.md` directly. Skills are for agent surfaces only.

## GitHub-native integration

`.github/skills/` is a GitHub-recognized path. GitHub Marketplace actions can read and publish skills from this directory, and GitHub's own Agent Skills showcase indexes public repos that use it. Keep your SkDD colony at `.github/skills/` if you want maximum discoverability in the GitHub ecosystem.

## Troubleshooting

**Copilot Chat doesn't mention skills.** Confirm that `.github/copilot-instructions.md` contains the `## Skills` block and that Copilot's "Use project instructions" setting is on. In VS Code, this is under Settings → Extensions → GitHub Copilot Chat.

**Agent forges a skill but it lands in the wrong directory.** Copilot's skillforge wrapper may have detected the wrong scope. Re-prompt: *"Write the skill to `.github/skills/<name>/SKILL.md` specifically."*
