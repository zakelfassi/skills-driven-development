# cli-tool — Claude Code instructions

This is a **reference structure**, not a runnable CLI. It exists to show how a SkDD-enabled CLI project is wired: where skills live, what the registry looks like, and what the agent is asked to do.

## Skills

Skills live under `skills/<name>/SKILL.md`. The registry is at `.skills-registry.md` in this directory.

At session start, read `.skills-registry.md` to discover available skills. Before deriving a solution, check whether an existing skill covers the task and follow it. When you notice a pattern repeat 2-3 times, or when I ask you to "forge a skill for X", invoke the `skillforge` skill and follow its steps. Update the registry after forging or using a skill.

The `skillforge` meta-skill is not in this directory — in a real project it would live at `skills/skillforge/SKILL.md`. To try this example end-to-end, copy `../../skillforge/SKILL.md` into `skills/skillforge/SKILL.md` first.

## Project conventions (illustrative)

- **Language:** Rust / Go (not actually installed — this is reference-only)
- **Release pipeline:** conventional commits → CHANGELOG → semver tag → GitHub release
- **Flags:** POSIX long flags, short aliases for common options
- **Man pages:** generated from command tree, committed to `docs/man/`

## Do not

- Do not `cargo build` or try to run any scripts beyond the stub — there is no source code.
- Do not treat the skills here as active tools; they are fixtures for documentation.
