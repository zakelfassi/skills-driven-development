import { describe, expect, it } from "vitest";
import { parseShellArgs } from "../src/lib/parse-shell-args.js";

describe("parseShellArgs", () => {
  it("splits plain space-separated tokens", () => {
    expect(parseShellArgs("-y @pkg")).toEqual(["-y", "@pkg"]);
  });

  it("preserves path with spaces in double quotes", () => {
    expect(parseShellArgs('-y @pkg "/Users/me/My Project"')).toEqual([
      "-y",
      "@pkg",
      "/Users/me/My Project",
    ]);
  });

  it("preserves path with spaces in single quotes", () => {
    expect(parseShellArgs("-y @pkg '/Users/me/My Project'")).toEqual([
      "-y",
      "@pkg",
      "/Users/me/My Project",
    ]);
  });

  it("handles backslash escape inside double quotes", () => {
    expect(parseShellArgs('"hello\\"world"')).toEqual(['hello"world']);
  });

  it("treats single-quoted content verbatim (no backslash escaping)", () => {
    expect(parseShellArgs("'hello\\\\world'")).toEqual(["hello\\\\world"]);
  });

  it("handles multiple spaces between tokens", () => {
    expect(parseShellArgs("  -y   @pkg  ")).toEqual(["-y", "@pkg"]);
  });

  it("returns empty array for empty string", () => {
    expect(parseShellArgs("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(parseShellArgs("   ")).toEqual([]);
  });

  it("handles adjacent quoted and unquoted segments as one token", () => {
    expect(parseShellArgs('--prefix="/usr/local" --name=foo')).toEqual([
      "--prefix=/usr/local",
      "--name=foo",
    ]);
  });

  it("feature spec: -y @pkg with double-quoted path yields three items", () => {
    expect(parseShellArgs('-y @pkg "/Users/me/My Project"')).toEqual([
      "-y",
      "@pkg",
      "/Users/me/My Project",
    ]);
  });

  it("feature spec: plain -y @pkg yields exactly two items", () => {
    expect(parseShellArgs("-y @pkg")).toHaveLength(2);
  });
});
