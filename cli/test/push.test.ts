import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPush, stripMachineLocalMetadata, summarizeDiff } from "../src/commands/push.js";

const FIXTURES = join(__dirname, "fixtures");
const MINI_COMMONS = join(FIXTURES, "mini-commons");

let tmp: string;
let logs: string[] = [];
let origLog: typeof console.log;
let origWarn: typeof console.warn;
let origError: typeof console.error;

function captureConsole() {
  logs = [];
  origLog = console.log;
  origWarn = console.warn;
  origError = console.error;
  const push = (...args: unknown[]) => {
    logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  console.log = push as typeof console.log;
  console.warn = push as typeof console.warn;
  console.error = push as typeof console.error;
}

function restoreConsole() {
  console.log = origLog;
  console.warn = origWarn;
  console.error = origError;
}

function writeColonySkill(name: string, extra: { pack?: string; body?: string } = {}) {
  const dir = join(tmp, "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---
name: ${name}
description: Locally evolved ${name}. Use when pushing upstream.
metadata:
${extra.pack ? `  pack: ${extra.pack}\n` : ""}  forged-by: test-agent
  forged-from: local-session
  forged-reason: "forged locally to test skdd push"
  usage-count: "7"
  last-used: "2026-06-30"
---

# ${name}

## Steps

1. Original step.
${extra.body ?? ""}`,
  );
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skdd-push-test-"));
  captureConsole();
});

afterEach(() => {
  restoreConsole();
  rmSync(tmp, { recursive: true, force: true });
});

describe("stripMachineLocalMetadata", () => {
  it("resets usage-count, drops last-used, keeps forged-* provenance", () => {
    const raw = `---
name: x
metadata:
  forged-by: claude-fable-5
  forged-reason: "why"
  usage-count: "42"
  last-used: "2026-06-30"
---
body`;
    const stripped = stripMachineLocalMetadata(raw);
    expect(stripped).toContain(`usage-count: "0"`);
    expect(stripped).not.toContain("last-used");
    expect(stripped).toContain("forged-by: claude-fable-5");
    expect(stripped).toContain(`forged-reason: "why"`);
  });
});

describe("summarizeDiff", () => {
  it("counts added and removed lines", () => {
    const before = "a\nb\nc";
    const after = "a\nb\nd\ne";
    expect(summarizeDiff(before, after)).toBe("~2 line(s) added, ~1 removed");
  });
});

describe("runPush --dry-run against a local commons", () => {
  it("classifies an upstream-known skill as an evolution with a diff summary", async () => {
    writeColonySkill("alpha-skill", { body: "2. A new edge case learned in the wild.\n" });
    const code = await runPush("alpha-skill", { cwd: tmp, to: MINI_COMMONS, dryRun: true });
    restoreConsole();
    expect(code).toBe(0);
    const out = logs.join("\n");
    expect(out).toContain("evolve: alpha-skill → packs/2026-01-test/alpha-skill/SKILL.md");
    expect(out).toContain("branch:      evolve/alpha-skill");
    expect(out).toMatch(/Diff summary.*line\(s\) added/);
    expect(out).toContain("The edge case");
  });

  it("classifies an unknown skill as new, headed for incoming/", async () => {
    writeColonySkill("gamma-skill");
    const code = await runPush("gamma-skill", { cwd: tmp, to: MINI_COMMONS, dryRun: true });
    restoreConsole();
    expect(code).toBe(0);
    const out = logs.join("\n");
    expect(out).toContain("new: gamma-skill → incoming/gamma-skill/SKILL.md");
    expect(out).toContain("branch:      skill/gamma-skill");
    expect(out).toContain("Why this skill");
    expect(out).toContain("forged locally to test skdd push");
    expect(out).toContain("maintainer triage");
  });

  it("targets an existing drop with --drop", async () => {
    writeColonySkill("gamma-skill");
    const code = await runPush("gamma-skill", {
      cwd: tmp,
      to: MINI_COMMONS,
      dryRun: true,
      drop: "2026-01-test",
    });
    restoreConsole();
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("new: gamma-skill → packs/2026-01-test/gamma-skill/SKILL.md");
  });

  it("rejects --drop pointing at a drop that does not exist upstream", async () => {
    writeColonySkill("gamma-skill");
    const code = await runPush("gamma-skill", {
      cwd: tmp,
      to: MINI_COMMONS,
      dryRun: true,
      drop: "2099-12-nope",
    });
    restoreConsole();
    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("Creating drops is a maintainer act");
  });

  it("pushes every local skill sharing a pack id", async () => {
    writeColonySkill("gamma-skill", { pack: "my-pack" });
    writeColonySkill("delta-skill", { pack: "my-pack" });
    const code = await runPush("my-pack", { cwd: tmp, to: MINI_COMMONS, dryRun: true });
    restoreConsole();
    expect(code).toBe(0);
    const out = logs.join("\n");
    expect(out).toContain("branch:      pack/my-pack");
    expect(out).toContain("gamma-skill");
    expect(out).toContain("delta-skill");
  });

  it("errors when the target is neither a skill nor a pack id", async () => {
    const code = await runPush("no-such-thing", { cwd: tmp, to: MINI_COMMONS, dryRun: true });
    restoreConsole();
    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("neither a skill");
  });

  it("refuses a real (non-dry-run) push to a local path target", async () => {
    writeColonySkill("gamma-skill");
    const code = await runPush("gamma-skill", { cwd: tmp, to: MINI_COMMONS });
    restoreConsole();
    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("--dry-run only");
  });
});
