# Amp

> Amp (Sourcegraph's frontier coding agent) supports Agent Skills at `.amp/skills/`.

## Quick install

```bash
mkdir -p .amp/skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o .amp/skills/skillforge/SKILL.md
touch .skills-registry.md
```

Or: `pnpm dlx skdd init --harness=amp`.

## Configure

Amp reads `AGENTS.md`. Add the standard skills block from [`docs/configuration.md#amp`](../configuration.md#amp) pointing at `.amp/skills/`.

## Harness notes

- Amp's canonical skills docs are at [ampcode.com/manual#agent-skills](https://ampcode.com/manual#agent-skills).
- Amp supports tool sandboxing; a skill's `allowed-tools` frontmatter field is honored (use `allowed-tools: Bash(git:*) Read` to scope).
- Amp teams use shared `.amp/skills/` committed to the repo — SkDD's project-scope default aligns naturally.

## Verify

Three-question check. Amp's agent UI also surfaces active skills in a sidebar — watch for `skillforge` to appear.

## Troubleshooting

If `allowed-tools` isn't working, make sure you're on Amp 1.2 or later — the field was experimental through most of 2025.
