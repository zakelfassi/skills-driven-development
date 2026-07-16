---
title: "SkDD Commons"
description: "Community skills that evolve in public — dated drops, provenance, and the add/push evolution loop."
---

> Community skills that evolve in public — dated drops, provenance, and the add/push evolution loop.

**[SkDD Commons](https://github.com/zakelfassi/skdd-commons)** is the community repository for SkDD skills. It is a plain git repo — no hosted registry, no server-side index, no submission portal. Drops are directories, the manifest is a JSON file, and contributing is a PR.

## Drops

A **drop** is a curated, dated, themed set of skills: `YYYY-MM-<theme>`. Dated ids sort chronologically and give each release a story. A skill's `metadata.pack` names the drop it belongs to.

```bash
skdd drops                          # list drops from the configured commons
skdd drops --from owner/other-repo  # any Commons-shaped repo works
```

| Drop | Date | Skills |
|------|------|--------|
| [`2026-07-frontier` — July 2026 Frontier, the Fable Festival drop](https://github.com/zakelfassi/skdd-commons/tree/main/packs/2026-07-frontier) | 2026-07-01 | 6 |

## Installing: `skdd add`

```bash
# a whole drop into the project colony
pnpm dlx @zakelfassi/skdd add zakelfassi/skdd-commons 2026-07-frontier

# a single skill, or the global colony
skdd add zakelfassi/skdd-commons 2026-07-frontier/finish-the-loop
skdd add zakelfassi/skdd-commons 2026-07-frontier -g

# pin a ref, or use any git URL / local path
skdd add zakelfassi/skdd-commons#main 2026-07-frontier
```

What `add` guarantees:

1. **Validation before install** — every skill must pass `skdd validate --strict`; one failure refuses the whole selection.
2. **Collision safety** — an existing skill with the same name refuses the install; `--rename <new-name>` installs a single skill under a different name.
3. **Provenance** — the registry's Source column records `owner/repo@shortsha (drop-id)`; the full sha lands in `.skdd-lock.json` so future tooling can detect upstream drift.
4. **Mirror safety** — mirrors refresh through the same safe link path as `skdd link`: a populated harness directory is never replaced silently.
5. **Hostile-manifest safety** — `drops.json` ids and names are grammar-checked (lowercase kebab-case, no slashes or `..`) before any path is built, so a malicious Commons can never write outside your `skills/` directory.

`--dry-run` previews, `--json` emits a machine-readable report.

## Evolving: `skdd push`

The Commons' entire point. When a skill fails you in the wild:

```bash
# 1. fix your local copy (skills/<name>/SKILL.md) — add the edge case
# 2. preview the PR
skdd push what-would-you-cut --dry-run
# 3. ship it (needs the GitHub CLI authenticated)
skdd push what-would-you-cut
```

- Skills that exist upstream branch as `evolve/<name>` and the PR includes a diff summary; new skills branch as `skill/<name>` and land in `incoming/` for maintainer triage (or an existing drop via `--drop <id>`).
- **Machine-local state never travels**: `usage-count` resets to `"0"` and `last-used` is dropped. Your usage stats are your colony's truth. `forged-*` provenance always travels.
- **Only the skill payload travels**: `SKILL.md` plus regular files under `scripts/`, `references/`, `assets/`. Dotfiles, symlinks, logs, and anything else in the skill directory stay home — `--dry-run` lists exactly what travels and what doesn't.
- The default target repo comes from `~/.skdd/config.toml`:

```toml
commons = "zakelfassi/skdd-commons"
```

## Security posture

Community skills are instructions your agent follows — a prompt-injection surface. The Commons treats it as one: CI lints every skill against a versioned deny-pattern list (pipe-to-shell, credential reads, instruction-override phrases, …); a hit blocks merge until a maintainer reviews it and applies the `security-reviewed` label. Details in the Commons' [SECURITY.md](https://github.com/zakelfassi/skdd-commons/blob/main/SECURITY.md).

This is **not** a review gate on forging — creating skills in your own colony stays gate-free. The gate exists where the trust boundary is: strangers shipping instructions to strangers' agents.

## Enforcement hooks (Claude Code)

Two Commons practices ship as **opt-in** hooks in the [`skdd-claude` plugin](https://github.com/zakelfassi/skills-driven-development/tree/main/plugins/skdd-claude): a `finish-the-loop` Stop gate (bounces unverified-success reports once) and a `freeze-the-session` reminder (surfaces unfrozen learnings before the context dies). Both are off by default — toggle with `/skdd-claude:skdd-hooks on`.

> A skill is a procedure the model follows when it decides to; a hook is a gate for when it forgets.
