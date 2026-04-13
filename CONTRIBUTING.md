# Contributing to Skills-Driven Development

Thanks for wanting to contribute. This repo hosts the SkDD methodology, the `skillforge` meta-skill, example skills, and (eventually) a CLI and a Claude Code plugin. Contributions fall into three buckets:

1. **Methodology changes** — edits to `docs/`, `colony/`, or the README.
2. **New or improved skills** — changes under `skillforge/`, `examples/webapp-starter/skills/`, or new skill directories you'd like upstreamed.
3. **Tooling** — the `skdd` CLI, CI workflows, the Claude Code plugin, or the `.colony.json` schema.

## Ground rules

- **Use pnpm** for all JavaScript/TypeScript work. This repo does not support npm or yarn; they will produce inconsistent lockfiles.
- **Keep skills spec-compliant.** Every `SKILL.md` must pass `skdd validate` once the CLI is available. Until then, hand-check against the [Agent Skills specification](https://agentskills.io/specification.md).
- **Don't break existing skills.** If you add a metadata field, make sure agents that don't recognize it still work. The spec allows arbitrary `metadata`; SkDD extensions must never move to *required* status.
- **Prefer editing over duplicating.** If a skill or doc needs updating, edit it in place. Fork only when the divergence is large enough to justify two skills.

## Skill quality checklist

Before opening a PR that adds or changes a skill, verify:

- [ ] `name` is kebab-case, 1–64 characters, matches the directory name
- [ ] `description` is 1–1024 characters and contains the trigger phrases an agent would use to discover it
- [ ] Steps are numbered, actionable, and copy-pasteable by a fresh agent with no session context
- [ ] No hardcoded paths, secrets, environment values, or personal data
- [ ] `SKILL.md` is under 200 lines — move detail to `references/` when it grows beyond that
- [ ] `scripts/` are executable (`chmod +x`) and do the thing they claim to do
- [ ] The skill is registered in the nearest `.skills-registry.md` (both the markdown and JSON forms, once JSON exists)
- [ ] Edge cases section lists at least one non-trivial case (even "none known yet" is fine)

This list is reusable — it's the same one enforced by `skdd validate` and by the Claude Code plugin's `/forge` command.

## Methodology contributions

Methodology changes land in `docs/` and `colony/`. Keep prose:

- **Concrete**. Prefer file paths, line counts, and commands over metaphor.
- **Actionable**. Every "should" needs a "how." Every concept needs an example.
- **Consistent.** Use the terminology defined in [`docs/skill-colony.md`](docs/skill-colony.md#terminology) — *forge*, *evolve*, *compose*, *colony*, *registry*, *harness*.

If you're introducing a new concept, add it to the terminology section in `docs/skill-colony.md` and reference it from wherever else it appears.

## Tooling contributions

The `skdd` CLI lives under `cli/` and uses pnpm + TypeScript + Vitest. Before opening a PR:

```bash
pnpm -C cli install
pnpm -C cli test
pnpm -C cli build
```

All three must pass. The GitHub Actions workflow under `.github/workflows/validate-skills.yml` re-runs these on every PR, runs `skdd validate` across every skill in the repo, and greps for any stale pre-rename references (the project was renamed to SkDD in an early commit; the grep prevents regressions of the old acronym).

## Review process

- Small doc fixes: single approval from a maintainer, merged same-day when possible.
- New skills in `examples/`: single approval; the reviewer runs through the skill steps mentally to check for gaps.
- New skills proposed for adoption in `skillforge/` or a new top-level skill directory: two approvals, and the skill must have been used in at least one real project first (link the usage in the PR).
- CLI / plugin changes: two approvals, CI must be green, and the changelog (once it exists) must be updated.

## Licensing

Everything in this repo is MIT-licensed. Contributions are accepted under the same license. Don't include code or docs you can't license under MIT.

## Questions

Open a GitHub Discussion or a draft PR with `[RFC]` in the title. Draft PRs are the preferred way to propose methodology changes that need feedback before you commit to them.
