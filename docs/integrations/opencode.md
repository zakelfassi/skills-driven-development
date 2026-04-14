# OpenCode

> OpenCode is an open-source CLI agent (npm `opencode`) that supports Agent Skills at `.opencode/skills/`.

## Quick install

```bash
pnpm dlx @zakelfassi/skdd init --harness=opencode
```

Scaffolds `skills/skillforge/SKILL.md` (canonical), `.skills-registry.md`, the `AGENTS.md` skills block, and `.opencode/skills → ../skills` as the mirror OpenCode reads.

## Configure

OpenCode reads `AGENTS.md`. The block `skdd init` writes references `skills/` as the canonical source and `.opencode/skills` as the mirror. See [`docs/configuration.md#opencode`](../configuration.md#opencode) for the exact text.

## Harness notes

- OpenCode is BSD-licensed open source; see [opencode.ai/docs/skills/](https://opencode.ai/docs/skills/).
- OpenCode's skill loader walks up the directory tree so nested colonies in monorepos work without extra config.
- Use the local CLI: `opencode skills list` to see what OpenCode itself discovered, independent of SkDD's `skdd list`.

## Verify

Three-question check: list → forge → reopen → list again.

## Troubleshooting

Check `opencode --version` — skill support landed in v0.14. Older versions ignore `.opencode/skills/` silently.
