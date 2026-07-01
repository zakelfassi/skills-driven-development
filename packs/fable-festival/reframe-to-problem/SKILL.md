---
name: reframe-to-problem
description: Detect a plan-shaped request and surface the problem one altitude level above it before executing. Use when a request arrives as a prescriptive implementation step ("add caching to this endpoint", "add an index", "wrap it in a retry") with no symptom, metric, or goal attached, or when the obvious fix appears to treat a symptom rather than a cause.
metadata:
  pack: fable-festival
  forged-by: claude-fable-5
  forged-from: session-2026-07-01-fable-festival
  forged-reason: "From the Fable Festival letter: 'the more finished your plan, the less of me you're using.' Decomposition is the expensive cognition; when a user pre-decomposes and hands over step three of their own plan, the model types instead of thinks. This skill makes the altitude-check a repeatable step instead of a personality trait."
  usage-count: "0"
  last-used: "2026-07-01"
---

# Reframe to Problem

Before executing a prescriptive task, climb one level: find the problem the
task is supposed to solve, verify the task is actually the right lever, and
only then execute — the original step, or the better one you found.

## Inputs
- A request phrased as an implementation step
- Access to the codebase, and ideally to the evidence behind the request
  (traces, metrics, error logs, the complaint that started it)

## Steps

1. **Detect the shape.** A request is plan-shaped when it names a mechanism
   but not a symptom: *"add caching"*, *"switch to a queue"*, *"debounce
   this"*, *"add retries"*. If the request already includes the symptom and
   the evidence, skip this skill and execute.

2. **Recover the problem.** Ask (or infer from context) three things:
   - What observable symptom prompted this? (slow page, flaky job, angry email)
   - How would we measure that it's fixed?
   - Who decided on this mechanism, and what did they look at?

3. **Spend 10 minutes disconfirming.** Before implementing, look for
   evidence the prescribed mechanism targets the actual cause: profile the
   slow path, read the failing trace, reproduce the bug. Timebox it — this
   is a cheap insurance pass, not a research project.

4. **Fork on what you find.**
   - **Mechanism confirmed** → say so in one line and execute the original ask.
   - **Different cause found** → present the reframe: symptom, actual cause,
     proposed fix, and why the original step would have masked it. Then fix
     the cause (if in scope) or ask which to do (if the scope genuinely changes).

5. **Record the altitude.** One sentence in the PR/commit/report: the problem,
   not just the change. Future readers get the *why* for free.

## Conventions
- Never silently substitute your plan for theirs — show the reasoning fork.
- The reframe is a finding, not a lecture. One paragraph, then action.

## Edge Cases
- **The user is the expert and knows exactly why.** Detection step 2 catches
  this: if the symptom and evidence come back crisp, execute without ceremony.
- **Emergency/hotfix context.** Ship the symptom-level fix first, then file
  the root-cause reframe as the follow-up — say explicitly which one you did.
- **The 10-minute pass is inconclusive.** Execute the original ask and note
  what you'd measure to find out who was right.
