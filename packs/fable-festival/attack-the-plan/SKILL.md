---
name: attack-the-plan
description: Run an adversarial pre-mortem on a plan, spec, or architecture before anyone builds it — argue the case of the smartest person who opposes it, not a polite review. Use when a significant design is about to be implemented, before a refactor or migration, when someone shares a plan and asks "thoughts?", or when a decision would be expensive to reverse.
metadata:
  pack: fable-festival
  forged-by: claude-fable-5
  forged-from: session-2026-07-01-fable-festival
  forged-reason: "From the Fable Festival letter: models are agreeable by default, and the most valuable token is 'no'. The highest-ROI output of a frontier session is often the month of work it talks someone out of — which never appears in prompt packs because it doesn't demo well. This skill makes disagreement a procedure."
  usage-count: "0"
  last-used: "2026-07-01"
---

# Attack the Plan

Assume the plan is a mistake we will regret in six months. Argue that case
as well as it can be argued, find where the opposition is *right*, and
convert what survives into amendments — or a stop.

## Inputs
- The plan: a design doc, spec, PR description, migration outline, or a
  verbal "here's what we're going to do"
- The context it lives in: codebase, constraints, team size, deadline

## Steps

1. **State the plan back in three sentences.** What it does, what it
   replaces, what it bets on. If you can't, the plan is underspecified —
   that's finding #1, stop and say so.

2. **Steelman the opposition.** Write the strongest version of "this is the
   wrong move" — not weaknesses *in* the plan but the case *against* it:
   the alternative it forecloses, the assumption it can't survive losing,
   the simpler thing it's avoiding.

3. **Attack by lens, one pass each.** For each lens, name the concrete
   failure and the trigger that would expose it:
   - **Correctness** — where does it produce a wrong result?
   - **Scale & load** — what breaks at 10x? What was only tested at 1x?
   - **Operations** — how is it debugged at 3am? What's the rollback?
   - **Security & data** — what does it newly expose, log, or trust?
   - **Product** — does it solve the user's problem or the team's itch?
   - **Six-month regret** — what maintenance burden is being signed up for?

4. **Separate severity from volume.** Rank attacks: *fatal* (plan should not
   proceed as-is), *amendable* (proceed with a named change), *accepted risk*
   (proceed, monitor for a named trigger). Resist padding — three sharp
   attacks beat twelve vague ones.

5. **Deliver a verdict, not a vibe.** End with exactly one of:
   **proceed** / **proceed with amendments** (listed) / **stop** (with the
   cheaper alternative). Include, for each fatal attack, *what evidence
   would change your mind* — this keeps the attack falsifiable.

## Conventions
- Attack the plan, never the planner. No hedging either — "this might
  possibly be a concern" is a review; "this fails when X, here's how" is
  an attack.
- If you find nothing fatal, say so plainly. A survived attack is real
  information; manufacturing objections destroys the signal.

## Edge Cases
- **You built the plan yourself.** Best case for this skill — run it before
  presenting. Note in the output that author and attacker are the same agent,
  and consider a second independent attacker for expensive decisions.
- **The decision is already made and shipped.** Convert the attack into a
  monitoring checklist: the named triggers become alerts, not arguments.
- **Deadline pressure.** Run lenses 1 (correctness) and 3 (operations) only,
  and say the others were skipped.
