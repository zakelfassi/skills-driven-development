# Skills-Driven Development (SkDD)

> Agents that learn by doing — and remember how they did it.

Skills-Driven Development (SkDD) is a methodology where AI agents **create, evolve, and share reusable skills** as a natural byproduct of their work. Instead of front-loading all knowledge into prompts, agents forge skills on the fly and persist them for future reuse.

A skill is a self-contained directory with a `SKILL.md` file that follows the [Agent Skills](https://agentskills.io) open specification. But SkDD goes further: it treats skills as **living artifacts** — discovered, forked, evolved, and composed by agents across projects and sessions.

## The Core Idea

Most agent workflows today are stateless: the agent reads a prompt, does work, and forgets. SkDD adds a feedback loop:

```
Work → Notice a reusable pattern → Forge a skill → Persist it → Discover it next time
```

This turns agent experience into **compound knowledge**. The more an agent works, the better it gets — not because the model improves, but because the skill library grows.

## What This Repo Contains

| Path | What it is |
|------|-----------|
| [`docs/`](docs/) | The methodology: skill colony concept, forging mechanics, specification alignment |
| [`skillforge/`](skillforge/) | The meta-skill: agents use this to create new skills |
| [`examples/`](examples/) | A sample project showing SkDD in action |
| [`colony/`](colony/) | The skill colony pattern: discovery, evolution, sharing |

## Quick Start

### 1. Add the skillforge to your project

Copy `skillforge/SKILL.md` into your project's skills directory:

```bash
mkdir -p .skills/skillforge
cp skillforge/SKILL.md .skills/skillforge/SKILL.md
```

Or reference it in your agent configuration:

```yaml
# AGENTS.md / .claude/settings.json / codex setup
skills:
  - skillforge/
```

### 2. Let agents forge skills as they work

When an agent encounters a repeatable pattern during development, it can invoke the skillforge to create a new skill:

```
"I notice I keep scaffolding API endpoints the same way.
Let me forge a skill for this."
```

The agent creates:
```
.skills/api-endpoint/
├── SKILL.md              # Instructions + triggers
├── scripts/scaffold.sh   # Executable template
└── references/
    └── conventions.md    # Project-specific patterns
```

### 3. Skills persist across sessions

Next time any agent works on the project, it discovers the `api-endpoint` skill automatically. No re-learning. No re-prompting. The pattern is encoded.

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
