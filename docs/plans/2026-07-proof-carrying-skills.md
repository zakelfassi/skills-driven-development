# Proof-carrying skills

Status: experimental; falsification target, not protocol announcement.

## Hypothesis

A skill can carry an adaptive workflow without importing a host runtime when its completion boundary is public: resumable local state, target-bound acceptance contracts, independent evidence, and a portable receipt.

The first wedge is narrower than a workflow platform. An agent must not say “done” until an independent provider observes the requested behavior on the intended environment, resource, and revision.

## Ownership

- `SKILL.md` owns adaptive procedure.
- `WORKFLOW.json` owns the portable lifecycle contract.
- `.skdd/runs/<run-id>/state.json` owns resumable local state.
- `receipt.json` owns the completion claim and evidence references.
- `skdd proof verify` recomputes the verdict.

The verifier does not execute workflows, trust prose, or certify an external provider's honesty. It checks the properties available inside a portable artifact: exact target binding, provider/executor separation, credential-scope separation, run chronology, evidence outcome, acceptance digests, optional skill-byte binding, and recorded-verdict consistency.

## Falsification fixtures

The first three fixtures encode failures that ordinary “tests passed” reporting missed:

1. Local SQLite evidence offered for a Cloudflare D1 target.
2. Evidence produced under the executor's own identity and credential scope.
3. A green build offered while the user-visible acceptance probe failed.

The experiment fails technically if one deterministic verifier cannot refuse all three while accepting a correctly bound receipt. It fails as a product if teams will not author acceptance targets or use receipts after the mechanism works.

## Intentionally absent

No hosted service, workflow DSL, scheduler, adapter layer, dashboard, telemetry backend, cryptographic attestation network, LLM verdict, PaneForge dependency, or framework integration belongs in this experiment.
