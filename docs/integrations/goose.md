# Goose

> Goose is Block's open-source agent. It loads Agent Skills from user-scope (`~/.config/goose/skills/`) or project scope via an extension config.

## Quick install (project scope)

```bash
mkdir -p .goose/skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o .goose/skills/skillforge/SKILL.md
touch .skills-registry.md
```

Or: `pnpm dlx skdd init --harness=goose`.

## Configure

Goose reads project-level instructions from `AGENTS.md` or a Goose-specific `.goose/config.yaml`. SkDD recommends `AGENTS.md` for portability — add the standard skills block from [`docs/configuration.md#goose`](../configuration.md#goose) pointing at `.goose/skills/`.

## Harness notes

- Goose is maintained by Block, open-source; see [block.github.io/goose/docs/guides/context-engineering/using-skills/](https://block.github.io/goose/docs/guides/context-engineering/using-skills/).
- Goose has a built-in extension system — SkDD can also be packaged as a Goose extension for one-command install, but that's deferred to a future release.
- User-scope skills under `~/.config/goose/skills/` apply across all projects. Useful for your personal meta-skills.

## Verify

Three-question check. Goose's CLI also has `goose skills list` as an independent sanity check.

## Troubleshooting

If skills are not being loaded, check Goose's config loader order: user-scope → workspace → project. The project file must not be shadowed by a user-scope file with the same name.
