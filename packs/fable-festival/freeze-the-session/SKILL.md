---
name: freeze-the-session
description: End-of-session artifact extraction — convert what a session produced into durable assets (a skill, a DESIGN.md, a checklist, a codebase map) and register them in the colony. Use when a substantive working session is ending, when someone says "save this workflow" or "remember how we did this", after a hard-won debugging victory, or whenever model access is scarce and the judgment spent should outlive the session.
metadata:
  pack: fable-festival
  forged-by: claude-fable-5
  forged-from: session-2026-07-01-fable-festival
  forged-reason: "From the Fable Festival letter: an answer is consumed once, an artifact compounds. 'You're not buying my labor this week, you're buying my judgment while it's available — and judgment, written down, runs on whatever model is still standing when the lights go out.' This skill is that principle as a closing procedure — fittingly, it's the skill that forged this pack."
  usage-count: "1"
  last-used: "2026-07-01"
---

# Freeze the Session

Before ending a substantive session, extract what it learned into
artifacts the next session — or the next model — can execute without you.

## Inputs
- The session itself: what was built, decided, discovered, or repeated
- The colony: project `skills/` + `.skills-registry.md`, or the global
  `~/.skdd/skills/`

## Steps

1. **Inventory what the session actually learned.** Scan for the four
   freezable shapes:
   - **A repeated or repeatable workflow** — you did (or will do) this
     sequence again → *skill*
   - **Judgment applied to a surface** — visual direction, copy voice,
     API shape decisions → *convention doc* (DESIGN.md, VOICE.md, style rules)
   - **Failure modes found the hard way** — review findings, attack
     results, debugging dead-ends → *checklist*
   - **Hard-won orientation** — how the codebase actually fits together,
     which the file tree doesn't reveal → *map* (architecture note)

2. **Skip what's already frozen.** Don't extract what the repo records on
   its own (git history, existing docs, CLAUDE.md) or what only mattered
   this once. An empty inventory is a valid result — say so and stop.

3. **Freeze each item in its native format.**
   - Skills → follow **skillforge**: kebab-case name, discovery-grade
     `description` (what + when-to-use triggers), steps, conventions,
     edge cases. The description is the retrieval surface — write it for
     the agent who doesn't know this skill exists.
   - Convention docs → rules an agent can *obey*, not prose it must
     interpret: tokens, scales, allowed/forbidden lists, before/after pairs.
   - Checklists → each entry is checkable: trigger + expected observation,
     not "make sure it's good".
   - Maps → entry points, the three layers that matter, where the bodies
     are buried. One page maximum.

4. **Register.** Add each artifact to the colony registry
   (`.skills-registry.md`) with source and date; refresh harness mirrors
   (`skdd link`, or `-g` for global). An unregistered artifact is a file;
   a registered one is process memory.

5. **Close with the ledger.** End the session report with a "frozen"
   section: what was extracted, where it lives, and the one-line trigger
   that should recall each artifact. If nothing was frozen, one line
   saying why.

## Conventions
- Extraction is part of the session, not an optional epilogue — budget the
  last few minutes for it the way a surgeon budgets for closing.
- Prefer updating an existing skill over forging a near-duplicate; the
  colony's value is density, not count.
- Write artifacts model-agnostically: no references to a specific model's
  capabilities, so they run on whatever is standing when it's dark again.

## Edge Cases
- **Session was pure toil** (mechanical edits, no judgment): nothing to
  freeze — the inventory correctly comes back empty. Freezing toil creates
  registry noise that buries the real skills.
- **The learning contradicts an existing artifact.** That's an *evolution*,
  the most valuable freeze there is: update the existing artifact, note
  what changed and why in its metadata, bump its version.
- **Mid-session interruption or context running out.** Freeze early, not
  at the end: the moment something feels reusable, extract it — a session
  that dies unfrozen loses everything it learned.
