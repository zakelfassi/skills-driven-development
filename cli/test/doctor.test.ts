import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDoctor } from "../src/commands/doctor.js";
import { SKDD_HOME_ENV } from "../src/lib/global.js";

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
      (c: { section: string; status: string }) => c.section === "Mirrors" && c.status === "error",
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
      (c: { section: string; status: string }) => c.section === "Mirrors" && c.status === "error",
    );
    expect(mirrorError).toBeDefined();
    expect(mirrorError.message).toMatch(/does not exist/);
  });

  it("copy-mode project mirror in sync reports OK", async () => {
    mkdirSync(join(tmp, "skills/hello"), { recursive: true });
    writeFileSync(join(tmp, "skills/hello/SKILL.md"), HELLO_SKILL);
    writeFileSync(join(tmp, ".skills-registry.md"), HELLO_REGISTRY);
    // Create a copy mirror that matches canonical exactly
    mkdirSync(join(tmp, ".claude/skills/hello"), { recursive: true });
    writeFileSync(join(tmp, ".claude/skills/hello/SKILL.md"), HELLO_SKILL);
    writeFileSync(
      join(tmp, ".skdd-sync.json"),
      JSON.stringify(
        {
          version: 1,
          canonical: "skills",
          mirrors: [{ target: ".claude/skills", mode: "copy", createdAt: "2026-06-13T00:00:00Z" }],
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

  it("stale copy-mode project mirror reports error", async () => {
    mkdirSync(join(tmp, "skills/hello"), { recursive: true });
    writeFileSync(join(tmp, "skills/hello/SKILL.md"), HELLO_SKILL);
    writeFileSync(join(tmp, ".skills-registry.md"), HELLO_REGISTRY);
    // Create a copy mirror that is out of date (empty)
    mkdirSync(join(tmp, ".claude/skills"), { recursive: true });
    writeFileSync(
      join(tmp, ".skdd-sync.json"),
      JSON.stringify(
        {
          version: 1,
          canonical: "skills",
          mirrors: [{ target: ".claude/skills", mode: "copy", createdAt: "2026-06-13T00:00:00Z" }],
        },
        null,
        2,
      ) + "\n",
    );
    const code = await runDoctor({ cwd: tmp, json: true });
    restoreConsole();
    expect(code).toBe(1);
    const payload = JSON.parse(logs[0]!);
    const mirrorErr = payload.checks.find(
      (c: { section: string; status: string }) => c.section === "Mirrors" && c.status === "error",
    );
    expect(mirrorErr).toBeDefined();
    expect(mirrorErr.message).toMatch(/stale/i);
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
      (c: { section: string; status: string }) => c.section === "Colony" && c.status === "error",
    );
    expect(colonyErr).toBeDefined();
  });
});

describe("runDoctor --global mirrors", () => {
  let skddTmp: string;
  let fakeTmp: string;
  let prevSkddHome: string | undefined;
  let prevHome: string | undefined;
  let globalLogs: string[] = [];
  let globalOrigLog: typeof console.log;
  let globalOrigWarn: typeof console.warn;
  let globalOrigError: typeof console.error;

  function captureGlobal() {
    globalLogs = [];
    globalOrigLog = console.log;
    globalOrigWarn = console.warn;
    globalOrigError = console.error;
    const push = (...args: unknown[]) => {
      globalLogs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
    console.log = push as typeof console.log;
    console.warn = push as typeof console.warn;
    console.error = push as typeof console.error;
  }

  function restoreGlobal() {
    console.log = globalOrigLog;
    console.warn = globalOrigWarn;
    console.error = globalOrigError;
  }

  beforeEach(() => {
    skddTmp = mkdtempSync(join(tmpdir(), "skdd-dr-global-home-"));
    fakeTmp = mkdtempSync(join(tmpdir(), "skdd-dr-fake-home-"));
    prevSkddHome = process.env[SKDD_HOME_ENV];
    prevHome = process.env.HOME;
    process.env[SKDD_HOME_ENV] = skddTmp;
    process.env.HOME = fakeTmp;
    // Seed a minimal global colony so Colony/Skills/Registry checks pass
    mkdirSync(join(skddTmp, "skills", "hello"), { recursive: true });
    writeFileSync(join(skddTmp, "skills", "hello", "SKILL.md"), HELLO_SKILL);
    writeFileSync(join(skddTmp, ".skills-registry.md"), HELLO_REGISTRY);
    captureGlobal();
  });

  afterEach(() => {
    restoreGlobal();
    if (prevSkddHome === undefined) {
      delete process.env[SKDD_HOME_ENV];
    } else {
      process.env[SKDD_HOME_ENV] = prevSkddHome;
    }
    if (prevHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = prevHome;
    }
    rmSync(skddTmp, { recursive: true, force: true });
    rmSync(fakeTmp, { recursive: true, force: true });
  });

  it("warns when a harness global parent dir exists but the mirror is not linked", async () => {
    // Create harness parent dir (~fakehome/.factory) but no symlink or sync state
    mkdirSync(join(fakeTmp, ".factory"), { recursive: true });
    const code = await runDoctor({ global: true, json: true });
    restoreGlobal();
    // Warning, not error
    expect(code).toBe(0);
    const payload = JSON.parse(globalLogs[0]!);
    const mirrors = payload.checks.find((c: { section: string }) => c.section === "Mirrors");
    expect(mirrors).toBeDefined();
    expect(mirrors.status).toBe("warn");
    expect(mirrors.message).toContain("droid");
    expect(mirrors.hint).toMatch(/skdd link -g/);
  });

  runUnix("reports OK when global harness mirror is properly linked", async () => {
    // Create harness parent dir and symlink using a RELATIVE target (matching ensureMirror behavior)
    mkdirSync(join(fakeTmp, ".factory"), { recursive: true });
    const globalSkills = join(fakeTmp, ".factory", "skills");
    const parentDir = join(fakeTmp, ".factory");
    const canonicalSkills = join(skddTmp, "skills");
    const relTarget = relative(parentDir, canonicalSkills);
    symlinkSync(relTarget, globalSkills, "dir");
    // Write sync state in skddTmp with absolute mirror path
    writeFileSync(
      join(skddTmp, ".skdd-sync.json"),
      JSON.stringify(
        {
          version: 2,
          canonical: "skills",
          mirrors: [{ target: globalSkills, mode: "symlink", createdAt: "2026-06-13T00:00:00Z" }],
        },
        null,
        2,
      ) + "\n",
    );
    const code = await runDoctor({ global: true, json: true });
    restoreGlobal();
    expect(code).toBe(0);
    const payload = JSON.parse(globalLogs[0]!);
    const mirrors = payload.checks.find((c: { section: string }) => c.section === "Mirrors");
    expect(mirrors).toBeDefined();
    expect(mirrors.status).toBe("ok");
  });

  it("copy-mode global mirror whose contents match canonical reports OK", async () => {
    mkdirSync(join(fakeTmp, ".factory"), { recursive: true });
    const globalSkills = join(fakeTmp, ".factory", "skills");
    // Mirror is a directory copy that matches canonical exactly
    mkdirSync(join(globalSkills, "hello"), { recursive: true });
    writeFileSync(join(globalSkills, "hello", "SKILL.md"), HELLO_SKILL);
    writeFileSync(
      join(skddTmp, ".skdd-sync.json"),
      JSON.stringify(
        {
          version: 2,
          canonical: "skills",
          mirrors: [{ target: globalSkills, mode: "copy", createdAt: "2026-06-13T00:00:00Z" }],
        },
        null,
        2,
      ) + "\n",
    );
    const code = await runDoctor({ global: true, json: true });
    restoreGlobal();
    expect(code).toBe(0);
    const payload = JSON.parse(globalLogs[0]!);
    const mirrors = payload.checks.find((c: { section: string }) => c.section === "Mirrors");
    expect(mirrors).toBeDefined();
    expect(mirrors.status).toBe("ok");
  });

  it("stale copy-mode global mirror (canonical has changed) reports error", async () => {
    mkdirSync(join(fakeTmp, ".factory"), { recursive: true });
    const globalSkills = join(fakeTmp, ".factory", "skills");
    // Mirror is an empty directory — stale relative to canonical which has hello/
    mkdirSync(globalSkills, { recursive: true });
    writeFileSync(
      join(skddTmp, ".skdd-sync.json"),
      JSON.stringify(
        {
          version: 2,
          canonical: "skills",
          mirrors: [{ target: globalSkills, mode: "copy", createdAt: "2026-06-13T00:00:00Z" }],
        },
        null,
        2,
      ) + "\n",
    );
    const code = await runDoctor({ global: true, json: true });
    restoreGlobal();
    expect(code).toBe(1);
    const payload = JSON.parse(globalLogs[0]!);
    const mirrorErr = payload.checks.find(
      (c: { section: string; status: string }) => c.section === "Mirrors" && c.status === "error",
    );
    expect(mirrorErr).toBeDefined();
    expect(mirrorErr.message).toMatch(/stale/i);
  });

  it("project doctor is unchanged — mirrors check uses project logic", async () => {
    // In project mode with a harness marker (e.g. .factory dir inside project),
    // doctor should still use the project checkMirrors path.
    mkdirSync(join(tmp, "skills", "hello"), { recursive: true });
    writeFileSync(join(tmp, "skills", "hello", "SKILL.md"), HELLO_SKILL);
    writeFileSync(join(tmp, ".skills-registry.md"), HELLO_REGISTRY);
    // Create .factory inside project dir (harness marker) but no sync state
    mkdirSync(join(tmp, ".factory"), { recursive: true });
    const code = await runDoctor({ cwd: tmp, json: true });
    restoreGlobal();
    const payload = JSON.parse(globalLogs[0]!);
    const mirrors = payload.checks.find((c: { section: string }) => c.section === "Mirrors");
    // Project mode: .factory inside project dir triggers warn (harness detected but no sync state)
    expect(mirrors).toBeDefined();
    expect(mirrors.status).toBe("warn");
    // The warn comes from project checkMirrors, not global
    expect(mirrors.message).toMatch(/harness/i);
  });
});
