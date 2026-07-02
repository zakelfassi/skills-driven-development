import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAdd } from "../src/commands/add.js";
import { loadLock } from "../src/lib/lock.js";

const FIXTURES = join(__dirname, "fixtures");
const MINI_COMMONS = join(FIXTURES, "mini-commons");
const MINI_COMMONS_INVALID = join(FIXTURES, "mini-commons-invalid");

const skipOnWindows = platform() === "win32";
const runUnix = skipOnWindows ? it.skip : it;

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
  tmp = mkdtempSync(join(tmpdir(), "skdd-add-"));
  captureConsole();
});

afterEach(() => {
  restoreConsole();
  rmSync(tmp, { recursive: true, force: true });
});

describe("runAdd", () => {
  it("installs a whole drop from a local commons with provenance", async () => {
    const code = await runAdd(MINI_COMMONS, "2026-01-test", { cwd: tmp, nonInteractive: true });
    restoreConsole();
    expect(code).toBe(0);
    expect(existsSync(join(tmp, "skills/alpha-skill/SKILL.md"))).toBe(true);
    expect(existsSync(join(tmp, "skills/beta-skill/SKILL.md"))).toBe(true);

    const registry = readFileSync(join(tmp, ".skills-registry.md"), "utf8");
    expect(registry).toContain("alpha-skill");
    expect(registry).toContain("beta-skill");
    expect(registry).toContain("(2026-01-test)");

    const lock = loadLock(tmp);
    expect(lock.skills["alpha-skill"]).toBeDefined();
    expect(lock.skills["alpha-skill"]!.drop).toBe("2026-01-test");
    expect(lock.skills["alpha-skill"]!.source).toBe(MINI_COMMONS);
  });

  it("installs a single skill via the drop/skill selector", async () => {
    const code = await runAdd(MINI_COMMONS, "2026-01-test/alpha-skill", {
      cwd: tmp,
      nonInteractive: true,
    });
    restoreConsole();
    expect(code).toBe(0);
    expect(existsSync(join(tmp, "skills/alpha-skill/SKILL.md"))).toBe(true);
    expect(existsSync(join(tmp, "skills/beta-skill"))).toBe(false);
  });

  it("refuses to install skills that fail strict validation", async () => {
    const code = await runAdd(MINI_COMMONS_INVALID, "2026-01-bad", {
      cwd: tmp,
      nonInteractive: true,
    });
    restoreConsole();
    expect(code).toBe(1);
    expect(existsSync(join(tmp, "skills/broken-skill"))).toBe(false);
    expect(logs.join("\n")).toContain("fails skdd validate --strict");
  });

  it("refuses on a name collision with a clear message", async () => {
    mkdirSync(join(tmp, "skills/alpha-skill"), { recursive: true });
    writeFileSync(join(tmp, "skills/alpha-skill/SKILL.md"), "---\nname: alpha-skill\n---\nmine");
    const code = await runAdd(MINI_COMMONS, "2026-01-test/alpha-skill", {
      cwd: tmp,
      nonInteractive: true,
    });
    restoreConsole();
    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("Collision");
    expect(logs.join("\n")).toContain("--rename");
    // the pre-existing skill is untouched
    expect(readFileSync(join(tmp, "skills/alpha-skill/SKILL.md"), "utf8")).toContain("mine");
  });

  it("--rename resolves a collision and rewrites the frontmatter name", async () => {
    mkdirSync(join(tmp, "skills/alpha-skill"), { recursive: true });
    writeFileSync(join(tmp, "skills/alpha-skill/SKILL.md"), "---\nname: alpha-skill\n---\nmine");
    const code = await runAdd(MINI_COMMONS, "2026-01-test/alpha-skill", {
      cwd: tmp,
      nonInteractive: true,
      rename: "alpha-two",
    });
    restoreConsole();
    expect(code).toBe(0);
    const installed = readFileSync(join(tmp, "skills/alpha-two/SKILL.md"), "utf8");
    expect(installed).toMatch(/^name: alpha-two$/m);
  });

  it("rejects --rename for a multi-skill selection", async () => {
    const code = await runAdd(MINI_COMMONS, "2026-01-test", {
      cwd: tmp,
      nonInteractive: true,
      rename: "solo-name",
    });
    restoreConsole();
    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("--rename applies to a single skill");
  });

  it("--dry-run reports the plan and writes nothing", async () => {
    const code = await runAdd(MINI_COMMONS, "2026-01-test", {
      cwd: tmp,
      nonInteractive: true,
      dryRun: true,
    });
    restoreConsole();
    expect(code).toBe(0);
    expect(existsSync(join(tmp, "skills"))).toBe(false);
    expect(existsSync(join(tmp, ".skills-registry.md"))).toBe(false);
    expect(logs.join("\n")).toContain("would install alpha-skill");
  });

  it("-g --dry-run does not create the global colony", async () => {
    const fakeHome = join(tmp, "fake-skdd-home");
    const prev = process.env.SKDD_HOME;
    process.env.SKDD_HOME = fakeHome;
    try {
      const code = await runAdd(MINI_COMMONS, "2026-01-test", {
        global: true,
        nonInteractive: true,
        dryRun: true,
      });
      restoreConsole();
      expect(code).toBe(0);
      expect(existsSync(fakeHome)).toBe(false); // ~/.skdd never materialized
    } finally {
      if (prev === undefined) delete process.env.SKDD_HOME;
      else process.env.SKDD_HOME = prev;
    }
  });

  it("--json emits a machine-readable report", async () => {
    const code = await runAdd(MINI_COMMONS, "2026-01-test", {
      cwd: tmp,
      nonInteractive: true,
      json: true,
    });
    restoreConsole();
    expect(code).toBe(0);
    const payload = JSON.parse(logs.find((l) => l.trim().startsWith("{"))!);
    expect(payload.drop).toBe("2026-01-test");
    expect(payload.installed).toHaveLength(2);
    expect(payload.mirrors).toBe("refreshed");
  });

  it("errors with the available drops when no selector is given non-interactively", async () => {
    const code = await runAdd(MINI_COMMONS, undefined, { cwd: tmp, nonInteractive: true });
    restoreConsole();
    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("2026-01-test");
  });

  it("errors on an unknown drop id", async () => {
    const code = await runAdd(MINI_COMMONS, "2099-12-nope", { cwd: tmp, nonInteractive: true });
    restoreConsole();
    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("not found");
  });

  it("errors on a source that is not a commons repo", async () => {
    const notCommons = mkdtempSync(join(tmpdir(), "skdd-notcommons-"));
    try {
      const code = await runAdd(notCommons, "2026-01-test", { cwd: tmp, nonInteractive: true });
      restoreConsole();
      expect(code).toBe(1);
      expect(logs.join("\n")).toContain("drops.json");
    } finally {
      rmSync(notCommons, { recursive: true, force: true });
    }
  });

  describe("hostile drops.json (path traversal)", () => {
    function writeHostileCommons(drops: Array<{ id: string; skills: string[] }>): string {
      const dir = mkdtempSync(join(tmpdir(), "skdd-hostile-"));
      writeFileSync(join(dir, "drops.json"), JSON.stringify({ version: 1, drops }));
      // A skill placed OUTSIDE packs/<drop>/ that a traversal name would reach:
      // packs/2026-01-evil/../escape-skill → packs/escape-skill
      mkdirSync(join(dir, "packs", "escape-skill"), { recursive: true });
      writeFileSync(
        join(dir, "packs", "escape-skill", "SKILL.md"),
        "---\nname: escape-skill\ndescription: Escapes the drop dir. Use when attacking.\n---\n# Escape\n\n1. step\n",
      );
      mkdirSync(join(dir, "packs", "2026-01-evil"), { recursive: true });
      return dir;
    }

    it("refuses a manifest skill name containing ../", async () => {
      const hostile = writeHostileCommons([{ id: "2026-01-evil", skills: ["../escape-skill"] }]);
      try {
        const code = await runAdd(hostile, "2026-01-evil", { cwd: tmp, nonInteractive: true });
        restoreConsole();
        expect(code).toBe(1);
        expect(logs.join("\n")).toContain("Unsafe skill name");
        // nothing installed anywhere — inside or outside the colony
        expect(existsSync(join(tmp, "skills"))).toBe(false);
        expect(existsSync(join(tmp, "escape-skill"))).toBe(false);
      } finally {
        rmSync(hostile, { recursive: true, force: true });
      }
    });

    it("refuses an absolute-path skill name", async () => {
      const hostile = writeHostileCommons([{ id: "2026-01-evil", skills: ["/tmp/escape-skill"] }]);
      try {
        const code = await runAdd(hostile, "2026-01-evil", { cwd: tmp, nonInteractive: true });
        restoreConsole();
        expect(code).toBe(1);
        expect(logs.join("\n")).toContain("Unsafe skill name");
      } finally {
        rmSync(hostile, { recursive: true, force: true });
      }
    });

    runUnix("refuses a source skill whose tree contains a symlink", async () => {
      const dir = mkdtempSync(join(tmpdir(), "skdd-symcommons-"));
      try {
        writeFileSync(
          join(dir, "drops.json"),
          JSON.stringify({ version: 1, drops: [{ id: "2026-01-x", skills: ["linky"] }] }),
        );
        const sd = join(dir, "packs", "2026-01-x", "linky");
        mkdirSync(join(sd, "scripts"), { recursive: true });
        writeFileSync(
          join(sd, "SKILL.md"),
          "---\nname: linky\ndescription: has a symlink. Use when testing.\n---\n# L\n1. x\n",
        );
        writeFileSync(join(dir, "secret.txt"), "SECRET");
        symlinkSync(join(dir, "secret.txt"), join(sd, "scripts", "leak"));
        const code = await runAdd(dir, "2026-01-x", { cwd: tmp, nonInteractive: true });
        restoreConsole();
        expect(code).toBe(1);
        expect(logs.join("\n")).toContain("contains a symlink");
        expect(existsSync(join(tmp, "skills", "linky"))).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("refuses when a skill's frontmatter name does not match its manifest/dir name", async () => {
      // manifest name == directory name by construction; validateSkill enforces
      // frontmatter.name == directory, so a mismatch fails strict validation.
      const dir = mkdtempSync(join(tmpdir(), "skdd-namecommons-"));
      try {
        writeFileSync(
          join(dir, "drops.json"),
          JSON.stringify({ version: 1, drops: [{ id: "2026-01-x", skills: ["claimed"] }] }),
        );
        const sd = join(dir, "packs", "2026-01-x", "claimed");
        mkdirSync(sd, { recursive: true });
        writeFileSync(
          join(sd, "SKILL.md"),
          "---\nname: actually-different\ndescription: mismatch. Use when testing.\n---\n# X\n1. y\n",
        );
        const code = await runAdd(dir, "2026-01-x", { cwd: tmp, nonInteractive: true });
        restoreConsole();
        expect(code).toBe(1);
        expect(logs.join("\n")).toContain("does not match directory");
        expect(existsSync(join(tmp, "skills", "claimed"))).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("refuses a drop id containing ../", async () => {
      const hostile = writeHostileCommons([{ id: "../../evil", skills: ["escape-skill"] }]);
      try {
        const code = await runAdd(hostile, "../../evil", { cwd: tmp, nonInteractive: true });
        restoreConsole();
        expect(code).toBe(1);
        expect(logs.join("\n")).toContain("Unsafe drop id");
      } finally {
        rmSync(hostile, { recursive: true, force: true });
      }
    });
  });

  runUnix("never force-replaces a populated mirror directory (the §2 guardrail)", async () => {
    // A real, populated .claude/skills dir — the shape that must survive.
    mkdirSync(join(tmp, ".claude/skills/precious-skill"), { recursive: true });
    writeFileSync(
      join(tmp, ".claude/skills/precious-skill/SKILL.md"),
      "---\nname: precious-skill\ndescription: not in any colony. Use when testing.\n---\nirreplaceable",
    );

    const code = await runAdd(MINI_COMMONS, "2026-01-test", { cwd: tmp, nonInteractive: true });
    restoreConsole();

    // Install succeeds into canonical, but the mirror refresh is blocked → exit 1.
    expect(code).toBe(1);
    expect(existsSync(join(tmp, "skills/alpha-skill/SKILL.md"))).toBe(true);
    // The populated dir is intact — not replaced by a symlink, contents untouched.
    expect(readFileSync(join(tmp, ".claude/skills/precious-skill/SKILL.md"), "utf8")).toContain(
      "irreplaceable",
    );
    expect(logs.join("\n")).toContain("NOT refreshed");
  });
});
