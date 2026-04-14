# Amp

> Amp (Sourcegraph's frontier coding agent) supports Agent Skills at `.amp/skills/`.

## Quick install

```bash
pnpm dlx @zakelfassi/skdd init --harness=amp
```

Creates `skills/skillforge/SKILL.md` (canonical), `.skills-registry.md`, the `AGENTS.md` skills block, and `.amp/skills → ../skills` as the mirror Amp reads.

## Configure

Amp reads `AGENTS.md`. The skills block (auto-written by `skdd init`) references `skills/` as the canonical source and `.amp/skills` as the mirror maintained by `skdd link`. See [`docs/configuration.md#amp`](../configuration.md#amp) for the exact text.

## Harness notes

- Amp's canonical skills docs are at [ampcode.com/manual#agent-skills](https://ampcode.com/manual#agent-skills).
- Amp supports tool sandboxing; a skill's `allowed-tools` frontmatter field is honored (use `allowed-tools: Bash(git:*) Read` to scope).
- Amp teams use shared `.amp/skills/` committed to the repo — SkDD's project-scope default aligns naturally.

## Verify

Three-question check. Amp's agent UI also surfaces active skills in a sidebar — watch for `skillforge` to appear.

## Troubleshooting

If `allowed-tools` isn't working, make sure you're on Amp 1.2 or later — the field was experimental through most of 2025.
