/**
 * mcp-host-validation.test.ts
 *
 * Tests that runMcpAdd rejects unknown --hosts values with a non-zero exit
 * code and a helpful message listing the valid IDs.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMcpAdd } from "../src/commands/mcp.js";
import { loadMcpConfigResult, MCP_HOST_IDS, validateMcpConfig } from "../src/lib/mcp/schema.js";

let skddTmp: string;
let homeTmp: string;
let prevSkddHome: string | undefined;
let prevHome: string | undefined;

beforeEach(() => {
  skddTmp = mkdtempSync(join(tmpdir(), "skdd-host-val-skdd-"));
  homeTmp = mkdtempSync(join(tmpdir(), "skdd-host-val-home-"));
  prevSkddHome = process.env.SKDD_HOME;
  prevHome = process.env.HOME;
  process.env.SKDD_HOME = skddTmp;
  process.env.HOME = homeTmp;
  mkdirSync(join(skddTmp, "skills"), { recursive: true });
});

afterEach(() => {
  if (prevSkddHome === undefined) delete process.env.SKDD_HOME;
  else process.env.SKDD_HOME = prevSkddHome;
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  rmSync(skddTmp, { recursive: true, force: true });
  rmSync(homeTmp, { recursive: true, force: true });
});

describe("mcp add --hosts validation", () => {
  it("rejects a single unknown host ID with exit code 1", async () => {
    const code = await runMcpAdd("myserver", {
      command: "echo",
      hosts: ["bogus"] as any,
    });
    expect(code).toBe(1);
  });

  it("rejects multiple unknown host IDs with exit code 1", async () => {
    const code = await runMcpAdd("myserver", {
      command: "echo",
      hosts: ["bogus", "claude"] as any,
    });
    expect(code).toBe(1);
  });

  it("rejects 'claude' (a common typo for claude-code) with exit code 1", async () => {
    const code = await runMcpAdd("myserver", {
      command: "echo",
      hosts: ["claude"] as any,
    });
    expect(code).toBe(1);
  });

  it("includes the valid IDs in the error message", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });

    await runMcpAdd("myserver", {
      command: "echo",
      hosts: ["bogus"] as any,
    });

    spy.mockRestore();
    const output = errors.join(" ");
    for (const id of MCP_HOST_IDS) {
      expect(output).toContain(id);
    }
  });

  it("accepts all known host IDs and exits 0", async () => {
    for (const hostId of MCP_HOST_IDS) {
      const code = await runMcpAdd(`server-${hostId}`, {
        command: "echo",
        hosts: [hostId],
      });
      expect(code).toBe(0);
    }
  });

  it("accepts a subset of valid host IDs and exits 0", async () => {
    const code = await runMcpAdd("myserver", {
      command: "echo",
      hosts: ["claude-code", "droid"],
    });
    expect(code).toBe(0);
  });

  it("accepts no hosts (undefined) and exits 0", async () => {
    const code = await runMcpAdd("myserver", {
      command: "echo",
      hosts: undefined,
    });
    expect(code).toBe(0);
  });

  it("rejects a mix of valid and invalid host IDs with exit code 1", async () => {
    const code = await runMcpAdd("myserver", {
      command: "echo",
      hosts: ["claude-code", "bogus"] as any,
    });
    expect(code).toBe(1);
  });
});

// ── validateMcpConfig — canonical hosts validation ───────────────────────────

describe("validateMcpConfig — rejects unknown host IDs in hosts array", () => {
  it("rejects a server with hosts:['claude'] (common typo, not a valid ID)", () => {
    const raw = {
      version: 1,
      servers: { srv: { command: "echo", hosts: ["claude"] } },
    };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const hasHostsError = result.errors.some(
        (e) => e.server === "srv" && /unknown/i.test(e.message),
      );
      expect(hasHostsError).toBe(true);
    }
  });

  it("rejects a server with hosts:['bogus-id']", () => {
    const raw = {
      version: 1,
      servers: { srv: { command: "echo", hosts: ["bogus-id"] } },
    };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
  });

  it("rejects a server with hosts containing a mix of valid and unknown IDs", () => {
    const raw = {
      version: 1,
      servers: { srv: { command: "echo", hosts: ["claude-code", "not-a-host"] } },
    };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const hostErr = result.errors.find((e) => e.server === "srv" && /unknown/i.test(e.message));
      expect(hostErr).toBeDefined();
      // Error message lists the invalid ID
      expect(hostErr?.message).toContain("not-a-host");
    }
  });

  it("includes all valid IDs in the error message", () => {
    const raw = {
      version: 1,
      servers: { srv: { command: "echo", hosts: ["claude"] } },
    };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const hostErr = result.errors.find((e) => e.server === "srv");
      // Error should list all valid IDs
      for (const id of MCP_HOST_IDS) {
        expect(hostErr?.message).toContain(id);
      }
    }
  });

  it("accepts a server with all-valid known host IDs", () => {
    const raw = {
      version: 1,
      servers: { srv: { command: "echo", hosts: ["claude-code", "droid"] } },
    };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(true);
  });

  it("accepts a server with no hosts field", () => {
    const raw = {
      version: 1,
      servers: { srv: { command: "echo" } },
    };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(true);
  });

  it("loadMcpConfigResult returns invalid for a mcp.json with unknown host ID", () => {
    // This verifies the load-time validation catches hand-edited registries
    const tmp2 = mkdtempSync(join(tmpdir(), "skdd-host-val-load-"));
    try {
      writeFileSync(
        join(tmp2, "mcp.json"),
        JSON.stringify({ version: 1, servers: { srv: { command: "echo", hosts: ["claude"] } } }),
        "utf8",
      );
      const res = loadMcpConfigResult(tmp2);
      expect(res.status).toBe("invalid");
    } finally {
      rmSync(tmp2, { recursive: true, force: true });
    }
  });
});
