# OpenCode

> OpenCode is an open-source CLI agent (npm `opencode`) that supports Agent Skills at `.opencode/skills/`.

## Quick install

```bash
mkdir -p .opencode/skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o .opencode/skills/skillforge/SKILL.md
touch .skills-registry.md
```

Or: `pnpm dlx skdd init --harness=opencode`.

## Configure

OpenCode reads `AGENTS.md`. Add the standard skills block from [`docs/configuration.md#opencode`](../configuration.md#opencode) with `.opencode/skills/` as the skills directory.

## Harness notes

- OpenCode is BSD-licensed open source; see [opencode.ai/docs/skills/](https://opencode.ai/docs/skills/).
- OpenCode's skill loader walks up the directory tree so nested colonies in monorepos work without extra config.
- Use the local CLI: `opencode skills list` to see what OpenCode itself discovered, independent of SkDD's `skdd list`.

## Verify

Three-question check: list → forge → reopen → list again.

## Troubleshooting

Check `opencode --version` — skill support landed in v0.14. Older versions ignore `.opencode/skills/` silently.
