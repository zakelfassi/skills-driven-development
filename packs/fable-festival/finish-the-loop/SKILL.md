---
name: finish-the-loop
description: Closed-loop delegation — define done as an observable behavior, boot the real app, drive it like a user, fix what breaks, and verify by using it again before reporting. Use when implementing any feature or fix with a runtime surface, when tempted to report "it should work now", or when a task will span a long unattended stretch and the result must be trustworthy without supervision.
metadata:
  pack: fable-festival
  forged-by: claude-fable-5
  forged-from: session-2026-07-01-fable-festival
  forged-reason: "From the Fable Festival letter: there's an interruption tax, and the fix is the closed loop — 'not I wrote the code and it should work; I watched it work.' Delegating outcomes instead of keystrokes only functions if the agent closes the loop itself; this skill is the closing procedure."
  usage-count: "0"
  last-used: "2026-07-01"
---

# Finish the Loop

Done means observed, not compiled. The loop is: define done → reproduce →
change → drive the real artifact → re-drive after every fix → report with
evidence.

## Inputs
- The goal, stated or restated as observable behavior: *"a user who does X
  sees Y"* — not "the code is updated"
- A bootable environment (dev server, CLI, simulator, browser)

## Steps

1. **Write the acceptance line first.** One sentence per behavior:
   *"Submitting the form with an invalid email shows an inline error and
   preserves the other fields."* If the request came as a vibe ("make login
   less janky"), convert it to acceptance lines and state them — they are
   the contract for the rest of the loop.

2. **Boot the real thing.** Dev server up, app open, in the state a user
   would actually start from. If the project has a run/boot skill, use it;
   if booting took undocumented steps, that's a skill to forge later.

3. **Reproduce before fixing.** For bugs: watch it fail first. A fix for an
   unreproduced bug is a guess with a commit message.

4. **Make the change.** Smallest diff that satisfies the acceptance lines.

5. **Drive it like a user.** Click, type, navigate, submit — through the UI
   or CLI, not just the test suite. Cover the acceptance lines plus the
   adjacent paths: the empty state, the error state, the second submission,
   the mobile width, the back button.

6. **Re-drive after every fix.** Each repair re-runs the *whole* affected
   flow, not just the step that broke. Fixes regress their neighbors.

7. **Sweep before reporting.** Tests, typecheck, lint — the mechanical
   gates — plus one full pass of the core flow end to end.

8. **Report with evidence.** For each acceptance line: what you did, what
   you observed (screenshot, output, log line). The words "should work"
   are banned from the report; if something is unverified, name it as
   unverified rather than laundering it into confidence.

## Conventions
- Interruptions reset the loop — if the user redirects mid-loop, restate
  the new acceptance lines before continuing.
- Time spent making the app bootable is loop infrastructure, not yak
  shaving; do it once, freeze it as a skill.

## Edge Cases
- **No runtime surface** (pure library, config change): the loop's "drive"
  step becomes a consumer test — write the snippet a real caller would
  write and run it. Docs-only diffs exit the skill; there's nothing to observe.
- **Can't reproduce the bug.** Say so and deliver the instrumentation
  instead: the logging/repro harness that will catch it next occurrence.
  Don't ship a speculative fix as if it were verified.
- **The environment can't boot** (missing credentials, broken deps): that
  blocker *is* the deliverable — report it precisely; a loop that can't
  close honestly reports itself open.
