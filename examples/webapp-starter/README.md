# webapp-starter — try SkDD in 60 seconds

> Reference structure of a SkDD-enabled project. **Not a runnable webapp** — no React, no Express, no `pnpm install`. What you get instead is the exact *shape* of a project that uses skills: where they live, what the registry looks like, and what the agent is told to do.

## What's in here

```
webapp-starter/
├── AGENTS.md                    # Harness-agnostic agent config
├── CLAUDE.md                    # Claude Code project instructions
├── package.json                 # Minimal stub — anchors the project; not a real build
├── .skills-registry.md          # The colony registry (markdown table)
└── skills/
    ├── api-endpoint/SKILL.md    # Example: scaffold REST endpoints
    ├── bug-triage/SKILL.md      # Example: triage bugs into issues
    ├── component-scaffold/SKILL.md  # Example: React component scaffolding
    └── deploy-preview/
        ├── SKILL.md
        └── scripts/
            └── deploy-preview.sh  # The one real, executable script in here (a stub)
```

## Try it (60 seconds)

1. **Copy this directory somewhere you'll open with your agent**:
   ```bash
   cp -r examples/webapp-starter /tmp/skdd-demo
   cd /tmp/skdd-demo
   ```
2. **Drop in the skillforge meta-skill** (the one thing this reference omits because it lives at the SkDD repo root):
   ```bash
   mkdir -p skills/skillforge
   curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
     -o skills/skillforge/SKILL.md
   ```
3. **Open it with Claude Code** (or the harness of your choice — see [`docs/configuration.md`](../../docs/configuration.md) for Codex, Cursor, Copilot, etc.).
4. **Ask the agent**: *"What skills are available in this project?"* — the agent should read `.skills-registry.md` and list `api-endpoint`, `bug-triage`, `component-scaffold`, `deploy-preview`, and `skillforge`.
5. **Try running the one real script**: `pnpm skills:deploy-preview some-branch` — it prints what a real deploy would do and exits cleanly. That's your "does the example path resolve correctly?" check.

## What's illustrative vs. what actually runs

| Path | Status |
|------|--------|
| `skills/deploy-preview/scripts/deploy-preview.sh` | **Runs** — stub that echoes a fake preview URL |
| `skills/*/SKILL.md` | **Read-only fixtures** — the agent will read them like real skills |
| `.skills-registry.md` | **Read-only fixture** — the agent will parse it |
| `package.json` `scripts:*` | `skills:list` and `skills:deploy-preview` work; there are no other commands |
| Imagined React / Express code | Does not exist |
| `scripts/notify-critical.sh` referenced from `bug-triage` | Deliberately absent — illustrative only |

## Next steps

- Fork this into a real project, replace the example skills with ones you forge while working, and wire in a real `deploy-preview.sh`.
- Read [`../../docs/configuration.md`](../../docs/configuration.md) for harness-specific setup.
- Read [`../../docs/forging-skills.md`](../../docs/forging-skills.md) for the forging workflow in depth.
