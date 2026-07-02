import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isGitRefComponent, parseSource, provenanceLabel } from "../src/lib/commons.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skdd-commons-unit-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("parseSource", () => {
  it("parses GitHub shorthand with a #ref", () => {
    const s = parseSource("owner/repo#v1.2.3", tmp);
    expect(s.kind).toBe("git");
    expect(s.label).toBe("owner/repo");
    expect(s.cloneUrl).toBe("https://github.com/owner/repo.git");
    expect(s.ref).toBe("v1.2.3");
  });

  it("parses a git URL with a #ref", () => {
    const s = parseSource("https://github.com/owner/repo.git#main", tmp);
    expect(s.kind).toBe("git");
    expect(s.ref).toBe("main");
    expect(s.label).toBe("owner/repo");
  });

  it("splits #ref off a relative local path (does not treat it as a literal path)", () => {
    const s = parseSource("../commons#feature", tmp);
    expect(s.kind).toBe("local");
    expect(s.ref).toBe("feature");
    // base path resolved, fragment stripped
    expect(s.localPath?.endsWith("/commons")).toBe(true);
  });

  it("treats an absolute local path as local with no inferred ref", () => {
    const s = parseSource("/abs/path/commons", tmp);
    expect(s.kind).toBe("local");
    expect(s.ref).toBeUndefined();
  });

  it("rejects an unrecognized source", () => {
    expect(() => parseSource("not a source", tmp)).toThrow(/Unrecognized source/);
  });
});

describe("provenanceLabel", () => {
  it("formats owner/repo@shortsha (drop)", () => {
    expect(provenanceLabel({ kind: "git", label: "o/r" }, "abcdef1234567890", "2026-07-x")).toBe(
      "o/r@abcdef1 (2026-07-x)",
    );
  });

  it("marks a dirty local source", () => {
    expect(provenanceLabel({ kind: "local", label: "../c" }, "abcdef1234567890", "d", true)).toBe(
      "../c@abcdef1-dirty (d)",
    );
  });

  it("falls back to @local when no sha is known", () => {
    expect(provenanceLabel({ kind: "local", label: "../c" }, null, "d")).toBe("../c@local (d)");
  });
});

describe("isGitRefComponent", () => {
  it("accepts ordinary drop/pack ids", () => {
    expect(isGitRefComponent("2026-07-frontier")).toBe(true);
    expect(isGitRefComponent("my-pack")).toBe(true);
    expect(isGitRefComponent("v1.2.3")).toBe(true);
  });

  it("rejects git-invalid names", () => {
    expect(isGitRefComponent("foo.lock")).toBe(false); // trailing .lock
    expect(isGitRefComponent("a..b")).toBe(false); // double dot
    expect(isGitRefComponent("my pack")).toBe(false); // space
    expect(isGitRefComponent("has/slash")).toBe(false); // slash
    expect(isGitRefComponent(".hidden")).toBe(false); // leading dot
    expect(isGitRefComponent("-dash")).toBe(false); // leading dash
    expect(isGitRefComponent("bad@{ref")).toBe(false); // @{
    expect(isGitRefComponent("")).toBe(false);
  });
});
