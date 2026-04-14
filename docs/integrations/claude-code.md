# Claude Code

> The reference SkDD integration. Claude Code was the first harness SkDD was developed against and is the best-supported target.

## Install

Run `skdd init` from the root of **your own project** (not the SkDD repo):

```bash
pnpm dlx @zakelfassi/skdd init --harness=claude
```

That single command:
1. Creates `skills/skillforge/SKILL.md` (canonical, single source of truth)
2. Creates `.skills-registry.md` at the project root
3. Appends the `## Skills` block to `CLAUDE.md`
4. Creates `.claude/skills` → `../skills` symlink (the mirror Claude Code actually discovers)
5. Writes `.skdd-sync.json` so `skdd link` can reconcile drift later

Manual equivalent (if you want to stay CLI-free):

```bash
mkdir -p skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o skills/skillforge/SKILL.md
touch .skills-registry.md
mkdir -p .claude && ln -s ../skills .claude/skills    # Unix; Windows users copy the dir
```

## Configure

Claude Code reads `CLAUDE.md` at the project root on every session start. `skdd init` already wrote this block into the file. If you went manual, paste it yourself:

```markdown
## Skills

Skills live at `skills/<name>/SKILL.md` (canonical, single source of truth). The registry is at `.skills-registry.md` in the project root. `.claude/skills` is a mirror maintained by `skdd link` so Claude Code can find skills at its conventional path.

At session start, read `.skills-registry.md` to discover available skills. Before deriving a solution, check whether an existing skill covers the task and follow it. When you notice a pattern repeat 2-3 times, or when I ask you to "forge a skill for X", invoke the `skillforge` skill and follow its steps. Always write new skills to `skills/`, never to the mirror.
```

That's the entire configuration. Claude Code handles skill discovery, description matching, and activation internally — SkDD contributes the meta-skill, the registry conventions, and the canonical/mirror layout so one source of truth serves every harness you use.

## Verify

Open a new Claude Code session and run these three prompts in order:

1. *"What skills are available in this project?"* — the agent should read `.skills-registry.md` and list at least `skillforge`.
2. *"Forge a skill for running database migrations."* — the agent should follow `.claude/skills/skillforge/SKILL.md` and produce a new `SKILL.md` plus a registry row.
3. *(In a fresh session)* *"List skills again."* — the forged skill should persist and appear.

If any step fails, see [Troubleshooting](#troubleshooting).

## Scopes

Claude Code honors skills at four scopes. SkDD's project-scoped colony is only one of them — you can mix scopes freely.

| Scope | Path Claude Code sees | SkDD canonical | SkDD use |
|-------|-----------------------|----------------|----------|
| Personal | `~/.claude/skills/<name>/` | `~/skills/<name>/` (optional user-scope canonical) | Skills you always want — personal `commit-message` style, etc. |
| Project | `.claude/skills/<name>/` (mirror) | `skills/<name>/` | **Default for SkDD colonies** — versioned with the code |
| Plugin | `<plugin>/skills/<name>/` | plugin's own source tree | [`plugins/skdd-claude`](../../plugins/skdd-claude) ships the meta-skill as a namespaced plugin skill |
| Enterprise | Managed settings | org-level canonical repo | For orgs distributing a central colony |

Project-scope is SkDD's default because colonies should be versioned with the code they describe. The `.claude/skills` path Claude Code sees is always a **mirror** of the canonical `skills/` directory, maintained by `skdd link`. The plugin scope exists for the one-click install path (see the SkDD plugin).

## Monorepo support

Claude Code auto-discovers nested `.claude/skills/` directories. In a canonical-layout monorepo:

```
repo/
├── CLAUDE.md                       # workspace-level instructions
├── skills/                          # workspace-shared canonical
├── .claude/skills → ../skills       # workspace mirror
├── .skills-registry.md
└── packages/
    ├── frontend/
    │   ├── CLAUDE.md                     # frontend-specific instructions (optional)
    │   ├── skills/                        # frontend-only canonical
    │   └── .claude/skills → ../skills     # frontend mirror
    └── backend/
        ├── CLAUDE.md
        ├── skills/
        └── .claude/skills → ../skills
```

When the agent works in `packages/frontend`, Claude Code sees both the workspace mirror and the frontend mirror — the agent merges them when describing available skills. You can keep one registry at the repo root or add per-package registries; `skdd list` walks up looking for the nearest one.

## Plugin install (optional, one-click)

Instead of the curl one-liner, install the SkDD Claude Code plugin bundled in this repo:

```bash
# From the SkDD repo root
claude plugins install ./plugins/skdd-claude
```

The plugin registers `skillforge` under the plugin scope (namespaced as `skdd-claude:skillforge`), adds two slash commands (`/forge` and `/skills`), and wires a SessionStart hook that loads `.skills-registry.md` automatically. See [`plugins/skdd-claude/README.md`](../../plugins/skdd-claude/README.md) for details.

## Troubleshooting

**The agent never mentions skills.** Your `CLAUDE.md` probably doesn't contain the `## Skills` block from the Configure step. Double-check that Claude Code loaded the file by asking *"Read `CLAUDE.md` and tell me what sections it has."*

**`.claude/skills` mirror is broken or missing.** Run `skdd link --harness=claude` to re-establish it. If it reports "blocked — target already exists", Claude Code probably made a real directory under `.claude/skills/` at some point and you have user data there; back it up to `skills/` and pass `--force`.

**Agent wrote a new skill straight into `.claude/skills/<name>/` instead of `skills/<name>/`.** The CLAUDE.md instructions block explicitly says "Always write to `skills/`, never to the mirror." Re-prompt with that sentence verbatim, then move the file from the mirror into the canonical dir and re-run `skdd link`.

**Skills appear in one session but not the next.** Claude Code caches file state per-session but re-reads `CLAUDE.md` on every new session. If skills are disappearing, check that `skills/` and `.skills-registry.md` were actually committed (not in `.gitignore`) and that symlink permissions are intact.

**The agent forges a skill but it doesn't land in `.skills-registry.md`.** The skillforge step 6 ("Register the skill") may have been skipped. Re-prompt: *"After writing the skill, update `.skills-registry.md` with a new row."* Or use the plugin's `/forge` command, which enforces registration.

**Windows: `skdd init` reports `copy` mode.** That's expected — NTFS symlinks need elevated privileges, so the CLI falls back to file copies tracked in `.skdd-sync.json`. Re-run `skdd link` after every edit to `skills/` to refresh the copies. Or, if you have Developer Mode enabled, pass `--mode=symlink` to force symlinks.

**Plugin install fails.** Claude Code's plugin loader is strict about `plugin.json`. Run `skdd validate plugins/skdd-claude/skills/skillforge/SKILL.md` to rule out the skill file; if that's clean, check `plugin.json` against the Claude Code plugin docs.
