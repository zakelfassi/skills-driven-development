# Factory Droid

> SkDD's 9th harness — the AI pair built into the Factory platform. Droid is the only harness that natively reads `AGENTS.md` and includes a first-class personal skills directory at `~/.factory/skills/`.

## Install

Run `skdd init` from the root of **your own project** (not the SkDD repo):

```bash
pnpm dlx @zakelfassi/skdd init --harness=droid
```

That single command:
1. Creates `skills/skillforge/SKILL.md` (canonical, single source of truth)
2. Creates `.skills-registry.md` at the project root
3. Appends the `## Skills` block to `AGENTS.md`
4. Creates `.factory/skills` → `../skills` symlink (the mirror Droid discovers)
5. Writes `.skdd-sync.json` so `skdd link` can reconcile drift later

Manual equivalent (if you prefer to stay CLI-free):

```bash
mkdir -p skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o skills/skillforge/SKILL.md
touch .skills-registry.md
mkdir -p .factory && ln -s ../skills .factory/skills    # Unix; Windows users copy the dir
```

## Configure

Droid reads `AGENTS.md` at the project root on every session start. `skdd init` already wrote this block into the file. If you went manual, paste it yourself:

```markdown
## Skills

Skills live at `skills/<name>/SKILL.md` (canonical, single source of truth). The registry is at `.skills-registry.md` in the project root. `.factory/skills` is a mirror maintained by `skdd link` so Factory Droid can find skills at its conventional path.

At session start, read `.skills-registry.md` to discover available skills. Before deriving a solution, check whether an existing skill covers the task and follow it. When you notice a pattern repeat 2-3 times, or when I ask you to "forge a skill for X", invoke the `skillforge` skill and follow its steps. Always write new skills to `skills/`, never to the mirror.
```

That's the entire project-level configuration. Droid discovers `AGENTS.md` automatically at session start and propagates the skills block to every droid running in this project.

## Verify

Open a new Factory Droid session in this project and run these three prompts in order:

1. *"What skills are available in this project?"* — Droid should read `.skills-registry.md` and list at least `skillforge`.
2. *"Forge a skill for generating release notes."* — Droid should follow `.factory/skills/skillforge/SKILL.md` and produce a new `SKILL.md` plus a registry row.
3. *(In a fresh session)* *"List skills again."* — the forged skill should persist and appear.

