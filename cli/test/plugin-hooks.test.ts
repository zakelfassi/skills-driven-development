import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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
    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp }); // clean baseline
    addUncommittedProductFile(tmp); // product change introduced this session
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
    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp });
    addUncommittedProductFile(tmp); // real product change, but the report has evidence
    const res = runHook(GATE, {
      session_id: sessionId,
      cwd: tmp,
      last_assistant_message: EVIDENCE_REPORT,
    });
    expect(res.stdout.trim()).toBe("");
  });

  it("never fires on docs-only diffs", () => {
    enableToggles(tmp, ["finish-the-loop"]);
    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp });
    writeFileSync(join(tmp, "README.md"), "# docs only\n");
    const res = runHook(GATE, {
      session_id: sessionId,
      cwd: tmp,
      last_assistant_message: UNVERIFIED_REPORT,
    });
    expect(res.stdout.trim()).toBe("");
  });

  it("never fires on test-only diffs", () => {
    enableToggles(tmp, ["finish-the-loop"]);
    mkdirSync(join(tmp, "src"), { recursive: true });
    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp });
    writeFileSync(join(tmp, "src", "app.test.ts"), "it('x', () => {});\n");
    const res = runHook(GATE, {
      session_id: sessionId,
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

  it("never fires on suffix-style test filenames (foo_test.go)", () => {
    enableToggles(tmp, ["finish-the-loop"]);
    mkdirSync(join(tmp, "src"), { recursive: true });
    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp });
    writeFileSync(join(tmp, "src", "handler_test.go"), "package x\n");
    const res = runHook(GATE, {
      session_id: sessionId,
      cwd: tmp,
      last_assistant_message: UNVERIFIED_REPORT,
    });
    expect(res.stdout.trim()).toBe("");
  });

  it("does not block for a product file that was already dirty before the session", () => {
    enableToggles(tmp, ["finish-the-loop"]);
    addUncommittedProductFile(tmp); // src/app.ts dirty BEFORE the session starts
    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp }); // baseline includes src/app.ts
    // Session only touches docs; the pre-existing product change must not trigger.
    writeFileSync(join(tmp, "README.md"), "# docs\n");
    const res = runHook(GATE, {
      session_id: sessionId,
      cwd: tmp,
      last_assistant_message: UNVERIFIED_REPORT,
    });
    expect(res.stdout.trim()).toBe("");
  });

  it("blocks when the session edits a file that was already dirty at start", () => {
    enableToggles(tmp, ["finish-the-loop"]);
    addUncommittedProductFile(tmp); // src/app.ts dirty BEFORE the session
    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp }); // baseline hashes src/app.ts
    // The session edits that same pre-dirty file further.
    writeFileSync(join(tmp, "src", "app.ts"), "export const answer = 43; // edited this session\n");
    const res = runHook(GATE, {
      session_id: sessionId,
      cwd: tmp,
      last_assistant_message: UNVERIFIED_REPORT,
    });
    expect(JSON.parse(res.stdout).decision).toBe("block");
  });

  it("detects a pre-dirty edit even when the hooks run from different subdirs", () => {
    enableToggles(tmp, ["finish-the-loop"]);
    const sub = join(tmp, "packages", "app");
    mkdirSync(join(sub, "src"), { recursive: true });
    writeFileSync(join(sub, "src", "app.ts"), "export const answer = 42;\n"); // dirty before session
    const sessionId = newSessionId();
    // SessionStart from the repo ROOT; the edit + Stop happen from the SUBDIR.
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp });
    writeFileSync(join(sub, "src", "app.ts"), "export const answer = 43; // edited\n");
    const res = runHook(GATE, {
      session_id: sessionId,
      cwd: sub,
      last_assistant_message: UNVERIFIED_REPORT,
    });
    expect(JSON.parse(res.stdout).decision).toBe("block");
  });

  it("passes (does not block) when the anti-loop flag cannot be persisted", () => {
    enableToggles(tmp, ["finish-the-loop"]);
    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp }); // writes a valid baseline
    addUncommittedProductFile(tmp); // session product change
    const stateFile = join(
      tmpdir(),
      `skdd-hooks-${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`,
    );
    chmodSync(stateFile, 0o444); // readable (baseline loads) but not writable
    try {
      const res = runHook(GATE, {
        session_id: sessionId,
        cwd: tmp,
        last_assistant_message: UNVERIFIED_REPORT,
      });
      // Save of the anti-loop flag fails → pass rather than block-every-Stop.
      expect(res.stdout.trim()).toBe("");
    } finally {
      chmodSync(stateFile, 0o644);
    }
  });

  it("honors a repo-root toggle when run from a subdirectory", () => {
    enableToggles(tmp, ["finish-the-loop"]); // toggle at repo root
    const sub = join(tmp, "packages", "app");
    mkdirSync(join(sub, "src"), { recursive: true });
    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: sub }); // clean baseline
    writeFileSync(join(sub, "src", "app.ts"), "export const x = 1;\n"); // session change
    const res = runHook(GATE, {
      session_id: sessionId,
      cwd: sub,
      last_assistant_message: UNVERIFIED_REPORT,
    });
    // The upward search from the subdir finds the repo-root toggle.
    expect(JSON.parse(res.stdout).decision).toBe("block");
  });

  it("fails open (passes) when SessionStart never seeded a baseline", () => {
    enableToggles(tmp, ["finish-the-loop"]);
    addUncommittedProductFile(tmp); // dirty, but no SessionStart ran
    const res = runHook(GATE, {
      session_id: newSessionId(),
      cwd: tmp,
      last_assistant_message: UNVERIFIED_REPORT,
    });
    expect(res.stdout.trim()).toBe(""); // no baseline → can't attribute → pass
  });

  it("blocks when the session committed its product change before reporting", () => {
    enableToggles(tmp, ["finish-the-loop"]);
    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp }); // baseline rev captured
    addUncommittedProductFile(tmp);
    execFileSync("git", ["add", "-A"], { cwd: tmp });
    execFileSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "feat"],
      { cwd: tmp },
    );
    // Worktree is now clean, but the session changed product source via a commit.
    const res = runHook(GATE, {
      session_id: sessionId,
      cwd: tmp,
      last_assistant_message: UNVERIFIED_REPORT,
    });
    expect(JSON.parse(res.stdout).decision).toBe("block");
  });
});

