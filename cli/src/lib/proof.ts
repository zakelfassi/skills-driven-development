import { createHash } from "node:crypto";

export const PROOF_RECEIPT_SCHEMA = "https://skdd.dev/schemas/proof-receipt/v1" as const;

export const PROOF_REASON_CODES = [
  "SCHEMA_INVALID",
  "SKILL_DIGEST_MISMATCH",
  "SKILL_DIGEST_UNCHECKED",
  "ACCEPTANCE_DIGEST_MISMATCH",
  "MISSING_EVIDENCE",
  "TARGET_MISMATCH",
  "CIRCULAR_EVIDENCE",
  "SHARED_CREDENTIAL_SCOPE",
  "EVIDENCE_FAILED",
  "EVIDENCE_OUTSIDE_RUN",
  "VERDICT_MISMATCH",
] as const;

export type ProofReasonCode = (typeof PROOF_REASON_CODES)[number];

export interface TargetTuple {
  environment: string;
  resource: string;
  revision: string;
}

export interface AcceptanceContract {
  id: string;
  statement: string;
  target: TargetTuple;
  digest: string;
}

export interface ProofEvidence {
  id: string;
  acceptance_id: string;
  provider: {
    id: string;
    kind: "external-probe" | "ci" | "browser" | "human" | "system";
    credential_scope: string;
  };
  probe: string;
  target: TargetTuple;
  observed_at: string;
  outcome: "pass" | "fail";
  payload_digest: string;
}

export interface ProofReceiptV1 {
  schema: typeof PROOF_RECEIPT_SCHEMA;
  run_id: string;
  skill: { name: string; digest: string };
  executor: { id: string; credential_scope: string };
  started_at: string;
  completed_at: string;
  acceptance: AcceptanceContract[];
  evidence: ProofEvidence[];
  verdict: { status: "pass" | "fail"; reason_codes: ProofReasonCode[] };
}

export interface ProofFinding {
  code: ProofReasonCode;
  message: string;
  acceptance_id?: string;
  evidence_id?: string;
}

