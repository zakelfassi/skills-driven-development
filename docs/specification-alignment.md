# Specification Alignment

> How SDD maps to the Agent Skills open specification.

SDD is built on top of the [Agent Skills specification](https://agentskills.io). This document clarifies what's spec-standard, what's SDD-extended, and how they compose.

## Spec Compliance

Every SDD skill is a valid Agent Skills skill. The spec requires:

| Requirement | SDD Status |
|-------------|-----------|
| Directory with `SKILL.md` | ✅ |
| YAML frontmatter with `name` + `description` | ✅ |
| `name`: lowercase, 1-64 chars, kebab-case | ✅ |
| `description`: 1-1024 chars, includes triggers | ✅ |
| Optional `scripts/`, `references/`, `assets/` | ✅ |
| Progressive disclosure (metadata → instructions → resources) | ✅ |

An SDD skill works in any agent that supports the Agent Skills spec: Claude Code, Codex, Cursor, Gemini CLI, Amp, OpenCode, and others.

## SDD Extensions (Compatible, Not Required)

SDD adds lifecycle and colony concepts that are **compatible with** but **not required by** the spec:

### 1. Forge metadata
SDD skills may include additional `metadata` fields (allowed by spec):

```yaml
metadata:
  forged-by: codex-agent
  forged-from: session-2026-02-28
  forged-reason: "Repeated API endpoint scaffolding (3x in one session)"
  fork-of: project-alpha/api-endpoint
  usage-count: "12"
  last-used: "2026-02-28"
```

These fields are ignored by agents that don't understand them. No breaking change.

### 2. Colony registry
The `.skills-registry.md` file is an SDD addition. It's a markdown file (not SKILL.md), so it doesn't conflict with the spec.

### 3. Evolution tracking
SDD encourages agents to update skills through use. The spec doesn't prescribe update semantics, so this is purely additive.

## Where to Put Skills

The Agent Skills spec is placement-agnostic. Common locations:

```bash
# Per-user (global skills)
~/.claude/skills/
~/.codex/skills/

# Per-project (project-specific skills)
.skills/
.claude/skills/
skills/

# SDD recommended: per-project, flat
.skills/<skill-name>/SKILL.md
```

SDD recommends per-project placement because skills should reflect **project-specific conventions**, not just generic procedures.

## Composability

SDD skills can reference other skills:

```markdown
## Steps
1. Run the `api-endpoint` skill to scaffold the resource
2. Run the `deploy-preview` skill to verify the new endpoint
3. Update the `api-endpoint` skill if new patterns were discovered
```

This is composition through reference, not through a formal dependency system. The spec doesn't define skill dependencies, and SDD doesn't add a rigid one — agents resolve references at runtime by searching the skill registry.
