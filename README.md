# Skills-Driven Development (SkDD)

> Agents that learn by doing — and remember how they did it.

Skills-Driven Development (SkDD) is a methodology where AI agents **create, evolve, and share reusable skills** as a natural byproduct of their work. Instead of front-loading all knowledge into prompts, agents forge skills on the fly and persist them for future reuse.

## What is a skill?

A **skill** is a reusable, discoverable playbook — markdown instructions plus optional scripts and references — that an agent follows to accomplish a specific, repeatable task (e.g., "scaffold a REST endpoint", "deploy a preview branch", "triage a bug report"). Structurally it's a directory containing a `SKILL.md` file with YAML frontmatter, following the open [Agent Skills](https://agentskills.io) specification. Functionally it's process memory: agents discover skills by description, follow their steps, and evolve them when they encounter edge cases.

SkDD treats skills as **living artifacts** — discovered, forked, evolved, and composed by agents across projects and sessions. The goal is not a static skill library but a **colony** that gets smarter every time it's used.

## The Core Idea

Most agent workflows today are stateless: the agent reads a prompt, does work, and forgets. SkDD adds a feedback loop:

```
Work → Notice a reusable pattern → Forge a skill → Persist it → Discover it next time
```

This turns agent experience into **compound knowledge**. The more an agent works, the better it gets — not because the model improves, but because the skill colony grows.

## The SkDD Lifecycle

```
              ┌──────────────────────────────────────────────┐
              │                                              │
              ▼                                              │
     ┌────────────────┐      repeated pattern?      ┌────────┴───────┐
     │ 1. Agent works │─── no ──────────────────────│ 5. Evolve      │
     │    on a task   │                             │    Add edge    │
     └───────┬────────┘                             │    cases, fix  │
             │ yes                                  │    scripts,    │
             ▼                                      │    split, etc. │
     ┌────────────────┐                             └────────▲───────┘
     │ 2. Forge       │                                      │
     │    skillforge  │                                      │
     │    writes      │                                      │
     │    SKILL.md    │                                      │
     └───────┬────────┘                                      │
             │                                               │
             ▼                                               │
     ┌────────────────┐     session N+1                      │
     │ 3. Register    │────────────────────┐                 │
     │    in registry │                    ▼                 │
     └────────────────┘         ┌────────────────┐           │
                                │ 4. Discover    │───────────┘
                                │    via desc    │    in-use
                                │    match       │
                                └───────┬────────┘
                                        │ unused 90d
                                        ▼
                                ┌────────────────┐
                                │ 6. Archive     │
                                │    (reversible)│
                                └────────────────┘
```

Every loop through the diagram *improves* the colony. Archiving is reversible; nothing is ever deleted.

## What This Repo Contains

| Path | What it is |
|------|-----------|
| [`docs/`](docs/) | The methodology: skill colony concept, forging mechanics, specification alignment |
| [`skillforge/`](skillforge/) | The meta-skill: agents use this to create new skills |
| [`examples/`](examples/) | Reference structure of a SkDD-enabled project (skills, registry, AGENTS.md — not a runnable webapp) |
| [`colony/`](colony/) | The skill colony pattern: discovery, evolution, sharing |

## Quick Start

SkDD works in any harness that understands the Agent Skills spec (Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, OpenCode, Goose, Amp, and more). The four steps below assume **Claude Code**; see [docs/configuration.md](docs/configuration.md) for Codex, Cursor, Copilot, and other harnesses.

### Step 1 — Drop the skillforge meta-skill into your project

Run this from the root of **your own project** (not this repo):

```bash
mkdir -p .claude/skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o .claude/skills/skillforge/SKILL.md
touch .skills-registry.md
```

This installs the one skill you need to forge more skills, plus an empty registry file at the project root.

> Prefer a CLI? Once the `skdd` package is installed (`pnpm add -D skdd`), `skdd init --harness=claude` does the same thing and picks the right path for Codex/Cursor/Copilot automatically.

### Step 2 — Tell the agent to use the colony

