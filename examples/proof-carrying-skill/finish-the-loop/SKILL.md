---
name: finish-the-loop
description: Close implementation loops with target-bound independent evidence and a portable proof receipt. Use when an agent changes a real system and must earn a completion claim that survives the session.
---

# Finish the Loop

Treat completion as a claim that needs evidence from the intended target.

1. Read `WORKFLOW.json` and create `.skdd/runs/<run-id>/state.json` before changing the system.
2. Pin each acceptance line to an explicit target tuple: environment, resource, and revision. Do not let the executor silently choose or revise the target.
3. Record the executor identity and credential scope.
4. Reproduce, change, and drive the real artifact. Keep the run state resumable after interruption.
5. Collect evidence with a provider that has a different identity and credential scope from the executor. A test run by the same process is useful feedback, but it is not independent proof.
6. Emit `receipt.json` using the proof-receipt schema. Bind the skill bytes and each acceptance contract with SHA-256 digests.
7. Run `skdd proof verify receipt.json --skill SKILL.md`.
8. Report `verified` only when the verifier passes. Otherwise report the reason codes and leave the loop `refused`, `blocked`, or `open`.

Never translate “the build passed” into “the user-visible outcome works.” Evidence must match the acceptance target exactly.
