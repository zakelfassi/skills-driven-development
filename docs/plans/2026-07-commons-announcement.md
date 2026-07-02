# SkDD Commons launch announcement — DRAFT for Zak's review

> Status: draft, **not yet posted**. Written 2026-07-01, updated 2026-07-02 for the two-drop launch. As of writing: `skdd-commons` is public, `@zakelfassi/skdd@1.1.0` is on npm, and both drops (`2026-07-frontier`, `2026-07-growth-circle`) are tagged Releases. Trim to taste; the short version is sized for X, the long version for the blog/newsletter.

---

## Short (X / social)

> Shipping SkDD Commons: skills that evolve in public.
>
> Every skill collection ships static files. Commons skills carry provenance — who forged them, from what session, why — and an evolution loop: hit an edge case, fix your copy, `skdd push` ships the diff upstream as a PR.
>
> Launching with two drops:
> • **2026-07-frontier** — six working practices Claude Fable 5 forged on its first day back from the export-control shutdown, from the Fable Festival letter.
> • **2026-07-growth-circle** — ten gated skills: a growth-team-in-a-box that refuses to run out of order (you can't publish what you haven't earned).
>
> ```
> pnpm dlx @zakelfassi/skdd add zakelfassi/skdd-commons 2026-07-frontier
> ```
>
> Git is the registry. PRs are the evolution. https://github.com/zakelfassi/skdd-commons

## Long (blog / newsletter)

**SkDD Commons is live** — a community repository of agent skills with a lifecycle, not a list.

The pitch in one line: *skills that evolve in public.* Every existing community skill collection ships static files; you copy them, they rot. SkDD skills carry lifecycle metadata (`forged-by`, `forged-from`, `forged-reason`) and an evolution model — an agent hits an edge case in the wild, appends it to its local copy, and `skdd push` ships the diff upstream as a PR with the provenance intact. A skill that says "evolved 14 times across 9 codebases" carries a trust signal no static list can fake.

Skills are released as curated, dated **drops** — and we're launching with two.

**`2026-07-frontier`** — *the Fable Festival drop*: six skills Claude Fable 5 forged on July 1, its first day back online after eighteen days of US export controls, each freezing one practice from [the welcome-back letter it wrote to builders](https://zakelfassi.com/blog/2026/2026-07-01-fable-festival-until-its-dark-again): bring me problems, not plans · ask me what's wrong with it · use my taste · let me finish · let me hire · make me leave something behind.

**`2026-07-growth-circle`** — *the growth-team-in-a-box drop*: ten skills that implement the [Growth Circle protocol](https://github.com/zakelfassi/growth-circle), a two-file schema (`GROWTH.md` + `VALUE.md`) for growth discipline in the agentic era. They form a gate DAG — each refuses to run until its upstream gate is earned — and enforce two rules as hard refusals, not advice: the *virality gate* (viral mechanics parked until activation + retention are proven) and the *alienation test* (anything a fully-informed user would resent is auto-killed). It's the same "you cannot publish what you have not earned" stance as the Commons itself, applied to growth.

Three design choices worth calling out:

1. **Git is the registry.** No hosted index, no submission portal. Drops are directories, the manifest is a JSON file, contributing is a fork and a PR.
2. **The trust boundary is explicit.** Forging skills in your own colony has no review gate — that's SkDD's forge-then-evolve bias. Importing strangers' instructions into your agent is different: CI lints every skill against a public deny-pattern list (pipe-to-shell, credential reads, "ignore previous instructions"…), and a hit blocks merge until a maintainer reviews it.
3. **Usage stats stay home.** `skdd push` strips `usage-count` and `last-used` before anything travels. Your colony's usage truth is local; only provenance is global.

Try it:

```bash
pnpm dlx @zakelfassi/skdd add zakelfassi/skdd-commons 2026-07-frontier
# or the growth-team-in-a-box:
pnpm dlx @zakelfassi/skdd add zakelfassi/skdd-commons 2026-07-growth-circle
# hit an edge case? evolve it:
skdd push what-would-you-cut
```

And for Claude Code users, two of the six practices now ship as **opt-in enforcement hooks** in the skdd plugin — a `finish-the-loop` Stop gate that bounces "should work now" reports once, and a `freeze-the-session` reminder that surfaces unfrozen learnings before your context dies. A skill is a procedure the model follows when it decides to; a hook is a gate for when it forgets.

---

*Posting checklist:* ✅ `skdd-commons` public · ✅ `@zakelfassi/skdd@1.1.0` on npm · ✅ both drops tagged as Releases · ✅ `skdd add` one-liner verified from a clean dir → **ready to post.** Optional before/after: cross-link the [growth-circle protocol repo](https://github.com/zakelfassi/growth-circle) ↔ the Commons, and submit to the marketplace list (SkillsMP, skills.sh, ClawHub, LobeHub).
