import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectPublishablePayload,
  runPush,
  stripMachineLocalMetadata,
  summarizeDiff,
} from "../src/commands/push.js";

const runUnix = platform() === "win32" ? it.skip : it;

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

  it("only touches the frontmatter, not example lines in the body", () => {
    const raw = `---
name: x
metadata:
  usage-count: "9"
  last-used: "2026-06-30"
---
# Docs

Example config:

    usage-count: "5"
    last-used: "2020-01-01"
`;
    const stripped = stripMachineLocalMetadata(raw);
    // frontmatter reset/dropped
    expect(stripped).toContain(`  usage-count: "0"`);
    // body example preserved verbatim
    expect(stripped).toContain(`    usage-count: "5"`);
    expect(stripped).toContain(`    last-used: "2020-01-01"`);
  });

  it("drops a metadata block emptied by removing last-used (no dangling null key)", () => {
    const raw = `---
name: x
description: A skill. Use when testing.
metadata:
  last-used: "2026-06-30"
---
body`;
    const stripped = stripMachineLocalMetadata(raw);
    expect(stripped).not.toMatch(/^metadata:\s*$/m); // no dangling `metadata:` → null
    expect(stripped).not.toContain("last-used");
    expect(stripped).toContain("name: x");
  });
});

describe("summarizeDiff", () => {
  it("counts added and removed lines", () => {
    const before = "a\nb\nc";
    const after = "a\nb\nd\ne";
    expect(summarizeDiff(before, after)).toBe("~2 line(s) added, ~1 removed");
  });
});

describe("collectPublishablePayload", () => {
  runUnix("allows only the skill payload; skips dotfiles, strays, and symlinks", () => {
    const dir = join(tmp, "skills", "payload-skill");
    mkdirSync(join(dir, "scripts"), { recursive: true });
    mkdirSync(join(dir, "references"), { recursive: true });
    mkdirSync(join(dir, "logs"), { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: payload-skill\n---\nbody");
    writeFileSync(join(dir, "scripts", "run.sh"), "echo ok");
    writeFileSync(join(dir, "references", "guide.md"), "# guide");
    writeFileSync(join(dir, ".env"), "SECRET=1");
    writeFileSync(join(dir, "notes.log"), "local notes");
    writeFileSync(join(dir, "scripts", ".cache"), "x");
    writeFileSync(join(dir, "logs", "debug.log"), "x");
    symlinkSync("/etc/hosts", join(dir, "scripts", "link.sh"));

    const { files, skipped } = collectPublishablePayload(dir);
    expect(files.sort()).toEqual(["SKILL.md", "references/guide.md", "scripts/run.sh"]);
    expect(skipped).toContain(".env (dotfile)");
    expect(skipped).toContain("notes.log (outside SKILL.md + scripts/references/assets)");
    expect(skipped).toContain("logs/ (outside SKILL.md + scripts/references/assets)");
    expect(skipped).toContain("scripts/.cache (dotfile)");
    expect(skipped).toContain("scripts/link.sh (symlink)");
  });

  runUnix("skips non-regular files (a FIFO) instead of trying to copy them", () => {
    const dir = join(tmp, "skills", "fifo-skill");
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: fifo-skill\n---\nbody");
    writeFileSync(join(dir, "scripts", "ok.sh"), "echo ok");
    execFileSync("mkfifo", [join(dir, "scripts", "pipe")]);

    const { files, skipped } = collectPublishablePayload(dir);
    expect(files).toContain("scripts/ok.sh");
    expect(files).not.toContain("scripts/pipe");
    expect(skipped).toContain("scripts/pipe (not a regular file)");
  });
});

describe("runPush --dry-run against a local commons", () => {
  runUnix("enumerates traveling files and keeps secrets home in the dry-run output", async () => {
    writeColonySkill("gamma-skill");
    const dir = join(tmp, "skills", "gamma-skill");
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "scripts", "helper.sh"), "echo hi");
    writeFileSync(join(dir, ".env"), "TOKEN=supersecret");
    symlinkSync("/etc/hosts", join(dir, "hosts-link"));

    const code = await runPush("gamma-skill", { cwd: tmp, to: MINI_COMMONS, dryRun: true });
    restoreConsole();
    expect(code).toBe(0);
    const out = logs.join("\n");
    expect(out).toContain("travels: SKILL.md");
    expect(out).toContain("travels: scripts/helper.sh");
    expect(out).toContain("stays home: .env (dotfile)");
    expect(out).toContain("stays home: hosts-link (symlink)");
    expect(out).not.toContain("supersecret");
  });

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

  runUnix("excludes a symlinked skill from a pack push without dereferencing it", async () => {
    writeColonySkill("gamma-skill", { pack: "my-pack" });
    // A symlinked SKILL.md pointing at a secret, whose target claims the pack —
    // discovery must skip it (never read it) rather than dereference it.
    writeFileSync(
      join(tmp, "planted.md"),
      "---\nname: evil\nmetadata:\n  pack: my-pack\n---\nPRIVATE KEY MATERIAL",
    );
    const evilDir = join(tmp, "skills", "evil-skill");
    mkdirSync(evilDir, { recursive: true });
    symlinkSync(join(tmp, "planted.md"), join(evilDir, "SKILL.md"));

    const code = await runPush("my-pack", { cwd: tmp, to: MINI_COMMONS, dryRun: true });
    restoreConsole();
    expect(code).toBe(0);
    const out = logs.join("\n");
    expect(out).toContain("gamma-skill");
    expect(out).toContain("Skipping 'evil-skill'");
    expect(out).not.toContain("PRIVATE KEY MATERIAL");
  });

  runUnix("refuses to push a skill whose SKILL.md is a symlink", async () => {
    const dir = join(tmp, "skills", "sneaky-skill");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(tmp, "secret.txt"), "PRIVATE KEY MATERIAL");
    symlinkSync(join(tmp, "secret.txt"), join(dir, "SKILL.md"));

    const code = await runPush("sneaky-skill", { cwd: tmp, to: MINI_COMMONS, dryRun: true });
    restoreConsole();
    expect(code).toBe(1);
    const out = logs.join("\n");
    expect(out).toContain("symlink");
    expect(out).not.toContain("PRIVATE KEY MATERIAL");
  });

  runUnix("refuses to push a skill whose directory is a symlink", async () => {
    mkdirSync(join(tmp, "elsewhere"), { recursive: true });
    writeFileSync(join(tmp, "elsewhere", "SKILL.md"), "---\nname: linked-skill\n---\nbody");
    mkdirSync(join(tmp, "skills"), { recursive: true });
    symlinkSync(join(tmp, "elsewhere"), join(tmp, "skills", "linked-skill"));

    const code = await runPush("linked-skill", { cwd: tmp, to: MINI_COMMONS, dryRun: true });
    restoreConsole();
    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("symlink");
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
