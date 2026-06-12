# Global Colony

> Manage a single `~/.skdd/` colony that every harness on your machine reads — forged once, used everywhere.

SkDD's default mode is **project-scoped**: skills live in `skills/` at the repo root and mirrors are relative symlinks under `.claude/skills`, `.codex/skills`, etc. This is the right default for most colonies because the skills are versioned with the code they describe.

A **global colony** at `~/.skdd/` solves a different problem: skills that travel with *you*, not with any one project — personal `commit-message-style`, a `code-review` workflow you run everywhere, or the MCP server catalogue you want available in every session. The `-g` / `--global` flag engages this mode on `init`, `link`, `doctor`, `list`, `forge`, and `import`.

---

## Directory layout

```
~/.skdd/
├── skills/               # canonical source of truth (same shape as project skills/)
│   ├── skillforge/
│   │   └── SKILL.md
│   └── <your forged skills>/
├── .skills-registry.md   # global registry (human-readable, same format as project)
├── .skdd-sync.json       # mirror state (v2) — includes mcp managed-server map
└── mcp.json              # canonical MCP server catalogue (see docs/mcp-sync.md)
```

The `~/.skdd/` path is fixed by default. You can override it by setting the `SKDD_HOME` environment variable — useful for testing or if you want to keep the global colony somewhere else:

```bash
export SKDD_HOME=/path/to/my/skdd-home
skdd init -g
```

---

## Getting started

### First-time setup

```bash
skdd init --global       # or: skdd init -g
```

This is the only command with a different first-run experience. Because there is no project instruction file in global mode, `init -g` skips the harness-specific instruction-file step and instead prints a summary of which harness global directories were linked. Under the hood it:

1. Creates `~/.skdd/skills/`, `~/.skdd/.skills-registry.md` (once).
2. Calls `skdd link -g` for harnesses whose global parent directory already exists on your machine (e.g. if `~/.factory/` exists, the Factory Droid global path is linked; if `~/.claude/` exists, the Claude Code global path is linked).
3. Prints a per-harness table of links created / skipped / blocked.

If you want to link a specific harness whose parent directory doesn't exist yet, pass `--harness` explicitly:

```bash
skdd init -g --harness=droid
```

### Migrating an existing global skills directory

Most harnesses already have a populated global skills directory (e.g. `~/.claude/skills/`). Because those directories contain your existing skills, `skdd link -g` will **not** overwrite them by default — you'll see a "blocked — target already exists" message.

The safe migration path is to **import** your existing skills into `~/.skdd/skills/` first, then let skdd manage the mirrors:

```bash
# Pull skills from all reachable harness global dirs into ~/.skdd/skills/
skdd import -g

# Now ~/.skdd/skills/ contains all discovered skills.
# Back up the originals, then force-link so ~/.claude/skills etc. point at ~/.skdd/skills.
skdd link -g --force
```

`skdd import -g` scans every harness's `globalSkillsDir` (see the table below) and copies any `SKILL.md` it finds into `~/.skdd/skills/<name>/`, preserving the skill names. Existing entries are not overwritten unless you pass `--force`.

---

## `--global` flag matrix

All six commands that accept `-g`:

| Command | Without `-g` | With `-g` |
|---------|-------------|----------|
| `skdd init` | Initialises project colony in cwd | Initialises `~/.skdd/`, seeds registry, links reachable harnesses |
| `skdd link` | Creates/repairs mirrors from `skills/` → `.claude/skills` etc. | Creates/repairs mirrors from `~/.skdd/skills/` → `~/.claude/skills` etc. |
| `skdd doctor` | Checks colony in cwd | Checks `~/.skdd/` (skills dir, registry, mirrors, MCP drift); skips instruction-file checks |
| `skdd list` | Lists skills in cwd registry | Lists skills in `~/.skdd/.skills-registry.md` |
| `skdd forge` | Forges skill into `skills/` and registers in cwd | Forges skill into `~/.skdd/skills/` and registers globally; calls `link -g` post-forge |
| `skdd import` | Imports skills from harness project dirs into `skills/` | Imports from all harness *global* dirs into `~/.skdd/skills/` |