Add these lines to your `CLAUDE.md` (or `AGENTS.md` for harnesses that read it):

```markdown
## Skills

At session start, read `.skills-registry.md` to see what skills are available. When you notice a repeated pattern (2–3 occurrences) or when I ask you to "forge a skill for X", invoke the `skillforge` skill and follow its steps. Skills live under `.claude/skills/<name>/SKILL.md`; the registry lives at `.skills-registry.md` in the project root.
```

This is the "discovery contract." Without it, the agent won't know to look.

### Step 3 — Trigger the skillforge

Forging is a natural-language prompt, not a CLI command. Any of these work:

- *"Forge a skill for scaffolding a new API endpoint. Follow the skillforge steps."*
- *"We've done this deploy dance three times today — let's make it a skill."*
- *"Save this workflow as a skill so next session's agent can reuse it."*

The agent reads `.claude/skills/skillforge/SKILL.md`, walks through its checklist, and writes a new skill to `.claude/skills/<name>/SKILL.md`. It then appends a row to `.skills-registry.md`.

### Step 4 — Verify it persisted

Open a **fresh** Claude Code session in the same project and ask:

- *"What skills are available in this project?"*

The agent should list the skill you just forged. That confirms the discovery loop closed — the skill is now process memory that survives sessions.

> **When does discovery happen?** Not "automatically." It happens because step 2 added instructions that tell the agent to read the registry. SkDD is a set of conventions plus a meta-skill; the harness (Claude Code, Codex, etc.) is what actually loads the skills when prompted.

## The Skill Colony

When skills accumulate across projects and agents, they form a **skill colony** — a shared, evolving library of capabilities that agents can discover, fork, and adapt.

See [colony/README.md](colony/README.md) for the full concept.

```
Project A forges:   deploy-preview
Project B forks:    deploy-preview → deploy-preview-vercel
Project C discovers: deploy-preview-vercel (via registry)
Agent X evolves:    deploy-preview-vercel (adds rollback)
```

Skills aren't static documentation. They're **living process memory**.

## How SkDD Relates to the Agent Skills Spec

SkDD is fully compatible with the [Agent Skills specification](https://agentskills.io/specification.md):

| Agent Skills Spec | SkDD Extension |
|-------------------|----------------|
| `SKILL.md` with YAML frontmatter | ✅ Same format |
| `scripts/`, `references/`, `assets/` | ✅ Same structure |
| Manual skill creation | ➕ Agents forge skills autonomously |
| Static skill libraries | ➕ Skills evolve through use |
| Per-project skills | ➕ Colony-level discovery + sharing |

SkDD doesn't replace the spec — it adds a **lifecycle** on top of it.

## Principles

### 1. Forge, don't front-load
Don't try to anticipate every skill upfront. Let agents create skills when they notice patterns during real work.

### 2. Small skills, composed loosely
Each skill should do one thing well. Complex workflows emerge from composing small skills, not from monolithic instruction sets.

### 3. Skills are living documents
A skill that was forged 3 months ago and never updated is dead weight. Agents should evolve skills when they encounter edge cases or better approaches.

### 4. The colony is the product
Individual skills are useful. A colony of skills that agents can discover and compose is transformative. Invest in the registry and discovery mechanisms.

### 5. Human-readable, machine-executable
Skills are markdown files that humans can read, review, and edit. But they're structured so agents can parse, discover, and execute them without human intervention.

## Inspiration & Prior Art

- [Agent Skills Specification](https://agentskills.io) — The open format this builds on
- [Forgeloop](https://github.com/zakelfassi/forgeloop-kit) — Agentic build loop framework where SkDD was first implemented (embedded under the hood before it was extracted as a standalone methodology)
- [how-to-ralph-wiggum](https://github.com/ghuntley/how-to-ralph-wiggum) — The Ralph methodology for agent-driven development
- [marge-simpson](https://github.com/Soupernerd/marge-simpson) — Knowledge persistence patterns across sessions

## License

MIT — see [LICENSE](LICENSE).
