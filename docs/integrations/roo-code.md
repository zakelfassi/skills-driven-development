# Roo Code

> Roo Code is a team-oriented IDE agent that supports Agent Skills at `.roo/skills/` (or `.rooroo/skills/` depending on version).

## Quick install

Roo Code isn't a first-class `skdd init` target yet, so the install is manual:

```bash
mkdir -p skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o skills/skillforge/SKILL.md
touch .skills-registry.md
mkdir -p .roo && ln -s ../skills .roo/skills     # substitute .rooroo/skills on older builds
```

(Once Roo Code is added to `skdd link`'s harness list, `skdd init --harness=roo-code` will wire it up automatically.)

## Configure

Roo Code reads `AGENTS.md`. Add a skills block that references `skills/` as canonical and `.roo/skills` as the mirror — see [`docs/configuration.md`](../configuration.md) for the universal template.

## Harness notes

- Roo Code's canonical docs: [docs.roocode.com/features/skills](https://docs.roocode.com/features/skills).
- Roo Code supports skill-level tool permissions via the `allowed-tools` frontmatter field.
- Teams using Roo Code should commit `.roo/skills/` to the repo alongside the registry.

## Verify

Three-question check (list → forge → reopen → list).

## Troubleshooting

If Roo Code ignores `.roo/skills/`, confirm with `roo --version` that you're on a version with skill support (late 2025+). Fall back to user-scope skills under `~/.roo/skills/` if project-scope isn't yet honored.
