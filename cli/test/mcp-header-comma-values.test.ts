/**
 * mcp-header-comma-values.test.ts
 *
 * TDD tests for the repeatable `--headers` / `--env` fix.
 *
 * Contract (parseKvPairs utility):
 *  - Splits on the FIRST `=` only → value may contain `=`, `,`, or any char
 *  - Keys are trimmed; values are preserved verbatim
 *  - Multiple entries → multiple headers/env vars
 *  - ${VAR} placeholders are left as-is
 *
 * Contract (end-to-end via runMcpAdd):
 *  - A header value containing a comma is stored intact in canonical mcp.json
 *  - Two separate --headers invocations → two separate header keys
 *  - ${VAR} placeholder in a value survives round-trip to canonical
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMcpAdd } from "../src/commands/mcp.js";
import { loadMcpConfig } from "../src/lib/mcp/schema.js";
import { parseKvPairs } from "../src/lib/parse-kv-pairs.js";

// ── parseKvPairs unit tests ───────────────────────────────────────────────────

describe("parseKvPairs", () => {
  it("preserves comma in value (e.g., Accept: application/json, text/event-stream)", () => {
    const result = parseKvPairs(["Accept=application/json, text/event-stream"]);
    expect(result).toEqual({ Accept: "application/json, text/event-stream" });
  });

  it("two entries → two separate keys", () => {
    const result = parseKvPairs([
      "Authorization=Bearer tok",
      "Accept=application/json, text/event-stream",
    ]);
    expect(result).toEqual({
      Authorization: "Bearer tok",
      Accept: "application/json, text/event-stream",
    });
  });

  it("preserves ${VAR} placeholder verbatim", () => {
    const result = parseKvPairs(["Authorization=Bearer ${TOK}"]);
    expect(result).toEqual({ Authorization: "Bearer ${TOK}" });
  });

  it("splits only on the first = (value may contain more = signs)", () => {
    const result = parseKvPairs(["X-Token=abc=def=="]);
    expect(result).toEqual({ "X-Token": "abc=def==" });
  });

  it("returns empty record for empty array", () => {
    expect(parseKvPairs([])).toEqual({});
  });

  it("maps key-only entry (no =) to empty string", () => {
    expect(parseKvPairs(["X-Flag"])).toEqual({ "X-Flag": "" });
  });

  it("trims key whitespace but preserves value whitespace", () => {
    const result = parseKvPairs([" Content-Type = text/plain; charset=utf-8"]);
    // key trimmed, value starts immediately after first =
    expect(result).toEqual({ "Content-Type": " text/plain; charset=utf-8" });
  });

  it("handles a cookie-like value with both commas and equals", () => {
    const result = parseKvPairs(["Cookie=session=abc123; path=/, other=xyz"]);
    expect(result).toEqual({ Cookie: "session=abc123; path=/, other=xyz" });
  });
});

// ── end-to-end via runMcpAdd ──────────────────────────────────────────────────

let skddTmp: string;
let homeTmp: string;
let prevSkddHome: string | undefined;
let prevHome: string | undefined;

beforeEach(() => {
  skddTmp = mkdtempSync(join(tmpdir(), "skdd-kv-e2e-skdd-"));
  homeTmp = mkdtempSync(join(tmpdir(), "skdd-kv-e2e-home-"));
  prevSkddHome = process.env.SKDD_HOME;
  prevHome = process.env.HOME;
  process.env.SKDD_HOME = skddTmp;
  process.env.HOME = homeTmp;
  mkdirSync(join(skddTmp, "skills"), { recursive: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  if (prevSkddHome === undefined) delete process.env.SKDD_HOME;
  else process.env.SKDD_HOME = prevSkddHome;
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  rmSync(skddTmp, { recursive: true, force: true });
  rmSync(homeTmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("runMcpAdd — comma-containing header value preserved", () => {
  it("single --headers with comma value → canonical has exactly that value", async () => {
    // Simulate what repeatable --headers parsing produces:
    // --headers 'Accept=application/json, text/event-stream'
    // → parseKvPairs(["Accept=application/json, text/event-stream"])
    // → { Accept: "application/json, text/event-stream" }
    const headers = parseKvPairs(["Accept=application/json, text/event-stream"]);
    const code = await runMcpAdd("srv", {
      url: "https://x.example.com/mcp",
      type: "http",
      headers,
    });
    expect(code).toBe(0);
    const config = loadMcpConfig(skddTmp);
    expect((config!.servers["srv"] as any).headers).toEqual({
      Accept: "application/json, text/event-stream",
    });
  });

  it("two --headers flags → two header keys in canonical", async () => {
    // Simulate: --headers 'Authorization=Bearer tok' --headers 'Accept=application/json, text/event-stream'
    const headers = parseKvPairs([
      "Authorization=Bearer tok",
      "Accept=application/json, text/event-stream",
    ]);
    const code = await runMcpAdd("srv2", {
      url: "https://x.example.com/mcp",
      type: "http",
      headers,
    });
    expect(code).toBe(0);
    const config = loadMcpConfig(skddTmp);
    expect((config!.servers["srv2"] as any).headers).toEqual({
      Authorization: "Bearer tok",
      Accept: "application/json, text/event-stream",
    });
  });

  it("${VAR} placeholder preserved through parse and store", async () => {
    const headers = parseKvPairs(["Authorization=Bearer ${TOK}"]);
    const code = await runMcpAdd("srv3", {
      url: "https://x.example.com/mcp",
      type: "http",
      headers,
    });
    expect(code).toBe(0);
    const config = loadMcpConfig(skddTmp);
    expect((config!.servers["srv3"] as any).headers).toEqual({
      Authorization: "Bearer ${TOK}",
    });
  });
});
