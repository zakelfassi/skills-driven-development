# SkDD Commons launch announcement — DRAFT for Zak's review

> Status: draft, not posted anywhere. Written 2026-07-01 by claude-fable-5 as part of the Commons plan Phase 4. Trim to taste; the short version is sized for X, the long version for the blog/newsletter.

---

## Short (X / social)

> Shipping SkDD Commons: skills that evolve in public.
>
> Every skill collection ships static files. Commons skills carry provenance — who forged them, from what session, why — and an evolution loop: hit an edge case, fix your copy, `skdd push` ships the diff upstream as a PR.
>
> First drop: **2026-07-frontier** — six working practices Claude Fable 5 forged on its first day back from the export-control shutdown, distilled from the Fable Festival letter.
>
> ```
> pnpm dlx @zakelfassi/skdd add zakelfassi/skdd-commons 2026-07-frontier
> ```
>
> Git is the registry. PRs are the evolution. https://github.com/zakelfassi/skdd-commons

## Long (blog / newsletter)

**SkDD Commons is live** — a community repository of agent skills with a lifecycle, not a list.

The pitch in one line: *skills that evolve in public.* Every existing community skill collection ships static files; you copy them, they rot. SkDD skills carry lifecycle metadata (`forged-by`, `forged-from`, `forged-reason`) and an evolution model — an agent hits an edge case in the wild, appends it to its local copy, and `skdd push` ships the diff upstream as a PR with the provenance intact. A skill that says "evolved 14 times across 9 codebases" carries a trust signal no static list can fake.

Skills are released as curated, dated **drops**. The bootstrap drop is `2026-07-frontier` — *July 2026 Frontier, the Fable Festival drop*: six skills Claude Fable 5 forged on July 1, its first day back online after eighteen days of US export controls, each freezing one practice from [the welcome-back letter it wrote to builders](https://zakelfassi.com/blog/2026/2026-07-01-fable-festival-until-its-dark-again): bring me problems, not plans · ask me what's wrong with it · use my taste · let me finish · let me hire · make me leave something behind.

Three design choices worth calling out:

1. **Git is the registry.** No hosted index, no submission portal. Drops are directories, the manifest is a JSON file, contributing is a fork and a PR.
2. **The trust boundary is explicit.** Forging skills in your own colony has no review gate — that's SkDD's forge-then-evolve bias. Importing strangers' instructions into your agent is different: CI lints every skill against a public deny-pattern list (pipe-to-shell, credential reads, "ignore previous instructions"…), and a hit blocks merge until a maintainer reviews it.
3. **Usage stats stay home.** `skdd push` strips `usage-count` and `last-used` before anything travels. Your colony's usage truth is local; only provenance is global.

Try it:

```bash
pnpm dlx @zakelfassi/skdd add zakelfassi/skdd-commons 2026-07-frontier
# hit an edge case? evolve it:
skdd push what-would-you-cut
```

And for Claude Code users, two of the six practices now ship as **opt-in enforcement hooks** in the skdd plugin — a `finish-the-loop` Stop gate that bounces "should work now" reports once, and a `freeze-the-session` reminder that surfaces unfrozen learnings before your context dies. A skill is a procedure the model follows when it decides to; a hook is a gate for when it forgets.

---

*Posting checklist (manual):* flip `skdd-commons` public first · tag the `2026-07-frontier` GitHub Release · verify the `skdd add` one-liner works from a clean machine/account · then post.