`skdd mcp` commands always operate on `~/.skdd/mcp.json` regardless of the `-g` flag (MCP configuration is always global).

---

## Global vs project precedence

Most harnesses load skills from **both** the global path and the project path, merging them at session start. The details vary:

- **Claude Code** loads `.claude/skills/` (project mirror, if present) and `~/.claude/skills/` (global) independently. Skills from both scopes are available; project scope takes precedence for same-name conflicts.
- **Codex** loads `.codex/skills/` (project) then `~/.codex/skills/` (global); later-loaded entries with the same name shadow earlier ones.
- **Cursor** loads `.cursor/skills/` (project), `~/.cursor/skills/` (global), and also reads `~/.agents/skills/` and `~/.claude/skills/` for compatibility.
- All other harnesses follow the same pattern: project path first, global path second; global skills are available everywhere but can be shadowed per-project.

When `skdd list` is run without `-g`, it shows only the project registry. Add `-g` to see the global registry. There is no merged view today — use both commands to see the full picture.

---

## 9-harness global paths table

The table below documents the global skills directory for each harness, as verified against June 2026 documentation and the live machine.

| Harness | Global skills dir | Notes |
|---------|-------------------|-------|
| Claude Code | `~/.claude/skills/` | Verified — primary global scope |
| OpenAI Codex | `~/.codex/skills/` | Verified — user-level skills |
| Cursor | `~/.cursor/skills/` | Verified; also reads `~/.agents/skills/` for compat |
| GitHub Copilot | `~/.copilot/skills/` | Verified; alias `~/.agents/skills/` also works |
| Gemini CLI | `~/.gemini/skills/` | Verified, **caveat**: Gemini CLI is transitioning to Antigravity CLI for unpaid tiers (around 2026-06-18); path may migrate. The adapter checks file existence so it degrades gracefully if the directory disappears. |
| OpenCode | `~/.config/opencode/skills/` | Verified |
| Goose | `~/.agents/skills/` | Best-effort; Goose's Skills extension is deprecated in v1.25+ in favour of the Summon extension, but the path is retained for compatibility. |
| Amp | `~/.config/agents/skills/` | Verified; also reads `~/.claude/skills/` for compat |
| Factory Droid | `~/.factory/skills/` | Verified — personal skills that follow you across projects |

### Reading the caveats

- **Gemini CLI transition**: the `~/.gemini/skills/` path is verified today. If Antigravity CLI moves to a different config home, the Gemini adapter's `available()` check (which gates on the directory's existence) will quietly skip that host rather than error. Update your global link after migration with `skdd link -g --harness=gemini`.
- **Goose deprecation**: `~/.agents/skills/` is retained because it's also read by Cursor and Copilot as a compatibility alias. Skills placed there will continue to work in those harnesses even if Goose's own loading behaviour changes.
- **Shared alias (`~/.agents/skills/`)**: Cursor, Copilot, and Goose all read this path. If you link Goose's global dir, the same skills become available in Cursor and Copilot automatically — intentional, per the harness docs.

---

## Sync state v2

The global colony's `.skdd-sync.json` uses state version 2, which adds an `mcp` key for tracking managed MCP servers per host. When you run `skdd link -g`, the state file under `~/.skdd/` is written (not the project-local one). Version 1 state files are automatically migrated to v2 on first load — the migration preserves all existing mirror entries and adds an empty `mcp.hosts` object.

---

## See also

- [`docs/mcp-sync.md`](mcp-sync.md) — canonical MCP server catalogue and per-host sync
- [`docs/configuration.md`](configuration.md) — per-harness project setup
- [`docs/integrations/droid.md`](integrations/droid.md) — Factory Droid deep-dive
