# cli-tool — try SkDD in 60 seconds

> Reference colony for a cross-platform CLI project (`shipctl` persona). **Not a runnable CLI** — no Rust or Go source code, no build toolchain. What you get instead is the exact *shape* of a project that uses skills: where they live, what the registry looks like, and what the agent is told to do.

## What's in here

```
cli-tool/
├── AGENTS.md                          # Harness-agnostic agent config
├── CLAUDE.md                          # Claude Code project instructions
├── package.json                       # Minimal stub — anchors the project; not a real build
├── .skills-registry.md                # The colony registry (markdown table)
└── skills/
    ├── release-cut/
    │   ├── SKILL.md                   # Cut a versioned release
    │   └── scripts/
    │       └── release-cut.sh         # The one real, executable script (a dry-run stub)
    ├── cross-compile-matrix/SKILL.md  # Add a build-matrix target triple
    ├── flag-add/SKILL.md              # Add a CLI flag end-to-end
    ├── manpage-sync/SKILL.md          # Regenerate man pages + completions
    └── breaking-change-audit/SKILL.md # Pre-release public-interface audit
```

## Try it (60 seconds)

1. **Copy this directory somewhere you'll open with your agent**:
   ```bash
   cp -r examples/cli-tool /tmp/skdd-cli-demo
   cd /tmp/skdd-cli-demo
   ```
2. **Drop in the skillforge meta-skill**:
   ```bash
   mkdir -p skills/skillforge
   curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
     -o skills/skillforge/SKILL.md
   ```
3. **Open it with Claude Code** (or the harness of your choice — see [`docs/configuration.md`](../../docs/configuration.md)).
4. **Ask the agent**: *"What skills are available in this project?"* — the agent should read `.skills-registry.md` and list all five skills plus `skillforge`.
5. **Run the one real script**: `npm run skills:release-cut -- v1.2.0` — it prints a dry-run release plan and exits cleanly.

## What's illustrative vs. what actually runs

| Path | Status |
|------|--------|
| `skills/release-cut/scripts/release-cut.sh` | **Runs** — dry-run stub that echoes a release plan |
| `skills/*/SKILL.md` | **Read-only fixtures** — the agent reads them like real skills |
| `.skills-registry.md` | **Read-only fixture** — the agent parses it |
| `package.json` scripts | `skills:list` and `skills:release-cut` work; there are no other commands |
| Imagined Rust / Go source | Does not exist |
| `cargo build`, `make cross` | Will not work — no source code |

## Skill roster

| Skill | Real script? | Description |
|-------|-------------|-------------|
| `release-cut` | ✅ `scripts/release-cut.sh` | Bump version, generate changelog, tag, draft GitHub release |
| `cross-compile-matrix` | — | Add a new target triple to the CI yaml + Makefile + smoke test |
| `flag-add` | — | Add a CLI flag end-to-end: parser, help text, completion scripts, docs, test |
| `manpage-sync` | — | Regenerate man pages + shell completions from the command tree |
| `breaking-change-audit` | — | Diff public flags/exit codes/output formats vs last tag before release |

## Next steps

- Fork this into a real Rust/Go project, replace the example skills with ones you forge while working, and wire in a real `release-cut.sh`.
- Read [`../../docs/configuration.md`](../../docs/configuration.md) for harness-specific setup.
- Read [`../../docs/forging-skills.md`](../../docs/forging-skills.md) for the forging workflow.
