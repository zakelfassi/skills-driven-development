/**
 * mcp-fail-closed.test.ts
 *
 * Tests that mcp commands fail closed when the canonical ~/.skdd/mcp.json
 * is present but malformed/invalid — preventing mass deletion of managed
 * host entries or silent overwrite with a corrupt file.
 *
 * All tests use:
 *   SKDD_HOME = skddTmp — temp dir for canonical mcp.json + sync state
 *   HOME      = homeTmp — temp dir for host configs
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectMcpPlanLines,
  runMcpAdd,
  runMcpList,
  runMcpRemove,
  runMcpSync,
} from "../src/commands/mcp.js";
import { saveMcpConfig } from "../src/lib/mcp/schema.js";

let skddTmp: string;
let homeTmp: string;
let prevSkddHome: string | undefined;
let prevHome: string | undefined;

beforeEach(() => {
  skddTmp = mkdtempSync(join(tmpdir(), "skdd-fail-closed-skdd-"));
  homeTmp = mkdtempSync(join(tmpdir(), "skdd-fail-closed-home-"));
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

// ── helpers ───────────────────────────────────────────────────────────────────

function writeHostJson(relPath: string, content: unknown): string {
  const dest = join(homeTmp, relPath);
  mkdirSync(join(dest, ".."), { recursive: true });
  writeFileSync(dest, JSON.stringify(content, null, 2), "utf8");
  return dest;
}

function mtimeOf(absPath: string): number {
  return statSync(absPath).mtimeMs;
}

// ── runMcpSync fail-closed ────────────────────────────────────────────────────

describe("runMcpSync — fail closed on invalid canonical mcp.json", () => {
  it("exits 1 when canonical mcp.json has malformed JSON", async () => {
    writeFileSync(join(skddTmp, "mcp.json"), "{ not json }", "utf8");
    const hostPath = writeHostJson(".claude.json", { mcpServers: {} });
    const mtimeBefore = mtimeOf(hostPath);

    await new Promise((r) => setTimeout(r, 15));

    const code = await runMcpSync();
    expect(code).toBe(1);
    // Host file must not have been touched
    expect(mtimeOf(hostPath)).toBe(mtimeBefore);
  });

  it("exits 1 when canonical mcp.json fails schema validation (wrong version)", async () => {
    writeFileSync(join(skddTmp, "mcp.json"), JSON.stringify({ version: 99, servers: {} }), "utf8");
    const hostPath = writeHostJson(".claude.json", { mcpServers: {} });
    const mtimeBefore = mtimeOf(hostPath);

    await new Promise((r) => setTimeout(r, 15));

    const code = await runMcpSync();
    expect(code).toBe(1);
    expect(mtimeOf(hostPath)).toBe(mtimeBefore);
  });

  it("exits 1 when canonical mcp.json has duplicate server names", async () => {
    const raw = '{"version":1,"servers":{"srv":{"command":"a"},"srv":{"command":"b"}}}';
    writeFileSync(join(skddTmp, "mcp.json"), raw, "utf8");
    const hostPath = writeHostJson(".claude.json", { mcpServers: {} });
    const mtimeBefore = mtimeOf(hostPath);

    await new Promise((r) => setTimeout(r, 15));

    const code = await runMcpSync();
    expect(code).toBe(1);
    expect(mtimeOf(hostPath)).toBe(mtimeBefore);
  });

  it("does NOT modify any host config when canonical is invalid (no mass deletion)", async () => {
    // Simulate state where a managed server already exists in a host file
    const hostContent = {
      mcpServers: {
        "managed-srv": { command: "managed-cmd" },
        "user-srv": { command: "user-cmd" },
      },
    };
    const hostPath = writeHostJson(".claude.json", hostContent);
    const originalHostContent = readFileSync(hostPath, "utf8");

    // Corrupt the canonical
    writeFileSync(join(skddTmp, "mcp.json"), "CORRUPT!", "utf8");

    await new Promise((r) => setTimeout(r, 15));

    const code = await runMcpSync();
    expect(code).toBe(1);

    // Host file content must be byte-identical
    expect(readFileSync(hostPath, "utf8")).toBe(originalHostContent);
  });

  it("exits 1 when canonical mcp.json has a server with neither command nor url", async () => {
    writeFileSync(
      join(skddTmp, "mcp.json"),
      JSON.stringify({ version: 1, servers: { bad: { env: { X: "1" } } } }),
      "utf8",
    );
    const hostPath = writeHostJson(".claude.json", { mcpServers: {} });
    const mtimeBefore = mtimeOf(hostPath);

    await new Promise((r) => setTimeout(r, 15));

    const code = await runMcpSync();
    expect(code).toBe(1);
    expect(mtimeOf(hostPath)).toBe(mtimeBefore);
  });

  it("still syncs normally when canonical mcp.json is absent (no file = not an error)", async () => {
    // No mcp.json written → absent, not invalid
    const code = await runMcpSync();
    expect(code).toBe(0);
  });
});

// ── runMcpAdd fail-closed ─────────────────────────────────────────────────────

describe("runMcpAdd — fail closed on invalid canonical mcp.json", () => {
  it("exits 1 and leaves mcp.json unmodified when it has malformed JSON", async () => {
    const originalContent = '{ this is "corrupt" }';
    writeFileSync(join(skddTmp, "mcp.json"), originalContent, "utf8");

    const code = await runMcpAdd("new-server", { command: "my-cmd" });
    expect(code).toBe(1);
    expect(readFileSync(join(skddTmp, "mcp.json"), "utf8")).toBe(originalContent);
  });

  it("exits 1 and leaves mcp.json unmodified when schema validation fails", async () => {
    const originalContent = JSON.stringify({ version: 99, servers: {} });
    writeFileSync(join(skddTmp, "mcp.json"), originalContent, "utf8");

    const code = await runMcpAdd("new-server", { command: "my-cmd" });
    expect(code).toBe(1);
    expect(readFileSync(join(skddTmp, "mcp.json"), "utf8")).toBe(originalContent);
  });

  it("exits 1 when mcp.json has a server with both command and url (invalid)", async () => {
    const originalContent = JSON.stringify({
      version: 1,
      servers: { bad: { command: "c", url: "https://x.com" } },
    });
    writeFileSync(join(skddTmp, "mcp.json"), originalContent, "utf8");

    const code = await runMcpAdd("new-server", { command: "new-cmd" });
    expect(code).toBe(1);
    expect(readFileSync(join(skddTmp, "mcp.json"), "utf8")).toBe(originalContent);
  });

  it("still works when canonical file is absent (creates it fresh)", async () => {
    // mcp.json absent → should succeed
    const code = await runMcpAdd("new-server", { command: "my-cmd" });
    expect(code).toBe(0);
    expect(existsSync(join(skddTmp, "mcp.json"))).toBe(true);
  });

  it("still works when canonical file is valid", async () => {
    saveMcpConfig(skddTmp, { version: 1, servers: { existing: { command: "existing-cmd" } } });

    const code = await runMcpAdd("new-server", { command: "my-cmd" });
    expect(code).toBe(0);
    const loaded = JSON.parse(readFileSync(join(skddTmp, "mcp.json"), "utf8")) as {
      servers: Record<string, unknown>;
    };
    expect(loaded.servers["existing"]).toBeDefined();
    expect(loaded.servers["new-server"]).toBeDefined();
  });
});

// ── runMcpRemove fail-closed ──────────────────────────────────────────────────

describe("runMcpRemove — fail closed on invalid canonical mcp.json", () => {
  it("exits 1 when canonical mcp.json has malformed JSON", async () => {
    const originalContent = "{ corrupt }";
    writeFileSync(join(skddTmp, "mcp.json"), originalContent, "utf8");

    const code = await runMcpRemove("some-server");
    expect(code).toBe(1);
    expect(readFileSync(join(skddTmp, "mcp.json"), "utf8")).toBe(originalContent);
  });

  it("exits 1 when canonical mcp.json fails schema validation", async () => {
    const originalContent = JSON.stringify({
      version: 2,
      servers: { srv: { command: "cmd" } },
    });
    writeFileSync(join(skddTmp, "mcp.json"), originalContent, "utf8");

    const code = await runMcpRemove("srv");
    expect(code).toBe(1);
    expect(readFileSync(join(skddTmp, "mcp.json"), "utf8")).toBe(originalContent);
  });

  it("returns 1 (not 0) when file is invalid even with --force", async () => {
    const originalContent = "INVALID";
    writeFileSync(join(skddTmp, "mcp.json"), originalContent, "utf8");

    const code = await runMcpRemove("some-server", { force: true });
    expect(code).toBe(1);
    expect(readFileSync(join(skddTmp, "mcp.json"), "utf8")).toBe(originalContent);
  });

  it("still returns 1 when canonical is absent (no file to remove from)", async () => {
    const code = await runMcpRemove("missing-server");
    expect(code).toBe(1);
  });

  it("returns 0 when canonical is absent with --force", async () => {
    const code = await runMcpRemove("missing-server", { force: true });
    expect(code).toBe(0);
  });
});

// ── runMcpList fail-closed ────────────────────────────────────────────────────

describe("runMcpList — fail closed on invalid canonical mcp.json", () => {
  it("exits 1 when canonical mcp.json has malformed JSON", async () => {
    writeFileSync(join(skddTmp, "mcp.json"), "{ not valid json }", "utf8");
    const code = await runMcpList();
    expect(code).toBe(1);
  });

  it("exits 1 when canonical mcp.json fails schema validation (wrong version)", async () => {
    writeFileSync(join(skddTmp, "mcp.json"), JSON.stringify({ version: 99, servers: {} }), "utf8");
    const code = await runMcpList();
    expect(code).toBe(1);
  });

  it("exits 1 when canonical mcp.json has duplicate server names", async () => {
    const raw = '{"version":1,"servers":{"srv":{"command":"a"},"srv":{"command":"b"}}}';
    writeFileSync(join(skddTmp, "mcp.json"), raw, "utf8");
    const code = await runMcpList();
    expect(code).toBe(1);
  });

  it("exits 0 (not 1) when canonical mcp.json is absent — absent is not invalid", async () => {
    const code = await runMcpList();
    expect(code).toBe(0);
  });

  it("exits 0 and lists servers when canonical mcp.json is valid", async () => {
    writeFileSync(
      join(skddTmp, "mcp.json"),
      JSON.stringify({ version: 1, servers: { "my-srv": { command: "echo" } } }),
      "utf8",
    );
    const code = await runMcpList();
    expect(code).toBe(0);
  });
});

// ── collectMcpPlanLines fail-closed ──────────────────────────────────────────

describe("collectMcpPlanLines — fail closed on invalid canonical mcp.json", () => {
  it("returns an error line (not empty) when canonical mcp.json has malformed JSON", async () => {
    writeFileSync(join(skddTmp, "mcp.json"), "{ bad json }", "utf8");
    const lines = await collectMcpPlanLines();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toMatch(/\[error\]/i);
  });

  it("returns an error line when canonical mcp.json fails schema validation", async () => {
    writeFileSync(join(skddTmp, "mcp.json"), JSON.stringify({ version: 99, servers: {} }), "utf8");
    const lines = await collectMcpPlanLines();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toMatch(/\[error\]/i);
  });

  it("returns 'no MCP servers' line (not error) when canonical mcp.json is absent", async () => {
    const lines = await collectMcpPlanLines();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).not.toMatch(/\[error\]/i);
  });
});
