// Shared state + toggle plumbing for the skdd-claude hooks.
// Node ≥20 built-ins only — no dependencies, by design.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Read the JSON payload Claude Code pipes to every hook on stdin. */
export function readHookInput() {
  try {
    const raw = readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Per-session scratch state lives in $TMPDIR — cheap, ephemeral, machine-local. */
export function statePath(sessionId) {
  const id = String(sessionId || "default").replace(/[^A-Za-z0-9_-]/g, "_");
  return join(tmpdir(), `skdd-hooks-${id}.json`);
}

export function loadState(sessionId) {
  try {
    return JSON.parse(readFileSync(statePath(sessionId), "utf8"));
  } catch {
    return {};
  }
}

/** Persist state. Returns true only if the write actually succeeded — callers
 *  that rely on state (e.g. the anti-loop flag) must fail open when it didn't. */
export function saveState(sessionId, state) {
  try {
    writeFileSync(statePath(sessionId), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function git(args, cwd) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 5000 });
  return { status: res.status ?? 1, stdout: res.stdout ?? "" };
}

/** A snapshot of the repo at a point in time: HEAD sha + the set of changed/
 *  untracked paths (porcelain -uall so new files count individually). */
export function repoSnapshot(cwd) {
  const rev = git(["rev-parse", "HEAD"], cwd);
  const status = git(["status", "--porcelain", "-uall"], cwd);
  const paths =
    status.status === 0
      ? status.stdout
          .split(/\r?\n/)
          .map((l) => l.slice(3).trim())
          .filter(Boolean)
      : [];
  return { rev: rev.status === 0 ? rev.stdout.trim() : null, paths };
}

/** Commits made on HEAD since `startRev` (0 if unknown or not a repo). */
export function commitsSince(cwd, startRev) {
  if (!startRev) return 0;
  const res = git(["rev-list", "--count", `${startRev}..HEAD`], cwd);
  return res.status === 0 ? Number.parseInt(res.stdout.trim(), 10) || 0 : 0;
}

/**
 * Fresh per-run state, written at SessionStart. Called on every SessionStart —
 * including resume — so a prior run's `finishLoopBlocked` never leaks into a new
 * run and the freeze reminder always compares against THIS run's baseline.
 */
export function resetSessionStart(sessionId, cwd) {
  const snap = repoSnapshot(cwd);
  const state = {
    sessionStart: Date.now(),
    startRev: snap.rev,
    baseline: snap.paths,
  };
  saveState(sessionId, state);
  return state;
}

const TOGGLE_REL = join(".claude", "skdd.local.md");
const KNOWN_GATES = ["finish-the-loop", "freeze-the-session"];

/** Walk up from `start` to the filesystem root, returning the first directory
 *  that has a `.claude/skdd.local.md` — so a repo-root toggle applies even when
 *  Claude runs from a subdirectory like packages/app. */
function findToggleFile(start) {
  let dir = start;
  for (;;) {
    const candidate = join(dir, TOGGLE_REL);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Read the per-project toggle file (.claude/skdd.local.md), searching upward
 * from the project dir. Both gates are OFF unless explicitly enabled — a hook
 * that fires when nobody asked for it gets the whole plugin uninstalled.
 */
export function readToggles(cwd) {
  const toggles = Object.fromEntries(KNOWN_GATES.map((g) => [g, false]));
  const start = process.env.CLAUDE_PROJECT_DIR || cwd || process.cwd();
  const p = findToggleFile(start);
  if (!p) return toggles;
  let raw;
  try {
    raw = readFileSync(p, "utf8");
  } catch {
    return toggles;
  }
  for (const gate of KNOWN_GATES) {
    const m = raw.match(new RegExp(`^\\s*${gate}:\\s*(true|on|false|off)\\s*$`, "im"));
    if (m) toggles[gate] = /^(true|on)$/i.test(m[1]);
  }
  return toggles;
}
