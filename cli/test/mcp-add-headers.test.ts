/**
 * mcp-add-headers.test.ts
 *
 * TDD tests for `mcp add --headers` (remote MCP auth headers).
 *
 * Contract:
 *  - `--headers KEY=VALUE` is parsed like `--env` (comma-separated, split on first `=`)
 *  - headers are only valid for remote servers (--url); combining with --command (stdio) is an error
 *  - `${VAR}` placeholders in values are preserved as-is in canonical (resolved at sync time)
 *  - validateMcpConfig accepts the written config (field types correct)
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMcpAdd } from "../src/commands/mcp.js";
import { loadMcpConfig, validateMcpConfig } from "../src/lib/mcp/schema.js";

let skddTmp: string;
let homeTmp: string;
let prevSkddHome: string | undefined;
let prevHome: string | undefined;

beforeEach(() => {
  skddTmp = mkdtempSync(join(tmpdir(), "skdd-add-headers-skdd-"));
  homeTmp = mkdtempSync(join(tmpdir(), "skdd-add-headers-home-"));
  prevSkddHome = process.env.SKDD_HOME;
  prevHome = process.env.HOME;
  process.env.SKDD_HOME = skddTmp;
  process.env.HOME = homeTmp;
  // ensureGlobalColony expects a skills/ subdir
  mkdirSync(join(skddTmp, "skills"), { recursive: true });
  // Suppress logger output in tests
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

// ── Remote server with headers ────────────────────────────────────────────────

describe("runMcpAdd — --headers for remote servers", () => {
  it("writes headers map to canonical mcp.json with placeholder preserved", async () => {
    const code = await runMcpAdd("r", {
      url: "https://x.example.com/mcp",
      type: "http",
      headers: { Authorization: "Bearer ${TOK}" },
    });
    expect(code).toBe(0);
    const config = loadMcpConfig(skddTmp);
    expect(config).not.toBeNull();
    const srv = config!.servers["r"];
    expect(srv).toBeDefined();
    expect("headers" in srv).toBe(true);
    // Placeholder must be preserved as-is (never resolved at add time)
    expect((srv as any).headers).toEqual({ Authorization: "Bearer ${TOK}" });
  });

  it("written config passes validateMcpConfig (field types correct)", async () => {
    await runMcpAdd("r", {
      url: "https://x.example.com/mcp",
      type: "http",
      headers: { Authorization: "Bearer ${TOK}" },
    });
    const config = loadMcpConfig(skddTmp);
    expect(config).not.toBeNull();
    const result = validateMcpConfig(config!);
    expect(result.ok).toBe(true);
  });

  it("writes multiple headers correctly", async () => {
    const code = await runMcpAdd("multi", {
      url: "https://api.example.com/mcp",
      type: "sse",
      headers: { Authorization: "Bearer tok", "X-Tenant": "acme" },
    });
    expect(code).toBe(0);
    const config = loadMcpConfig(skddTmp);
    const srv = config!.servers["multi"];
    expect((srv as any).headers).toEqual({ Authorization: "Bearer tok", "X-Tenant": "acme" });
  });

  it("writes headers without type (defaults to http on adapter side)", async () => {
    const code = await runMcpAdd("r2", {
      url: "https://remote.example.com/mcp",
      headers: { "X-Api-Key": "${API_KEY}" },
    });
    expect(code).toBe(0);
    const config = loadMcpConfig(skddTmp);
    expect((config!.servers["r2"] as any).headers).toEqual({ "X-Api-Key": "${API_KEY}" });
  });

  it("omits headers key when headers is empty", async () => {
    const code = await runMcpAdd("r3", {
      url: "https://remote.example.com/mcp",
      type: "http",
      headers: {},
    });
    expect(code).toBe(0);
    const config = loadMcpConfig(skddTmp);
    const srv = config!.servers["r3"];
    expect((srv as any).headers).toBeUndefined();
  });
});

// ── Headers rejected with stdio ───────────────────────────────────────────────

describe("runMcpAdd — headers rejected with stdio (--command)", () => {
  it("exits 1 when --headers is combined with --command (stdio)", async () => {
    const code = await runMcpAdd("stdio-srv", {
      command: "my-cmd",
      headers: { Authorization: "Bearer tok" },
    });
    expect(code).toBe(1);
  });

  it("does not write mcp.json when headers+command combination is used", async () => {
    await runMcpAdd("stdio-srv", {
      command: "my-cmd",
      headers: { Authorization: "Bearer tok" },
    });
    const config = loadMcpConfig(skddTmp);
    // mcp.json should not exist (or not contain the server)
    if (config !== null) {
      expect("stdio-srv" in config.servers).toBe(false);
    }
  });
});
