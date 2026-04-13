import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../src/commands/doctor.js";

const skipOnWindows = platform() === "win32";
const runUnix = skipOnWindows ? it.skip : it;

const HELLO_SKILL = `---
name: hello
description: Say hi to the user. Use when a greeting is required.
---

# Hello

## Steps

1. Say hi.
`;

const HELLO_REGISTRY = `# Skills Registry

> Auto-maintained.

## Available Skills

| Skill | Source | Last Used | Uses | Description |
|-------|--------|-----------|------|-------------|
| hello | local |  | 0 | Say hi. Use when a greeting is required. |
`;

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

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skdd-doctor-"));
  captureConsole();
});

afterEach(() => {
  restoreConsole();
  rmSync(tmp, { recursive: true, force: true });
});

describe("runDoctor", () => {
  it("reports an error when the canonical skills/ directory is missing", async () => {
    const code = await runDoctor({ cwd: tmp, json: true });
    restoreConsole();
    expect(code).toBe(1);
    const payload = JSON.parse(logs[0]!);
    const sections = payload.checks.map((c: { section: string }) => c.section);
    expect(sections).toContain("Colony");
    expect(sections).toContain("Skills");
    // At least one error (Skills dir missing)
    expect(payload.counts.error).toBeGreaterThan(0);
  });

  it("reports green on a healthy colony (canonical + registry + instructions)", async () => {
    mkdirSync(join(tmp, "skills/hello"), { recursive: true });
    writeFileSync(join(tmp, "skills/hello/SKILL.md"), HELLO_SKILL);
    writeFileSync(join(tmp, ".skills-registry.md"), HELLO_REGISTRY);
    writeFileSync(
      join(tmp, "CLAUDE.md"),
      "# Agent Instructions\n\n## Skills\n\nSkills live at skills/. Registry at .skills-registry.md.\n",
    );
    const code = await runDoctor({ cwd: tmp, json: true });
    restoreConsole();
    expect(code).toBe(0);
    const payload = JSON.parse(logs[0]!);
    expect(payload.counts.error).toBe(0);
    // Skills section should be ok
    const skills = payload.checks.find((c: { section: string }) => c.section === "Skills");
    expect(skills.status).toBe("ok");
    // Registry section should be ok
    const registry = payload.checks.find((c: { section: string }) => c.section === "Registry");
    expect(registry.status).toBe("ok");
    // Validation should be ok
    const validation = payload.checks.find((c: { section: string }) => c.section === "Validation");
    expect(validation.status).toBe("ok");
  });

  it("flags a skill on disk that is missing from the registry", async () => {
    mkdirSync(join(tmp, "skills/hello"), { recursive: true });
    writeFileSync(join(tmp, "skills/hello/SKILL.md"), HELLO_SKILL);
    writeFileSync(
      join(tmp, ".skills-registry.md"),
      "# Skills Registry\n\n## Available Skills\n\n| Skill | Source | Last Used | Uses | Description |\n|-------|--------|-----------|------|-------------|\n",
    );
    const code = await runDoctor({ cwd: tmp, json: true });
    restoreConsole();
    expect(code).toBe(0); // warning, not error
    const payload = JSON.parse(logs[0]!);
    const registryCheck = payload.checks.find(
      (c: { section: string; message: string }) =>
        c.section === "Registry" && c.message.includes("missing from registry"),
    );
    expect(registryCheck).toBeDefined();
    expect(registryCheck.status).toBe("warn");
    expect(registryCheck.message).toContain("hello");
  });

  runUnix("reports healthy mirror when symlink points at canonical", async () => {
    mkdirSync(join(tmp, "skills/hello"), { recursive: true });
    writeFileSync(join(tmp, "skills/hello/SKILL.md"), HELLO_SKILL);
    writeFileSync(join(tmp, ".skills-registry.md"), HELLO_REGISTRY);
    mkdirSync(join(tmp, ".claude"));
    symlinkSync("../skills", join(tmp, ".claude/skills"), "dir");
    writeFileSync(
      join(tmp, ".skdd-sync.json"),
      JSON.stringify(
        {
          version: 1,
          canonical: "skills",
          mirrors: [
            { target: ".claude/skills", mode: "symlink", createdAt: "2026-04-13T00:00:00Z" },
          ],
        },
        null,
        2,
      ) + "\n",
    );
    const code = await runDoctor({ cwd: tmp, json: true });
    restoreConsole();
    expect(code).toBe(0);
    const payload = JSON.parse(logs[0]!);
    const mirrors = payload.checks.find((c: { section: string }) => c.section === "Mirrors");
    expect(mirrors.status).toBe("ok");
  });

  runUnix("detects symlink drift and reports an error", async () => {
    mkdirSync(join(tmp, "skills/hello"), { recursive: true });
    writeFileSync(join(tmp, "skills/hello/SKILL.md"), HELLO_SKILL);
    writeFileSync(join(tmp, ".skills-registry.md"), HELLO_REGISTRY);
    mkdirSync(join(tmp, ".claude"));
    mkdirSync(join(tmp, "bogus"));
    // Create a symlink that points somewhere wrong
    symlinkSync("../bogus", join(tmp, ".claude/skills"), "dir");
    writeFileSync(
      join(tmp, ".skdd-sync.json"),
      JSON.stringify(
        {
          version: 1,
          canonical: "skills",
          mirrors: [
            { target: ".claude/skills", mode: "symlink", createdAt: "2026-04-13T00:00:00Z" },
          ],
        },
        null,
        2,
      ) + "\n",
    );
    const code = await runDoctor({ cwd: tmp, json: true });
    restoreConsole();
    expect(code).toBe(1);
    const payload = JSON.parse(logs[0]!);
    const mirrorError = payload.checks.find(
      (c: { section: string; status: string }) =>
        c.section === "Mirrors" && c.status === "error",
    );
    expect(mirrorError).toBeDefined();
    expect(mirrorError.message).toContain("symlink points at");
  });

  runUnix("detects a missing mirror and reports an error", async () => {
    mkdirSync(join(tmp, "skills/hello"), { recursive: true });
    writeFileSync(join(tmp, "skills/hello/SKILL.md"), HELLO_SKILL);
    writeFileSync(join(tmp, ".skills-registry.md"), HELLO_REGISTRY);
    writeFileSync(
      join(tmp, ".skdd-sync.json"),
      JSON.stringify(
        {
          version: 1,
          canonical: "skills",
          mirrors: [
            { target: ".claude/skills", mode: "symlink", createdAt: "2026-04-13T00:00:00Z" },
          ],
        },
        null,
        2,
      ) + "\n",
    );
    const code = await runDoctor({ cwd: tmp, json: true });
    restoreConsole();
    expect(code).toBe(1);
    const payload = JSON.parse(logs[0]!);
    const mirrorError = payload.checks.find(
      (c: { section: string; status: string }) =>
        c.section === "Mirrors" && c.status === "error",
    );
    expect(mirrorError).toBeDefined();
    expect(mirrorError.message).toMatch(/does not exist/);
  });

  it("flags instruction files without a Skills block", async () => {
    mkdirSync(join(tmp, "skills/hello"), { recursive: true });
    writeFileSync(join(tmp, "skills/hello/SKILL.md"), HELLO_SKILL);
    writeFileSync(join(tmp, ".skills-registry.md"), HELLO_REGISTRY);
    writeFileSync(join(tmp, "CLAUDE.md"), "# Agent Instructions\n\nNo skills block here.\n");
    const code = await runDoctor({ cwd: tmp, json: true });
    restoreConsole();
    expect(code).toBe(0); // warning, not error
    const payload = JSON.parse(logs[0]!);
    const instructions = payload.checks.find(
      (c: { section: string; message: string }) =>
        c.section === "Instructions" && c.message.includes("lack a Skills block"),
    );
    expect(instructions).toBeDefined();
    expect(instructions.status).toBe("warn");
  });

  it("errors when .colony.json exists but is malformed", async () => {
    writeFileSync(join(tmp, ".colony.json"), "{not valid json");
    // Also create a canonical skills/ so the Skills check passes (we want to isolate the Colony error)
    mkdirSync(join(tmp, "skills"), { recursive: true });
    const code = await runDoctor({ cwd: tmp, json: true });
    restoreConsole();
    expect(code).toBe(1);
    const payload = JSON.parse(logs[0]!);
    const colonyErr = payload.checks.find(
      (c: { section: string; status: string }) =>
        c.section === "Colony" && c.status === "error",
    );
    expect(colonyErr).toBeDefined();
  });

});
