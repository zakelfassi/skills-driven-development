/**
 * mcp-sync-state-guard.test.ts
 *
 * Regression tests for f-m8-sync-state-guard:
 * If .skdd-sync.json has an `mcp` object WITHOUT a valid `hosts` map
 * (e.g. `{"mcp":{}}` or `{"mcp":{"hosts":null}}` from a hand-edit or
 * partial migration), loadState and getMcpManagedNames must NOT throw —
 * they must return an empty managed list and treat the mcp section as absent.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMcpManagedNames, loadMcpManagedNames } from "../src/lib/mcp/state.js";
import { loadState, statePath } from "../src/lib/sync-state.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skdd-mcp-guard-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("loadState — malformed mcp shape", () => {
  it("mcp:{} (missing hosts) → loads without throwing, mcp.hosts is empty object", () => {
    writeFileSync(
      statePath(tmp),
      JSON.stringify({ version: 2, canonical: "skills", mirrors: [], mcp: {} }),
    );
    expect(() => loadState(tmp)).not.toThrow();
    const state = loadState(tmp);
    expect(state).not.toBeNull();
    expect(state!.mcp).toBeDefined();
    expect(state!.mcp!.hosts).toEqual({});
  });

  it("mcp:{hosts:null} → loads without throwing, mcp.hosts is empty object", () => {
    writeFileSync(
      statePath(tmp),
      JSON.stringify({ version: 2, canonical: "skills", mirrors: [], mcp: { hosts: null } }),
    );
    expect(() => loadState(tmp)).not.toThrow();
    const state = loadState(tmp);
    expect(state).not.toBeNull();
    expect(state!.mcp).toBeDefined();
    expect(state!.mcp!.hosts).toEqual({});
  });

  it("mcp:{hosts:'bad'} (string) → normalises to empty hosts object", () => {
    writeFileSync(
      statePath(tmp),
      JSON.stringify({ version: 2, canonical: "skills", mirrors: [], mcp: { hosts: "bad" } }),
    );
    const state = loadState(tmp);
    expect(state).not.toBeNull();
    expect(state!.mcp!.hosts).toEqual({});
  });

  it("mcp:{hosts:[]} (array) → normalises to empty hosts object", () => {
    writeFileSync(
      statePath(tmp),
      JSON.stringify({ version: 2, canonical: "skills", mirrors: [], mcp: { hosts: [] } }),
    );
    const state = loadState(tmp);
    expect(state).not.toBeNull();
    expect(state!.mcp!.hosts).toEqual({});
  });
});

describe("getMcpManagedNames — malformed mcp shape does not throw", () => {
  it("state.mcp={hosts:undefined} (empty mcp) → returns []", () => {
    // Simulate a state that somehow has mcp present but hosts undefined at runtime
    const state = {
      version: 2,
      canonical: "skills",
      mirrors: [],
      mcp: {} as { hosts: Record<string, { managed: string[]; lastSync: string }> },
    };
    expect(() => getMcpManagedNames(state, "claude-code")).not.toThrow();
    expect(getMcpManagedNames(state, "claude-code")).toEqual([]);
  });

  it("state loaded from {mcp:{}} → getMcpManagedNames returns []", () => {
    writeFileSync(
      statePath(tmp),
      JSON.stringify({ version: 2, canonical: "skills", mirrors: [], mcp: {} }),
    );
    const state = loadState(tmp);
    expect(state).not.toBeNull();
    expect(() => getMcpManagedNames(state!, "claude-code")).not.toThrow();
    expect(getMcpManagedNames(state!, "claude-code")).toEqual([]);
  });

  it("state loaded from {mcp:{hosts:null}} → getMcpManagedNames returns []", () => {
    writeFileSync(
      statePath(tmp),
      JSON.stringify({ version: 2, canonical: "skills", mirrors: [], mcp: { hosts: null } }),
    );
    const state = loadState(tmp);
    expect(state).not.toBeNull();
    expect(() => getMcpManagedNames(state!, "claude-code")).not.toThrow();
    expect(getMcpManagedNames(state!, "claude-code")).toEqual([]);
  });
});

describe("loadMcpManagedNames — malformed mcp shape does not throw", () => {
  it("state file with mcp:{} → loadMcpManagedNames returns []", () => {
    writeFileSync(
      statePath(tmp),
      JSON.stringify({ version: 2, canonical: "skills", mirrors: [], mcp: {} }),
    );
    expect(() => loadMcpManagedNames(tmp, "claude-code")).not.toThrow();
    expect(loadMcpManagedNames(tmp, "claude-code")).toEqual([]);
  });

  it("state file with mcp:{hosts:null} → loadMcpManagedNames returns []", () => {
    writeFileSync(
      statePath(tmp),
      JSON.stringify({ version: 2, canonical: "skills", mirrors: [], mcp: { hosts: null } }),
    );
    expect(() => loadMcpManagedNames(tmp, "claude-code")).not.toThrow();
    expect(loadMcpManagedNames(tmp, "claude-code")).toEqual([]);
  });
});
