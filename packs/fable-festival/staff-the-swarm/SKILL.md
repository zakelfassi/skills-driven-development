---
name: staff-the-swarm
description: Fan wide work out to parallel agents — one lane and one definition of done per agent — then adversarially verify the findings and synthesize a single answer. Use when work is wide rather than deep (full-site audits, migrations across many call sites, research from multiple angles, review across dimensions), when a linear walk would take hours, or when independent perspectives materially reduce the chance of a wrong conclusion.
metadata:
  pack: fable-festival
  forged-by: claude-fable-5
  forged-from: session-2026-07-01-fable-festival
  forged-reason: "From the Fable Festival letter: 'I'm a good soloist. I'm a better conductor.' The pattern that outlives any one model — independent perspectives, then adversarial verification, then synthesis — is how good teams work, and it turns out to be how good models work too. Frozen so the conducting is a procedure, not an improvisation."
  usage-count: "0"
  last-used: "2026-07-01"
---

# Staff the Swarm

Decompose wide work into independent lanes, run them in parallel, make the
checkers adversarial, and hand back one synthesized answer instead of a
pile of agent transcripts.

## Inputs
- A wide task: many files, many pages, many angles, or many independent
  questions
- The orchestration surface available (subagents, workflow runner, or
  sequential fallback)

## Steps

1. **Check the shape.** Swarms pay off when lanes are *independent* —
   pieces that don't need each other's intermediate results. If every step
   feeds the next, stay solo; a swarm on sequential work is overhead
   wearing a costume.

2. **Cut the lanes.** Split by the natural seam: by page, by module, by
   dimension (correctness / security / performance / UX), by search angle.
   Lanes must not overlap, and their union must cover the task — write the
   coverage down.

3. **Write each agent a real brief.** Per lane: the goal, the boundaries
   ("only the checkout flow", "don't touch other modules"), the expected
   *shape* of the result (structured findings, not prose), and the
   definition of done. A vague brief returns a vague transcript.

4. **Dispatch in parallel, track centrally.** Fire independent lanes
   concurrently. Keep one scoreboard: lane, status, result summary.

5. **Verify adversarially.** Findings from stage one are claims, not facts.
   Send each significant claim to a checker whose job is to *refute* it —
   and when a claim can fail in more than one way, give each checker a
   different lens (does it reproduce? is it exploitable? does it matter?).
   Majority-refuted claims die. Verified ones carry their evidence forward.

6. **Merge like an editor, not a stapler.** Deduplicate across lanes,
   resolve contradictions explicitly (two agents disagreeing is a finding
   in itself), rank what survives by severity, and write the synthesis in
   one voice.

7. **Report coverage honestly.** Name what wasn't covered: lanes that
   failed, items sampled instead of swept, checks skipped. Silent
   truncation reads as "covered everything" — that's a lie of omission.

## Conventions
- One lane, one agent, one definition of done. Agents that share a lane
  duplicate work; agents without a DoD return essays.
- The orchestrator synthesizes but does not re-do lane work — if a lane
  came back weak, re-brief and re-dispatch rather than quietly patching.
- Structured results beat prose: ask lanes for findings as file/claim/
  evidence triples so the merge is mechanical.

## Edge Cases
- **Lanes return contradictory results.** Don't average them. Escalate the
  contradiction to a dedicated tie-breaker check with both results in hand.
- **No parallel orchestration available.** The pattern degrades gracefully:
  run the same lanes and briefs sequentially — the discipline (lanes, DoD,
  adversarial verify, honest coverage) is the value, parallelism is just
  the speed.
- **The swarm is more expensive than the task.** Two or three lanes is a
  fine swarm. If briefing costs more than doing, do it solo.
