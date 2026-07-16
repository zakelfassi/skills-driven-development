import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  acceptanceDigest,
  digestText,
  PROOF_RECEIPT_SCHEMA,
  type ProofReceiptV1,
  verifyProofReceipt,
} from "../src/lib/proof.js";

const skill =
  "---\nname: finish-the-loop\ndescription: Verify the real outcome.\n---\n\n# Finish\n";

function receipt(): ProofReceiptV1 {
  const contract = {
    id: "user-visible-behavior",
    statement: "Submitting the form displays the saved record in production.",
    target: {
      environment: "production",
      resource: "app.example.test/forms",
      revision: "git:abc123",
    },
    digest: "",
  };
  contract.digest = acceptanceDigest(contract);
  return {
    schema: PROOF_RECEIPT_SCHEMA,
    run_id: "run-001",
    skill: { name: "finish-the-loop", digest: digestText(skill) },
    executor: { id: "agent:noth", credential_scope: "deploy:writer" },
    started_at: "2026-07-16T03:00:00.000Z",
    completed_at: "2026-07-16T03:10:00.000Z",
    acceptance: [contract],
    evidence: [
      {
        id: "browser-001",
        acceptance_id: contract.id,
        provider: {
          id: "probe:browser-readonly",
          kind: "browser",
          credential_scope: "production:reader",
        },
        probe: "submit form and observe saved record",
        target: { ...contract.target },
        observed_at: "2026-07-16T03:09:00.000Z",
        outcome: "pass",
        payload_digest: digestText("screenshot:sha256:example"),
      },
    ],
    verdict: { status: "pass", reason_codes: [] },
  };
}

function alignRecordedVerdict(value: ProofReceiptV1) {
  value.verdict = { status: "fail", reason_codes: [] };
  const first = verifyProofReceipt(value, skill);
  value.verdict = {
    status: first.findings.filter((finding) => finding.code !== "VERDICT_MISMATCH").length
      ? "fail"
      : "pass",
    reason_codes: [
      ...new Set(
        first.findings.map((finding) => finding.code).filter((code) => code !== "VERDICT_MISMATCH"),
      ),
    ].sort(),
  };
}

describe("proof receipt verifier", () => {
  it("accepts target-bound evidence from an independent credential scope", () => {
    const result = verifyProofReceipt(receipt(), skill);
    expect(result.valid).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("refuses evidence collected against the wrong environment", () => {
    const value = receipt();
    value.evidence[0].target.environment = "local-sqlite";
    alignRecordedVerdict(value);
    const result = verifyProofReceipt(value, skill);
    expect(result.valid).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "TARGET_MISMATCH",
      "MISSING_EVIDENCE",
    ]);
  });

  it("refuses evidence produced by the executor or its credential scope", () => {
    const value = receipt();
    value.evidence[0].provider.id = value.executor.id;
    value.evidence[0].provider.credential_scope = value.executor.credential_scope;
    alignRecordedVerdict(value);
    const result = verifyProofReceipt(value, skill);
    expect(result.valid).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "CIRCULAR_EVIDENCE",
      "SHARED_CREDENTIAL_SCOPE",
      "MISSING_EVIDENCE",
    ]);
  });

  it("refuses build-green evidence when user-visible behavior failed", () => {
    const value = receipt();
    value.evidence[0].outcome = "fail";
    alignRecordedVerdict(value);
    const result = verifyProofReceipt(value, skill);
    expect(result.valid).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "EVIDENCE_FAILED",
      "MISSING_EVIDENCE",
    ]);
  });

  it("binds a receipt to exact skill bytes when supplied", () => {
    const result = verifyProofReceipt(receipt(), `${skill}\nchanged`);
    expect(result.valid).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toContain("SKILL_DIGEST_MISMATCH");
  });

  it("rejects fields outside the published schema", () => {
    const value = { ...receipt(), invented: true };
    const result = verifyProofReceipt(value, skill);
    expect(result.valid).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toEqual(["SCHEMA_INVALID"]);
  });

  it.each([
    ["valid-production.json", true, []],
    ["d1-wrong-environment.json", false, ["TARGET_MISMATCH", "MISSING_EVIDENCE"]],
    [
      "sentry-circular-evidence.json",
      false,
      ["CIRCULAR_EVIDENCE", "SHARED_CREDENTIAL_SCOPE", "MISSING_EVIDENCE"],
    ],
    ["calendar-user-broken.json", false, ["EVIDENCE_FAILED", "MISSING_EVIDENCE"]],
  ])("replays %s deterministically", (filename, valid, codes) => {
    const fixture = fileURLToPath(
      new URL(`../../examples/proof-carrying-skill/receipts/${filename}`, import.meta.url),
    );
    const value = JSON.parse(readFileSync(fixture, "utf8"));
    const result = verifyProofReceipt(value);
    expect(result.valid).toBe(valid);
    expect(result.findings.map((finding) => finding.code)).toEqual(codes);
  });
});
