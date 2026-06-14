# Agent Configuration — cli-tool

> **Heads up — this is a reference structure, not a runnable CLI.** There is no Rust or Go source code here. The files exist to show the *shape* of a SkDD-enabled CLI project: where `.skills-registry.md` lives, what forged SKILL.md files look like, and how `AGENTS.md` / `CLAUDE.md` should describe the colony. Scripts referenced from the skills (e.g. `scripts/release-cut.sh`) are **stubs** that print what a real step would do; others are intentionally absent. Fork this into a real `shipctl` project to make the skills actually execute.

This is a reference colony for a cross-platform CLI project (`shipctl`). It demonstrates SkDD for teams building compiled CLI tools with multi-platform release pipelines.

## Agent Setup

This project uses AI agents for development. Agents should:

1. **Load skills at session start** — read `.skills-registry.md` to discover available skills
2. **Use skills before re-deriving** — if a skill exists for the task, follow it
3. **Forge new skills** — when you notice a repeated pattern (2-3 occurrences), invoke `skillforge`
4. **Evolve existing skills** — when you encounter an edge case a skill doesn't cover, update it

## Available Skills

See `.skills-registry.md` for the current inventory.

## Project Conventions

- **Language:** Rust (primary), with a Go-flavored build matrix option
- **Release pipeline:** conventional commits → CHANGELOG → tag → GitHub release → cross-compiled binaries
- **Testing:** `cargo test` for unit, integration tests in `tests/`
- **Flags:** POSIX-style long flags (`--flag-name`), short aliases where canonical (`-v`, `-h`)
- **Man pages:** Generated from the command tree via `help2man` or a custom generator

## Skill Directories

```
skills/
├── release-cut/         # Cut a versioned release end-to-end
├── cross-compile-matrix/ # Add a new target triple to the build matrix
├── flag-add/            # Add a CLI flag end-to-end
├── manpage-sync/        # Regenerate man pages and completions
└── breaking-change-audit/ # Pre-release audit of public interface changes
```

## When to Forge vs. When to Code

| Signal | Action |
|--------|--------|
| You've done the same steps 3 times | **Forge a skill** |
| A convention isn't written down | **Forge a skill** |
| It's a one-off fix | **Just code it** |
| A skill exists but misses an edge case | **Update the skill** |
| A skill is over 200 lines | **Split it** |
