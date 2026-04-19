import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShow } from "../src/commands/show.js";
import { addRegistryEntry } from "../src/lib/registry.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skdd-show-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("runShow", () => {
  it("prints the canonical SKILL.md body verbatim for an existing skill", async () => {
    const skillDir = join(tmp, "skills/demo");
    mkdirSync(skillDir, { recursive: true });
    const body = `---
name: demo
description: A demo skill. Use when exercising the show command.
---

# Demo Skill

This is the body the show command must print verbatim.
`;
    writeFileSync(join(skillDir, "SKILL.md"), body);

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await runShow("demo", { cwd: tmp });
    expect(code).toBe(0);

    const printed = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    writeSpy.mockRestore();

    expect(printed).toContain("# Demo Skill");
    expect(printed).toContain("This is the body the show command must print verbatim.");
    // Frontmatter should be present too (no rendering — raw mode).
    expect(printed).toContain("name: demo");
  });

  it("exits 1 with a helpful hint listing available skills when the name is unknown", async () => {
    // Populate registry with two sibling skills so the hint has something to print.
    addRegistryEntry(tmp, {
      name: "alpha",
      source: "local",
      description: "Alpha skill. Use when testing.",
      uses: 0,
    });
    addRegistryEntry(tmp, {
      name: "beta",
      source: "local",
      description: "Beta skill. Use when testing.",
      uses: 0,
    });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const code = await runShow("does-not-exist", { cwd: tmp });
    expect(code).toBe(1);

    const errOut = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    const dimOut = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    errSpy.mockRestore();
    logSpy.mockRestore();

    expect(errOut).toMatch(/Skill not found: does-not-exist/);
    expect(dimOut).toMatch(/Available skills:.*alpha.*beta/);
  });
});
