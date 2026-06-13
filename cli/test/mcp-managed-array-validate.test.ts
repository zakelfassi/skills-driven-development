/**
 * mcp-managed-array-validate.test.ts
 *
 * Regression tests for f-m12-state-array-validate:
 * If .skdd-sync.json has a host entry where `managed` is not an array
 * (e.g. `{mcp:{hosts:{cursor:{managed:"srv"}}}}`, `managed:123`, `managed:null`),
 * loadState and getMcpManagedNames must NOT throw — they must treat it as []
 * (no managed names). runMcpSync against such state must not crash.
 *
 * Valid arrays must still be returned as-is.
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMcpSync } from "../src/commands/mcp.js";
import { saveMcpConfig } from "../src/lib/mcp/schema.js";
import { getMcpManagedNames } from "../src/lib/mcp/state.js";
import { loadState, statePath } from "../src/lib/sync-state.js";

const FIXTURES_DIR = join(__dirname, "fixtures", "mcp");

let tmp: string;
let skddTmp: string;
let homeTmp: string;
let prevSkddHome: string | undefined;
let prevHome: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skdd-managed-validate-"));
  skddTmp = mkdtempSync(join(tmpdir(), "skdd-managed-skdd-"));
  homeTmp = mkdtempSync(join(tmpdir(), "skdd-managed-home-"));
  prevSkddHome = process.env.SKDD_HOME;
  prevHome = process.env.HOME;
  process.env.SKDD_HOME = skddTmp;
  process.env.HOME = homeTmp;
});

afterEach(() => {
  if (prevSkddHome === undefined) delete process.env.SKDD_HOME;
  else process.env.SKDD_HOME = prevSkddHome;
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  rmSync(tmp, { recursive: true, force: true });
  rmSync(skddTmp, { recursive: true, force: true });
  rmSync(homeTmp, { recursive: true, force: true });
});

// ── loadState normalization ───────────────────────────────────────────────────

describe("loadState — managed is a string", () => {
  it("normalises managed:'srv' to [] and does not throw", () => {
    writeFileSync(
      statePath(tmp),
      JSON.stringify({
        version: 2,
        canonical: "skills",
        mirrors: [],
        mcp: { hosts: { cursor: { managed: "srv", lastSync: "2026-01-01T00:00:00.000Z" } } },
      }),
    );
    expect(() => loadState(tmp)).not.toThrow();
    const state = loadState(tmp);
    expect(state).not.toBeNull();
    expect(state!.mcp!.hosts["cursor"]!.managed).toEqual([]);
  });
});

describe("loadState — managed is a number", () => {
  it("normalises managed:123 to [] and does not throw", () => {
    writeFileSync(
      statePath(tmp),
      JSON.stringify({
        version: 2,
        canonical: "skills",
        mirrors: [],
        mcp: { hosts: { cursor: { managed: 123, lastSync: "2026-01-01T00:00:00.000Z" } } },
      }),
    );
    expect(() => loadState(tmp)).not.toThrow();
    const state = loadState(tmp);
    expect(state).not.toBeNull();
    expect(state!.mcp!.hosts["cursor"]!.managed).toEqual([]);
  });
});

describe("loadState — managed is null", () => {
  it("normalises managed:null to [] and does not throw", () => {
    writeFileSync(
      statePath(tmp),
      JSON.stringify({
        version: 2,
        canonical: "skills",
        mirrors: [],
        mcp: { hosts: { cursor: { managed: null, lastSync: "2026-01-01T00:00:00.000Z" } } },
      }),
    );
    expect(() => loadState(tmp)).not.toThrow();
    const state = loadState(tmp);
    expect(state).not.toBeNull();
    expect(state!.mcp!.hosts["cursor"]!.managed).toEqual([]);
  });
});

describe("loadState — managed is a valid string array", () => {
  it("preserves valid managed array as-is", () => {
    writeFileSync(
      statePath(tmp),
      JSON.stringify({
        version: 2,
        canonical: "skills",
        mirrors: [],
        mcp: {
          hosts: {
            cursor: { managed: ["server-a", "server-b"], lastSync: "2026-01-01T00:00:00.000Z" },
          },
        },
      }),
    );
    const state = loadState(tmp);
    expect(state).not.toBeNull();
    expect(state!.mcp!.hosts["cursor"]!.managed).toEqual(["server-a", "server-b"]);
  });

  it("filters out non-string elements from managed array", () => {
    writeFileSync(
      statePath(tmp),
      JSON.stringify({
        version: 2,
        canonical: "skills",
        mirrors: [],
        mcp: {
          hosts: {
            cursor: {
              managed: ["good", 42, null, "also-good"],
              lastSync: "2026-01-01T00:00:00.000Z",
            },
          },
        },
      }),
    );
    const state = loadState(tmp);
    expect(state).not.toBeNull();
    expect(state!.mcp!.hosts["cursor"]!.managed).toEqual(["good", "also-good"]);
  });
});

// ── getMcpManagedNames defense ────────────────────────────────────────────────

describe("getMcpManagedNames — managed is not an array at runtime", () => {
  it("returns [] when managed is a string (runtime bypass)", () => {
    const state = {
      version: 2,
      canonical: "skills",
      mirrors: [],
      mcp: {
        hosts: {
          cursor: { managed: "srv" as unknown as string[], lastSync: "2026-01-01T00:00:00.000Z" },
        },
      },
    };
    expect(() => getMcpManagedNames(state, "cursor")).not.toThrow();
    expect(getMcpManagedNames(state, "cursor")).toEqual([]);
  });

  it("returns [] when managed is 123 (runtime bypass)", () => {
    const state = {
      version: 2,
      canonical: "skills",
      mirrors: [],
      mcp: {
        hosts: {
          cursor: { managed: 123 as unknown as string[], lastSync: "2026-01-01T00:00:00.000Z" },
        },
      },
    };
    expect(() => getMcpManagedNames(state, "cursor")).not.toThrow();
    expect(getMcpManagedNames(state, "cursor")).toEqual([]);
  });

  it("returns [] when managed is null (runtime bypass)", () => {
    const state = {
      version: 2,
      canonical: "skills",
      mirrors: [],
      mcp: {
        hosts: {
          cursor: { managed: null as unknown as string[], lastSync: "2026-01-01T00:00:00.000Z" },
        },
      },
    };
    expect(() => getMcpManagedNames(state, "cursor")).not.toThrow();
    expect(getMcpManagedNames(state, "cursor")).toEqual([]);
  });

  it("returns valid array unchanged", () => {
    const state = {
      version: 2,
      canonical: "skills",
      mirrors: [],
      mcp: {
        hosts: {
          cursor: { managed: ["a", "b"], lastSync: "2026-01-01T00:00:00.000Z" },
        },
      },
    };
    expect(getMcpManagedNames(state, "cursor")).toEqual(["a", "b"]);
  });
});

// ── runMcpSync does not crash with malformed state ────────────────────────────

describe("runMcpSync — malformed managed in sync state does not crash", () => {
  it("exits 0 when state has managed:'srv' (string) for cursor", async () => {
    // Write a malformed sync state with managed as a string
    writeFileSync(
      statePath(skddTmp),
      JSON.stringify({
        version: 2,
        canonical: "skills",
        mirrors: [],
        mcp: {
          hosts: { cursor: { managed: "srv", lastSync: "2026-01-01T00:00:00.000Z" } },
        },
      }),
    );
    // Place a cursor config so the adapter is available
    mkdirSync(join(homeTmp, ".cursor"), { recursive: true });
    copyFileSync(join(FIXTURES_DIR, "cursor.json"), join(homeTmp, ".cursor", "mcp.json"));
    // Write a minimal canonical config
    mkdirSync(join(skddTmp, "skills"), { recursive: true });
    saveMcpConfig(skddTmp, { version: 1, servers: {} });

    await expect(runMcpSync({ dryRun: true })).resolves.not.toThrow();
    const code = await runMcpSync({ dryRun: true });
    expect(code).toBe(0);
  });

  it("exits 0 when state has managed:123 (number) for cursor", async () => {
    writeFileSync(
      statePath(skddTmp),
      JSON.stringify({
        version: 2,
        canonical: "skills",
        mirrors: [],
        mcp: {
          hosts: { cursor: { managed: 123, lastSync: "2026-01-01T00:00:00.000Z" } },
        },
      }),
    );
    mkdirSync(join(homeTmp, ".cursor"), { recursive: true });
    copyFileSync(join(FIXTURES_DIR, "cursor.json"), join(homeTmp, ".cursor", "mcp.json"));
    mkdirSync(join(skddTmp, "skills"), { recursive: true });
    saveMcpConfig(skddTmp, { version: 1, servers: {} });

    const code = await runMcpSync({ dryRun: true });
    expect(code).toBe(0);
  });

  it("exits 0 when state has managed:null for cursor", async () => {
    writeFileSync(
      statePath(skddTmp),
      JSON.stringify({
        version: 2,
        canonical: "skills",
        mirrors: [],
        mcp: {
          hosts: { cursor: { managed: null, lastSync: "2026-01-01T00:00:00.000Z" } },
        },
      }),
    );
    mkdirSync(join(homeTmp, ".cursor"), { recursive: true });
    copyFileSync(join(FIXTURES_DIR, "cursor.json"), join(homeTmp, ".cursor", "mcp.json"));
    mkdirSync(join(skddTmp, "skills"), { recursive: true });
    saveMcpConfig(skddTmp, { version: 1, servers: {} });

    const code = await runMcpSync({ dryRun: true });
    expect(code).toBe(0);
  });
});