If any step fails, see [Troubleshooting](#troubleshooting).

## Scopes

Factory Droid honors skills at two scopes. SkDD's project colony is one of them.

| Scope | Path Droid sees | SkDD canonical | SkDD use |
|-------|-----------------|----------------|----------|
| Personal | `~/.factory/skills/<name>/` | `~/.skdd/skills/<name>/` | Skills that follow you across all projects — link with `skdd init -g --harness=droid` |
| Workspace | `.factory/skills/<name>/` (mirror) | `skills/<name>/` | **Default for SkDD colonies** — versioned with the code |

Project-scope is SkDD's default because colonies should be versioned with the code they describe. The `.factory/skills` path Droid sees is always a **mirror** of the canonical `skills/` directory, maintained by `skdd link`.

### Personal (global) skills

Factory's personal skills directory (`~/.factory/skills/`) is populated by `skdd link -g`:

```bash
# Set up a global colony at ~/.skdd/ and link to all reachable harness global dirs
skdd init -g

# Or target Droid specifically
skdd init -g --harness=droid
```

After linking, skills forged with `skdd forge -g` land in `~/.skdd/skills/` and are mirrored to `~/.factory/skills/` — available in every Droid session regardless of project.

See [`docs/global-colony.md`](../global-colony.md) for the full global-colony workflow, including safe migration of an existing `~/.factory/skills/` directory.

## MCP configuration

Factory Droid natively supports MCP servers in `~/.factory/mcp.json`. This is one of the seven hosts managed by `skdd mcp sync`.

Droid's MCP format:

```jsonc
{
  "mcpServers": {
    "my-tool": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@acme/my-tool-mcp"],
      "env": { "API_KEY": "${MY_API_KEY}" }   // ${VAR} is resolved by Droid at runtime
    }
  },
  "persistentPermissions": { /* Droid-managed; skdd never touches this */ }
}
```

**Key difference from other hosts**: Droid natively supports `${VAR}` placeholders and resolves them from the environment at runtime. When syncing to Droid, skdd passes placeholders through unexpanded (unlike other hosts, where expansion happens at sync time).

```bash
# Add a server and sync it to Droid (and any other available hosts)
skdd mcp add my-tool --command npx --args "-y @acme/my-tool-mcp" --env "API_KEY=\${MY_API_KEY}"
skdd mcp sync

# Sync only to Droid
skdd mcp add my-tool --command npx --args "-y @acme/my-tool-mcp" --hosts droid
skdd mcp sync
```

See [`docs/mcp-sync.md`](../mcp-sync.md) for the full MCP sync documentation.

## Monorepo support

Droid auto-discovers `AGENTS.md` files in parent directories when you work in a subdirectory. In a canonical-layout monorepo:

```
repo/
├── AGENTS.md                        # workspace-level instructions + skills block
├── skills/                           # workspace-shared canonical
├── .factory/skills → ../skills      # workspace mirror
├── .skills-registry.md
└── packages/
    ├── frontend/
    │   ├── AGENTS.md                      # frontend-specific instructions (optional)
    │   ├── skills/                         # frontend-only canonical
    │   └── .factory/skills → ../skills    # frontend mirror
    └── backend/
        ├── AGENTS.md
        ├── skills/
        └── .factory/skills → ../skills
```

When Droid works in `packages/frontend`, it reads the frontend `AGENTS.md` and, if absent, walks up to find the workspace `AGENTS.md`. Skills from both scope levels are available — Droid merges them.

## Detection

`skdd doctor` (and auto-detection in `skdd init`) identifies a Factory Droid project by looking for any of:

- `.factory/skills/` directory
- `.factory/` directory

If either is present, the project is detected as `droid` harness. Detection is automatic — you rarely need to pass `--harness=droid` explicitly.

## Troubleshooting

**The droid never mentions skills.** Your `AGENTS.md` probably doesn't contain the `## Skills` block from the Configure step above. Ask Droid: *"Read `AGENTS.md` and tell me what sections it has."* If the file is missing the block, run `skdd init --harness=droid` which will append it.

**`.factory/skills` mirror is broken or missing.** Run `skdd link --harness=droid` to re-establish it. If it reports "blocked — target already exists", you may have a real directory under `.factory/skills/`; back it up to `skills/` and pass `--force`.

**Droid wrote a new skill directly into `.factory/skills/<name>/`.** The AGENTS.md instructions block says "Always write to `skills/`, never to the mirror." Re-prompt with that sentence verbatim, then move the file from the mirror into the canonical dir and re-run `skdd link`.

**Global skills aren't showing up.** Run `skdd doctor -g` to check the global colony state. The most common cause is that `~/.factory/skills` hasn't been linked yet — run `skdd link -g --harness=droid` (or `skdd init -g --harness=droid`). If `~/.factory/skills` was previously a real directory, you'll need to `skdd import -g --apply` first, then `skdd link -g --force`.

**`skdd mcp sync` shows Droid as unavailable.** The adapter checks that `~/.factory/mcp.json` (or the `~/.factory/` directory) exists. If Droid isn't installed yet, the adapter reports unavailable and skips — no error. Once you install Factory, re-run `skdd mcp sync`.

**Windows: `skdd init` reports `copy` mode.** That's expected — NTFS symlinks need elevated privileges, so the CLI falls back to file copies tracked in `.skdd-sync.json`. Re-run `skdd link` after every edit to `skills/` to refresh the copies. Or, if you have Developer Mode enabled, pass `--mode=symlink` to force symlinks.