function addUntrackedFiles(dir: string, n: number) {
  // New files created DURING the session (after SessionStart) — the freeze
  // heuristic must count these even though `git diff HEAD` alone wouldn't.
  for (let i = 0; i < n; i++)
    writeFileSync(join(dir, `new-${i}.ts`), `export const v${i} = ${i};\n`);
}

function commitSomething(dir: string) {
  writeFileSync(join(dir, "committed.ts"), "export const x = 1;\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "work"], {
    cwd: dir,
  });
}

function oldRegistry(dir: string, name = ".skills-registry.md") {
  const registry = join(dir, name);
  writeFileSync(registry, "# Skills Registry\n");
  const past = new Date(Date.now() - 60 * 60 * 1000);
  utimesSync(registry, past, past);
  return registry;
}

describe("freeze-reminder.mjs", () => {
  it("is inert when the toggle is off (default)", () => {
    oldRegistry(tmp);
    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp });
    addUntrackedFiles(tmp, 4);
    const res = runHook(REMINDER, { session_id: sessionId, cwd: tmp }, ["PreCompact"]);
    expect(res.stdout.trim()).toBe("");
  });

  it("reminds on PreCompact when a session added untracked files and the registry is stale", () => {
    enableToggles(tmp, ["freeze-the-session"]);
    oldRegistry(tmp);
    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp }); // baseline: clean
    addUntrackedFiles(tmp, 4); // new files created during the session
    const res = runHook(REMINDER, { session_id: sessionId, cwd: tmp }, ["PreCompact"]);
    const payload = JSON.parse(res.stdout);
    expect(payload.systemMessage).toContain("freeze-the-session");
    expect(payload.systemMessage).toContain("compacted");
  });

  it("counts commits made during the session as substantive", () => {
    enableToggles(tmp, ["freeze-the-session"]);
    oldRegistry(tmp);
    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp }); // baseline rev captured
    commitSomething(tmp); // session commits → tree ends clean
    const res = runHook(REMINDER, { session_id: sessionId, cwd: tmp }, ["SessionEnd"]);
    expect(JSON.parse(res.stdout).systemMessage).toContain("freeze-the-session");
  });

  it("recognizes a JSON-only registry", () => {
    enableToggles(tmp, ["freeze-the-session"]);
    oldRegistry(tmp, ".skills-registry.json");
    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp });
    addUntrackedFiles(tmp, 4);
    const res = runHook(REMINDER, { session_id: sessionId, cwd: tmp }, ["SessionEnd"]);
    expect(JSON.parse(res.stdout).systemMessage).toContain("freeze-the-session");
  });

  it("treats a large single-file change as substantive", () => {
    enableToggles(tmp, ["freeze-the-session"]);
    oldRegistry(tmp);
    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp });
    // One new file, but with many lines (a forged/rewritten SKILL.md).
    writeFileSync(
      join(tmp, "big-skill.md"),
      Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"),
    );
    const res = runHook(REMINDER, { session_id: sessionId, cwd: tmp }, ["SessionEnd"]);
    expect(JSON.parse(res.stdout).systemMessage).toContain("freeze-the-session");
  });

  it("finds a repo-root registry when the session runs from a subdirectory", () => {
    enableToggles(tmp, ["freeze-the-session"]); // toggle + registry at repo root
    oldRegistry(tmp);
    const sub = join(tmp, "packages", "app");
    mkdirSync(sub, { recursive: true });
    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: sub });
    for (let i = 0; i < 4; i++) writeFileSync(join(sub, `n${i}.ts`), `export const v${i}=${i};\n`);
    const res = runHook(REMINDER, { session_id: sessionId, cwd: sub }, ["PreCompact"]);
    expect(JSON.parse(res.stdout).systemMessage).toContain("freeze-the-session");
  });

  it("stays silent when the registry was touched during the session", () => {
    enableToggles(tmp, ["freeze-the-session"]);
    const registry = join(tmp, ".skills-registry.md");
    writeFileSync(registry, "# Skills Registry\n");
    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp });
    addUntrackedFiles(tmp, 4);
    const future = new Date(Date.now() + 60 * 60 * 1000);
    utimesSync(registry, future, future); // registry updated after session start
    const res = runHook(REMINDER, { session_id: sessionId, cwd: tmp }, ["SessionEnd"]);
    expect(res.stdout.trim()).toBe("");
  });

  it("stays silent on a trivial session (no changes since start)", () => {
    enableToggles(tmp, ["freeze-the-session"]);
    oldRegistry(tmp);
    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp });
    const res = runHook(REMINDER, { session_id: sessionId, cwd: tmp }, ["SessionEnd"]);
    expect(res.stdout.trim()).toBe("");
  });

  it("stays silent (does not invent a start time) when SessionStart never seeded state", () => {
    enableToggles(tmp, ["freeze-the-session"]);
    oldRegistry(tmp);
    addUntrackedFiles(tmp, 4);
    // No SESSION_START run → no seed → must stay silent rather than fabricate now.
    const res = runHook(REMINDER, { session_id: newSessionId(), cwd: tmp }, ["PreCompact"]);
    expect(res.stdout.trim()).toBe("");
  });

  it("stays silent when there is no colony registry anywhere", () => {
    enableToggles(tmp, ["freeze-the-session"]);
    const sessionId = newSessionId();
    runHook(SESSION_START, { session_id: sessionId, cwd: tmp });
    addUntrackedFiles(tmp, 4);
    const res = runHook(REMINDER, { session_id: sessionId, cwd: tmp }, ["PreCompact"]);
    expect(res.stdout.trim()).toBe("");
  });
});