export interface ProofVerification {
  valid: boolean;
  status: "pass" | "fail";
  findings: ProofFinding[];
  warnings: ProofFinding[];
  receipt?: ProofReceiptV1;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function digestJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

export function digestText(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function acceptanceDigest(
  contract: Pick<AcceptanceContract, "id" | "statement" | "target">,
) {
  return digestJson({ id: contract.id, statement: contract.statement, target: contract.target });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const expected = new Set(keys);
  return (
    Object.keys(value).length === expected.size &&
    Object.keys(value).every((key) => expected.has(key))
  );
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isTarget(value: unknown): value is TargetTuple {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["environment", "resource", "revision"]) &&
    nonEmpty(value.environment) &&
    nonEmpty(value.resource) &&
    nonEmpty(value.revision)
  );
}

function sameTarget(left: TargetTuple, right: TargetTuple): boolean {
  return (
    left.environment === right.environment &&
    left.resource === right.resource &&
    left.revision === right.revision
  );
}

function parseReceipt(value: unknown): ProofReceiptV1 | undefined {
  if (!isRecord(value) || value.schema !== PROOF_RECEIPT_SCHEMA) return undefined;
  if (
    !hasExactKeys(value, [
      "schema",
      "run_id",
      "skill",
      "executor",
      "started_at",
      "completed_at",
      "acceptance",
      "evidence",
      "verdict",
    ])
  ) {
    return undefined;
  }
  if (!nonEmpty(value.run_id) || !isRecord(value.skill) || !isRecord(value.executor)) {
    return undefined;
  }
  if (!hasExactKeys(value.skill, ["name", "digest"])) return undefined;
  if (!hasExactKeys(value.executor, ["id", "credential_scope"])) return undefined;
  if (!nonEmpty(value.skill.name) || !isDigest(value.skill.digest)) return undefined;
  if (!nonEmpty(value.executor.id) || !nonEmpty(value.executor.credential_scope)) return undefined;
  if (!isTimestamp(value.started_at) || !isTimestamp(value.completed_at)) return undefined;
  if (!Array.isArray(value.acceptance) || value.acceptance.length === 0) return undefined;
  if (!Array.isArray(value.evidence) || !isRecord(value.verdict)) return undefined;
  if (value.verdict.status !== "pass" && value.verdict.status !== "fail") return undefined;
  if (!hasExactKeys(value.verdict, ["status", "reason_codes"])) return undefined;
  if (!Array.isArray(value.verdict.reason_codes)) return undefined;
  if (!value.verdict.reason_codes.every((code) => PROOF_REASON_CODES.includes(code)))
    return undefined;
  if (new Set(value.verdict.reason_codes).size !== value.verdict.reason_codes.length)
    return undefined;

  for (const contract of value.acceptance) {
    if (!isRecord(contract)) return undefined;
    if (!hasExactKeys(contract, ["id", "statement", "target", "digest"])) return undefined;
    if (!nonEmpty(contract.id) || !nonEmpty(contract.statement) || !isTarget(contract.target)) {
      return undefined;
    }
    if (!isDigest(contract.digest)) return undefined;
  }

  const providerKinds = new Set(["external-probe", "ci", "browser", "human", "system"]);
  for (const evidence of value.evidence) {
    if (!isRecord(evidence) || !isRecord(evidence.provider)) return undefined;
    if (
      !hasExactKeys(evidence, [
        "id",
        "acceptance_id",
        "provider",
        "probe",
        "target",
        "observed_at",
        "outcome",
        "payload_digest",
      ]) ||
      !hasExactKeys(evidence.provider, ["id", "kind", "credential_scope"])
    ) {
      return undefined;
    }
    if (
      !nonEmpty(evidence.id) ||
      !nonEmpty(evidence.acceptance_id) ||
      !nonEmpty(evidence.provider.id) ||
      !providerKinds.has(String(evidence.provider.kind)) ||
      !nonEmpty(evidence.provider.credential_scope) ||
      !nonEmpty(evidence.probe) ||
      !isTarget(evidence.target) ||
      !isTimestamp(evidence.observed_at) ||
      (evidence.outcome !== "pass" && evidence.outcome !== "fail") ||
      !isDigest(evidence.payload_digest)
    ) {
      return undefined;
    }
  }

  return value as unknown as ProofReceiptV1;
}

function uniqueCodes(findings: ProofFinding[]): ProofReasonCode[] {
  return [...new Set(findings.map((finding) => finding.code))].sort();
}

export function verifyProofReceipt(
  value: unknown,
  skillContent?: string | Buffer,
): ProofVerification {
  const receipt = parseReceipt(value);
  if (!receipt) {
    return {
      valid: false,
      status: "fail",
      findings: [{ code: "SCHEMA_INVALID", message: "Receipt does not match proof-receipt/v1." }],
      warnings: [],
    };
  }

  const findings: ProofFinding[] = [];
  const warnings: ProofFinding[] = [];
  const started = Date.parse(receipt.started_at);
  const completed = Date.parse(receipt.completed_at);

  if (started > completed) {
    findings.push({ code: "SCHEMA_INVALID", message: "started_at is after completed_at." });
  }

  if (skillContent === undefined) {
    warnings.push({
      code: "SKILL_DIGEST_UNCHECKED",
      message: "Skill content was not supplied; the recorded skill digest could not be checked.",
    });
  } else if (digestText(skillContent) !== receipt.skill.digest) {
    findings.push({
      code: "SKILL_DIGEST_MISMATCH",
      message: "Skill content digest does not match.",
    });
  }

  const contracts = new Map<string, AcceptanceContract>();
  for (const contract of receipt.acceptance) {
    if (contracts.has(contract.id)) {
      findings.push({
        code: "SCHEMA_INVALID",
        message: `Duplicate acceptance id '${contract.id}'.`,
        acceptance_id: contract.id,
      });
      continue;
    }
    contracts.set(contract.id, contract);
    if (acceptanceDigest(contract) !== contract.digest) {
      findings.push({
        code: "ACCEPTANCE_DIGEST_MISMATCH",
        message: `Acceptance '${contract.id}' digest does not bind its statement and target.`,
        acceptance_id: contract.id,
      });
    }
  }

  const qualifyingEvidence = new Map<string, number>();
  for (const evidence of receipt.evidence) {
    const contract = contracts.get(evidence.acceptance_id);
    if (!contract) {
      findings.push({
        code: "SCHEMA_INVALID",
        message: `Evidence '${evidence.id}' references an unknown acceptance id.`,
        evidence_id: evidence.id,
      });
      continue;
    }

    let qualifies = true;
    if (!sameTarget(contract.target, evidence.target)) {
      qualifies = false;
      findings.push({
        code: "TARGET_MISMATCH",
        message: `Evidence '${evidence.id}' observed a different target tuple.`,
        acceptance_id: contract.id,
        evidence_id: evidence.id,
      });
    }
    if (evidence.provider.id === receipt.executor.id) {
      qualifies = false;
      findings.push({
        code: "CIRCULAR_EVIDENCE",
        message: `Evidence '${evidence.id}' was produced by the run executor.`,
        acceptance_id: contract.id,
        evidence_id: evidence.id,
      });
    }
    if (evidence.provider.credential_scope === receipt.executor.credential_scope) {
      qualifies = false;
      findings.push({
        code: "SHARED_CREDENTIAL_SCOPE",
        message: `Evidence '${evidence.id}' shares the executor's credential scope.`,
        acceptance_id: contract.id,
        evidence_id: evidence.id,
      });
    }
    if (evidence.outcome !== "pass") {
      qualifies = false;
      findings.push({
        code: "EVIDENCE_FAILED",
        message: `Evidence '${evidence.id}' reported '${evidence.outcome}'.`,
        acceptance_id: contract.id,
        evidence_id: evidence.id,
      });
    }
    const observed = Date.parse(evidence.observed_at);
    if (observed < started || observed > completed) {
      qualifies = false;
      findings.push({
        code: "EVIDENCE_OUTSIDE_RUN",
        message: `Evidence '${evidence.id}' falls outside the run interval.`,
        acceptance_id: contract.id,
        evidence_id: evidence.id,
      });
    }
    if (qualifies) {
      qualifyingEvidence.set(contract.id, (qualifyingEvidence.get(contract.id) ?? 0) + 1);
    }
  }

  for (const contract of receipt.acceptance) {
    if (!qualifyingEvidence.has(contract.id)) {
      findings.push({
        code: "MISSING_EVIDENCE",
        message: `Acceptance '${contract.id}' has no qualifying independent evidence.`,
        acceptance_id: contract.id,
      });
    }
  }

  const computedStatus = findings.length === 0 ? "pass" : "fail";
  const computedCodes = uniqueCodes(findings);
  const recordedCodes = [...receipt.verdict.reason_codes].sort();
  if (
    receipt.verdict.status !== computedStatus ||
    JSON.stringify(recordedCodes) !== JSON.stringify(computedCodes)
  ) {
    findings.push({
      code: "VERDICT_MISMATCH",
      message: "Recorded verdict does not match the independently computed verdict.",
    });
  }

  return {
    valid: findings.length === 0,
    status: findings.length === 0 ? "pass" : "fail",
    findings,
    warnings,
    receipt,
  };
}
