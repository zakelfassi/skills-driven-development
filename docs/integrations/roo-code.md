# Roo Code

> Roo Code is a team-oriented IDE agent that supports Agent Skills at `.roo/skills/` (or `.rooroo/skills/` depending on version).

## Quick install

```bash
mkdir -p .roo/skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o .roo/skills/skillforge/SKILL.md
touch .skills-registry.md
```

(If your Roo Code install expects `.rooroo/skills/` instead, substitute.)

## Configure

Roo Code reads `AGENTS.md`. Add the standard skills block from [`docs/configuration.md`](../configuration.md) pointing at your Roo Code skills path.

## Harness notes

- Roo Code's canonical docs: [docs.roocode.com/features/skills](https://docs.roocode.com/features/skills).
- Roo Code supports skill-level tool permissions via the `allowed-tools` frontmatter field.
- Teams using Roo Code should commit `.roo/skills/` to the repo alongside the registry.

## Verify

Three-question check (list → forge → reopen → list).

## Troubleshooting

If Roo Code ignores `.roo/skills/`, confirm with `roo --version` that you're on a version with skill support (late 2025+). Fall back to user-scope skills under `~/.roo/skills/` if project-scope isn't yet honored.
