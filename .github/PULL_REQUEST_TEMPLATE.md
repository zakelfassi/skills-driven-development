<!--
Thanks for contributing to Skills-Driven Development!

Before opening this PR, please:
1. Make sure `pnpm -C cli test && pnpm -C cli build && pnpm -C cli typecheck` passes locally
2. If you changed a skill or added a new one, verify `skdd validate` passes
3. If you changed the methodology or docs, check that cross-references still resolve
-->

## Summary

<!-- 1-3 bullets explaining what this PR changes and why -->

-

## Type of change

<!-- Check all that apply -->

- [ ] Bug fix (non-breaking change)
- [ ] New feature (non-breaking change)
- [ ] Breaking change (fix or feature that would cause existing behavior to change)
- [ ] Methodology doc change
- [ ] New skill (in `skillforge/`, `examples/`, or `plugins/skdd-claude/skills/`)
- [ ] CLI enhancement
- [ ] VS Code extension enhancement
- [ ] Build / CI / tooling
- [ ] Documentation site (`site/`)

## Skill quality checklist

<!-- Only applicable if this PR adds or modifies a skill. Delete the section otherwise. -->

- [ ] `name` is kebab-case, 1-64 characters, matches the directory name
- [ ] `description` is 1-1024 characters and contains trigger phrases agents would use
- [ ] Steps are numbered, actionable, and copy-pasteable by a fresh agent with no session context
- [ ] No hardcoded paths, secrets, environment values, or personal data
- [ ] `SKILL.md` is under 200 lines — moved detail into `references/` when it grew beyond that
- [ ] `scripts/` are executable (`chmod +x`) and do what they claim
- [ ] The skill is registered in the nearest `.skills-registry.md`
- [ ] Edge cases section lists at least one non-trivial case (even "none known yet" is fine)
- [ ] `skdd validate` passes on the new or changed skill

## CLI / tooling checklist

<!-- Only applicable if this PR touches cli/, extensions/, plugins/, or CI. -->

- [ ] `pnpm -C cli test` passes (or new tests added + passing)
- [ ] `pnpm -C cli build` passes
- [ ] `pnpm -C cli typecheck` passes
- [ ] `node cli/dist/index.js doctor` runs cleanly on the SkDD repo
- [ ] No new dependencies, OR new dependencies justified in the description
- [ ] `cli/README.md` updated if the command surface changed
- [ ] `CHANGELOG.md` updated (under `## [Unreleased]`)

## Test plan

<!-- How did you verify this works? Copy/paste command output if helpful. -->

- [ ] Unit tests pass
- [ ] Manual test in a scratch project
- [ ] Verified on [harness name] if harness-specific

## Related issues

<!-- Closes #123 / Refs #456 / Follows up #789 -->
