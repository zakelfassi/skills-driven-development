import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The plugin's hook scripts are plain node .mjs — exercised here end-to-end
// by spawning them with the same stdin JSON Claude Code pipes to hooks.
const SCRIPTS = join(__dirname, "..", "..", "plugins", "skdd-claude", "scripts");
const GATE = join(SCRIPTS, "finish-loop-gate.mjs");
const REMINDER = join(SCRIPTS, "freeze-reminder.mjs");
const SESSION_START = join(SCRIPTS, "session-start.mjs");

let tmp: string;
let sessionSeq = 0;

function newSessionId(): string {
  return `skdd-hook-test-${process.pid}-${Date.now()}-${sessionSeq++}`;
}

function runHook(
  script: string,
  input: Record<string, unknown>,
  args: string[] = [],
): { stdout: string; stderr: string; status: number } {
  const res = spawnSync(process.execPath, [script, ...args], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, SKDD_HOME: join(tmp, ".skdd-home") },
    timeout: 10_000,
  });
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", status: res.status ?? 1 };
}

function gitInit(dir: string) {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"],
    { cwd: dir },
  );
}

function enableToggles(dir: string, gates: string[]) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(
    join(dir, ".claude", "skdd.local.md"),
    `---\nskdd-hooks:\n${gates.map((g) => `  ${g}: true`).join("\n")}\n---\n`,
  );
}

function addUncommittedProductFile(dir: string) {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "app.ts"), "export const answer = 42;\n");
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skdd-hooks-"));
  gitInit(tmp);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const UNVERIFIED_REPORT =
  "I refactored the login flow. The fix should work now — let me know if anything else comes up.";
const EVIDENCE_REPORT =
  "I refactored the login flow and it should work — verified: I ran the app, submitted the form, and watched it succeed. Tests pass.";

describe("finish-loop-gate.mjs", () => {
  it("is inert when the toggle is off (default)", () => {
    addUncommittedProductFile(tmp);
    const res = runHook(GATE, {
      session_id: newSessionId(),
      cwd: tmp,
      last_assistant_message: UNVERIFIED_REPORT,
    });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("");
  });

  it("blocks a planted 'should work' report exactly once, then passes", () => {
    enableToggles(tmp, ["finish-the-loop"]);
    addUncommittedProductFile(tmp);
    const sessionId = newSessionId();
    const input = { session_id: sessionId, cwd: tmp, last_assistant_message: UNVERIFIED_REPORT };

    const first = runHook(GATE, input);
    expect(first.status).toBe(0);
    const decision = JSON.parse(first.stdout);
    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("finish-the-loop");
    expect(decision.reason).toContain("unverified");

    // Anti-loop: the second Stop in the same session always passes.
    const second = runHook(GATE, input);
    expect(second.stdout.trim()).toBe("");
  });

  it("passes an evidence-bearing report", () => {
    enableToggles(tmp, ["finish-the-loop"]);
    addUncommittedProductFile(tmp);
    const res = runHook(GATE, {
      session_id: newSessionId(),
      cwd: tmp,
      last_assistant_message: EVIDENCE_REPORT,
    });
    expect(res.stdout.trim()).toBe("");
  });

  it("never fires on docs-only diffs", () => {
    enableToggles(tmp, ["finish-the-loop"]);
    writeFileSync(join(tmp, "README.md"), "# docs only\n");
    const res = runHook(GATE, {
      session_id: newSessionId(),
      cwd: tmp,
      last_assistant_message: UNVERIFIED_REPORT,
    });
    expect(res.stdout.trim()).toBe("");
  });

  it("never fires on test-only diffs", () => {
    enableToggles(tmp, ["finish-the-loop"]);
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src", "app.test.ts"), "it('x', () => {});\n");
    const res = runHook(GATE, {
      session_id: newSessionId(),
      cwd: tmp,
      last_assistant_message: UNVERIFIED_REPORT,
    });
    expect(res.stdout.trim()).toBe("");
  });

  it("exits fast on the inactive path (< 2s)", () => {
    const start = Date.now();
    runHook(GATE, { session_id: newSessionId(), cwd: tmp, last_assistant_message: "done" });
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

function makeSubstantiveDiff(dir: string) {
  // freeze-reminder counts tracked changes (git diff HEAD) — commit, then modify.
  writeFileSync(join(dir, "big.ts"), "// start\n");
  execFileSync("git", ["add", "big.ts"], { cwd: dir });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "add big"],
    { cwd: dir },
  );
  writeFileSync(
    join(dir, "big.ts"),
    Array.from({ length: 30 }, (_, i) => `line(${i});`).join("\n"),
  );
}

describe("freeze-reminder.mjs", () => {
  it("is inert when the toggle is off (default)", () => {
    makeSubstantiveDiff(tmp);
    writeFileSync(join(tmp, ".skills-registry.md"), "# Skills Registry\n");
    const res = runHook(REMINDER, { session_id: newSessionId(), cwd: tmp }, ["PreCompact"]);
    expect(res.stdout.trim()).toBe("");
  });

  it("reminds on PreCompact when the registry predates a substantive session", () => {
    enableToggles(tmp, ["freeze-the-session"]);
    makeSubstantiveDiff(tmp);
    const registry = join(tmp, ".skills-registry.md");
    writeFileSync(registry, "# Skills Registry\n");
    const past = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(registry, past, past);

    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp }); // seed session start (now)
    const res = runHook(REMINDER, { session_id: sessionId, cwd: tmp }, ["PreCompact"]);
    const payload = JSON.parse(res.stdout);
    expect(payload.systemMessage).toContain("freeze-the-session");
    expect(payload.systemMessage).toContain("compacted");
  });

  it("stays silent when the registry was touched during the session", () => {
    enableToggles(tmp, ["freeze-the-session"]);
    makeSubstantiveDiff(tmp);
    const registry = join(tmp, ".skills-registry.md");
    writeFileSync(registry, "# Skills Registry\n");

    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp });
    const future = new Date(Date.now() + 60 * 60 * 1000);
    utimesSync(registry, future, future); // registry updated after session start

    const res = runHook(REMINDER, { session_id: sessionId, cwd: tmp }, ["SessionEnd"]);
    expect(res.stdout.trim()).toBe("");
  });

  it("stays silent on a trivial session", () => {
    enableToggles(tmp, ["freeze-the-session"]);
    const registry = join(tmp, ".skills-registry.md");
    writeFileSync(registry, "# Skills Registry\n");
    const past = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(registry, past, past);

    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp });
    const res = runHook(REMINDER, { session_id: sessionId, cwd: tmp }, ["SessionEnd"]);
    expect(res.stdout.trim()).toBe(""); // no diff at all → not substantive → silent
  });

  it("stays silent when there is no colony registry anywhere", () => {
    enableToggles(tmp, ["freeze-the-session"]);
    makeSubstantiveDiff(tmp);
    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp });
    const res = runHook(REMINDER, { session_id: sessionId, cwd: tmp }, ["PreCompact"]);
    expect(res.stdout.trim()).toBe("");
  });
});
