# Specification Alignment

> How SkDD maps to the Agent Skills open specification.

SkDD is built on top of the [Agent Skills specification](https://agentskills.io). This document clarifies what's spec-standard, what's SkDD-extended, and how they compose.

## Spec Compliance

Every SkDD skill is a valid Agent Skills skill. The spec requires:

| Requirement | SkDD Status |
|-------------|-----------|
| Directory with `SKILL.md` | ✅ |
| YAML frontmatter with `name` + `description` | ✅ |
| `name`: lowercase, 1-64 chars, kebab-case | ✅ |
| `description`: 1-1024 chars, includes triggers | ✅ |
| Optional `scripts/`, `references/`, `assets/` | ✅ |
| Progressive disclosure (metadata → instructions → resources) | ✅ |

An SkDD skill works in any agent that supports the Agent Skills spec: Claude Code, Codex, Cursor, Gemini CLI, Amp, OpenCode, and others.

## SkDD Extensions (Compatible, Not Required)

SkDD adds lifecycle and colony concepts that are **compatible with** but **not required by** the spec:

### 1. Forge metadata
SkDD skills may include additional `metadata` fields (allowed by spec):

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
The `.skills-registry.md` file is an SkDD addition. It's a markdown file (not SKILL.md), so it doesn't conflict with the spec.

### 3. Evolution tracking
SkDD encourages agents to update skills through use. The spec doesn't prescribe update semantics, so this is purely additive.

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

# SkDD recommended: per-project, flat
.skills/<skill-name>/SKILL.md
```

SkDD recommends per-project placement because skills should reflect **project-specific conventions**, not just generic procedures.

## Composability

SkDD skills compose in two ways — a lightweight body syntax for human-readable chaining, and an optional `metadata.requires` field that formalizes the dependency for tooling. Both are spec-compatible because they live in the free-form body or the free-form `metadata` field.

### Body syntax — `<skill:name>`

When one skill's steps invoke another, write the reference as `<skill:name>` inline in the body. This is human-readable prose and also mechanically parseable (the CLI's `skdd list --format=json` will surface these edges in a future release).

```markdown
## Steps
1. <skill:api-endpoint> with entity="comment"
2. <skill:deploy-preview>
3. Update the registry usage count on both invoked skills
```

### Frontmatter — `metadata.requires`

For skills that *cannot run* without another skill, declare the dependency in frontmatter:

```yaml
metadata:
  requires:
    - api-endpoint >=1.0
    - deploy-preview
```

Each entry is `<skill-name>` optionally followed by a space and a [semver](https://semver.org) range that is checked against the target's `metadata.version`. A missing range means "any version".

### Resolution order

When an agent (or `skdd validate`) resolves a `<skill:name>` reference or a `metadata.requires` entry, it searches in this order:

1. **Project colony** — `.claude/skills/<name>/` (or whatever the active harness's skills dir is)
2. **User colony** — `~/.claude/skills/<name>/`
3. **Plugin colony** — any installed Claude Code plugin's `skills/<name>/` (namespaced as `plugin:<skill-name>`)
4. **Fail loudly** — if nothing resolves, the agent must report the missing dependency and stop. Silent fallback leads to surprise behaviour.

### Version semantics

- `metadata.version` is a string; SkDD treats it as semver when a `requires` entry specifies a range.
- If a skill omits `metadata.version`, assume `0.0.0` (pre-stable) — any non-trivial range check will fail, which is the desired loud-failure behaviour.
- Breaking changes to a skill should bump the major version and update `metadata.changelog` (optional, see [`colony/evolution.md`](../colony/evolution.md)).

### Spec compatibility

Neither of these mechanisms adds a required field. Agents that don't implement composition can still read and execute SkDD skills — they'll just ignore `<skill:name>` and the `metadata.requires` array. The spec explicitly allows arbitrary `metadata`, so this is a pure additive extension.
