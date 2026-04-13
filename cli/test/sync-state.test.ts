import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyState,
  loadState,
  saveState,
  upsertMirror,
  statePath,
  STATE_VERSION,
} from "../src/lib/sync-state.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skdd-sync-state-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("emptyState", () => {
  it("returns a valid empty state", () => {
    const s = emptyState();
    expect(s.version).toBe(STATE_VERSION);
    expect(s.canonical).toBe("skills");
    expect(s.mirrors).toEqual([]);
  });
});

describe("loadState", () => {
  it("returns null when no state file exists", () => {
    expect(loadState(tmp)).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    writeFileSync(statePath(tmp), "{ not valid json");
    expect(loadState(tmp)).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    writeFileSync(statePath(tmp), JSON.stringify({ foo: "bar" }));
    expect(loadState(tmp)).toBeNull();
  });

  it("loads a well-formed state file", () => {
    const state = emptyState();
    state.mirrors.push({
      target: ".claude/skills",
      mode: "symlink",
      createdAt: "2026-04-13T00:00:00.000Z",
    });
    saveState(tmp, state);
    const loaded = loadState(tmp);
    expect(loaded).not.toBeNull();
    expect(loaded!.mirrors).toHaveLength(1);
    expect(loaded!.mirrors[0]!.target).toBe(".claude/skills");
  });
});

describe("upsertMirror", () => {
  it("adds a new mirror when absent", () => {
    const state = emptyState();
    upsertMirror(state, ".claude/skills", "symlink");
    expect(state.mirrors).toHaveLength(1);
    expect(state.mirrors[0]!.target).toBe(".claude/skills");
    expect(state.mirrors[0]!.mode).toBe("symlink");
    expect(state.mirrors[0]!.createdAt).toBeTruthy();
  });

  it("updates an existing mirror without creating a duplicate", () => {
    const state = emptyState();
    upsertMirror(state, ".claude/skills", "symlink");
    const firstCreatedAt = state.mirrors[0]!.createdAt;
    // Force a clock tick
    const before = Date.now();
    while (Date.now() === before) {
      // spin until the next ms
    }
    upsertMirror(state, ".claude/skills", "copy");
    expect(state.mirrors).toHaveLength(1);
    expect(state.mirrors[0]!.mode).toBe("copy");
    expect(state.mirrors[0]!.createdAt).toBe(firstCreatedAt);
    expect(state.mirrors[0]!.updatedAt).toBeTruthy();
  });
});

describe("saveState round-trip", () => {
  it("persists and loads a multi-mirror state", () => {
    const state = emptyState("skills");
    upsertMirror(state, ".claude/skills", "symlink");
    upsertMirror(state, ".codex/skills", "symlink");
    upsertMirror(state, ".cursor/skills", "copy");
    saveState(tmp, state);

    const loaded = loadState(tmp);
    expect(loaded).not.toBeNull();
    expect(loaded!.canonical).toBe("skills");
    expect(loaded!.mirrors).toHaveLength(3);
    expect(loaded!.mirrors.map((m) => m.target)).toEqual([
      ".claude/skills",
      ".codex/skills",
      ".cursor/skills",
    ]);
  });
});
