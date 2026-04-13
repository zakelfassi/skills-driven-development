# Claude Code

> The reference SkDD integration. Claude Code was the first harness SkDD was developed against and is the best-supported target.

## Install

One-liner — run from the root of your own project (not the SkDD repo):

```bash
mkdir -p .claude/skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o .claude/skills/skillforge/SKILL.md
touch .skills-registry.md
```

Or, if you've installed the CLI:

```bash
pnpm dlx skdd init --harness=claude
```

## Configure

Claude Code reads `CLAUDE.md` at the project root on every session start. Add this section (append to existing `CLAUDE.md` or create it):

```markdown
## Skills

Skills live under `.claude/skills/<name>/SKILL.md`. The registry is at `.skills-registry.md` in the project root.

At session start, read `.skills-registry.md` to discover available skills. Before deriving a solution, check whether an existing skill covers the task and follow it. When you notice a pattern repeat 2-3 times, or when I ask you to "forge a skill for X", invoke the `skillforge` skill and follow its steps. Update the registry after forging or using a skill.
```

That's the entire configuration. Claude Code handles skill discovery, description matching, and activation internally — SkDD only contributes the meta-skill and the registry conventions.

## Verify

Open a new Claude Code session and run these three prompts in order:

1. *"What skills are available in this project?"* — the agent should read `.skills-registry.md` and list at least `skillforge`.
2. *"Forge a skill for running database migrations."* — the agent should follow `.claude/skills/skillforge/SKILL.md` and produce a new `SKILL.md` plus a registry row.
3. *(In a fresh session)* *"List skills again."* — the forged skill should persist and appear.

If any step fails, see [Troubleshooting](#troubleshooting).

## Scopes

Claude Code honors skills at four scopes. SkDD's project-scoped colony is only one of them — you can mix scopes freely.

| Scope | Path | Applies to | SkDD use |
|-------|------|-----------|----------|
| Personal | `~/.claude/skills/<name>/` | All your projects | Skills you always want — e.g., your personal `commit-message` style |
| Project | `.claude/skills/<name>/` | Current repo | **Default for SkDD colonies** — versioned with the code |
| Plugin | `<plugin>/skills/<name>/` | Anyone who installs the plugin | [`plugins/skdd-claude`](../../plugins/skdd-claude) ships the meta-skill as a namespaced plugin skill |
| Enterprise | Managed settings | Whole org | For orgs distributing a central colony |

Project-scope is SkDD's default because colonies should be versioned with the code they describe. The plugin scope exists for the one-click install path (see the SkDD plugin).

## Monorepo support

Claude Code auto-discovers nested `.claude/skills/` directories. In a monorepo:

```
repo/
├── CLAUDE.md                      # workspace-level skills/instructions
├── .claude/skills/                # workspace-shared skills
├── .skills-registry.md
└── packages/
    ├── frontend/
    │   ├── CLAUDE.md               # frontend-specific instructions (optional)
    │   └── .claude/skills/         # frontend-only skills
    └── backend/
        ├── CLAUDE.md
        └── .claude/skills/
```

When the agent is working in `packages/frontend`, it sees both `repo/.claude/skills/` and `repo/packages/frontend/.claude/skills/`. You can keep one registry at the repo root or add per-package registries — the CLI's `skdd list` walks up looking for the nearest one.

## Plugin install (optional, one-click)

Instead of the curl one-liner, install the SkDD Claude Code plugin bundled in this repo:

```bash
# From the SkDD repo root
claude plugins install ./plugins/skdd-claude
```

The plugin registers `skillforge` under the plugin scope (namespaced as `skdd-claude:skillforge`), adds two slash commands (`/forge` and `/skills`), and wires a SessionStart hook that loads `.skills-registry.md` automatically. See [`plugins/skdd-claude/README.md`](../../plugins/skdd-claude/README.md) for details.

## Troubleshooting

**The agent never mentions skills.** Your `CLAUDE.md` probably doesn't contain the `## Skills` block from the Configure step. Double-check that Claude Code loaded the file by asking *"Read `CLAUDE.md` and tell me what sections it has."*

**Skills appear in one session but not the next.** Claude Code caches file state per-session but re-reads `CLAUDE.md` on every new session. If skills are disappearing, check that `.skills-registry.md` was actually committed (not in `.gitignore`) and that the skills directory has correct permissions.

**The agent forges a skill but it doesn't land in `.skills-registry.md`.** The skillforge step 6 ("Register the skill") may have been skipped. Re-prompt: *"After writing the skill, update `.skills-registry.md` with a new row."* Or use the plugin's `/forge` command, which enforces registration.

**Plugin install fails.** Claude Code's plugin loader is strict about `plugin.json`. Run `skdd validate plugins/skdd-claude/skills/skillforge/SKILL.md` to rule out the skill file; if that's clean, check `plugin.json` against the Claude Code plugin docs.
