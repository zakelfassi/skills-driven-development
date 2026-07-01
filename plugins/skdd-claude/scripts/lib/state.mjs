// Shared state + toggle plumbing for the skdd-claude hooks.
// Node ≥20 built-ins only — no dependencies, by design.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

export function saveState(sessionId, state) {
  try {
    writeFileSync(statePath(sessionId), JSON.stringify(state));
  } catch {
    // a broken tmpdir must never break the session
  }
}

/** Record the session start once; later hooks compare timestamps against it. */
export function ensureSessionStart(sessionId) {
  const state = loadState(sessionId);
  if (!state.sessionStart) {
    state.sessionStart = Date.now();
    saveState(sessionId, state);
  }
  return state;
}

const TOGGLE_FILE = join(".claude", "skdd.local.md");
const KNOWN_GATES = ["finish-the-loop", "freeze-the-session"];

/**
 * Read the per-project toggle file (.claude/skdd.local.md).
 * Both gates are OFF unless explicitly enabled there — a hook that fires
 * when nobody asked for it gets the whole plugin uninstalled.
 */
export function readToggles(cwd) {
  const toggles = Object.fromEntries(KNOWN_GATES.map((g) => [g, false]));
  const p = join(cwd || process.cwd(), TOGGLE_FILE);
  if (!existsSync(p)) return toggles;
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
