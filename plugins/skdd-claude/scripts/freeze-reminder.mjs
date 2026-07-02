#!/usr/bin/env node
// freeze-the-session reminder (SessionEnd + PreCompact).
//
// If the toggle is on, the session looks substantive (files changed/added or
// commits made since session start), and the colony registry hasn't been
// touched since session start, surface a non-blocking reminder: freeze the
// learnings before the context dies. PreCompact matters most. Deterministic
// heuristics only — and silent when unsure: a chatty hook gets disabled forever.

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  changedLineCount,
  commitsSince,
  gitRoot,
  loadState,
  readHookInput,
  readToggles,
  sessionChangedPaths,
} from "./lib/state.mjs";

// "Substantive": this many files changed/added, or this many lines changed,
// since session start — or any commit made during the session.
const MIN_CHANGED_FILES = 3;
const MIN_CHANGED_LINES = 20;

function sessionLooksSubstantive(cwd, state) {
  // Commits made during the session count even if the tree is now clean.
  if (commitsSince(cwd, state.startRev) > 0) return true;
  const paths = sessionChangedPaths(cwd, state);
  if (paths.length >= MIN_CHANGED_FILES) return true;
  // A large single-file change (forging/rewriting one SKILL.md) is substantive
  // even though it's only one path.
  return paths.length > 0 && changedLineCount(cwd, paths) >= MIN_CHANGED_LINES;
}

/**
 * Latest mtime among the colony's registry files, checking the repo root first
 * (so a subdirectory session still finds a root registry), then the global
 * colony. Both md + json are considered: touching EITHER active format counts
 * as "frozen" (the CLI treats json as the source of truth when both exist).
 * Returns null when no registry exists anywhere.
 */
function registryMtime(cwd) {
  const home = process.env.SKDD_HOME || join(homedir(), ".skdd");
  const root = gitRoot(cwd) ?? cwd;
  for (const base of [root, cwd, home]) {
    const files = [
      join(base, ".skills-registry.md"),
      join(base, ".skills-registry.json"),
    ].filter((p) => existsSync(p));
    if (files.length > 0) {
      return Math.max(...files.map((p) => statSync(p).mtimeMs));
    }
  }
  return null;
}

function main() {
  const event = process.argv[2] || "SessionEnd";
  const input = readHookInput();
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  if (!readToggles(cwd)["freeze-the-session"]) return;

  // Load existing state only — never invent a start time here, or the
  // "can't compare" guard below would be unreachable when the seed is missing.
  const state = loadState(input.session_id);
  if (!state.sessionStart) return; // no SessionStart seed → unsure → silent

  const mtime = registryMtime(cwd);
  if (mtime === null) return; // no colony registry anywhere → nothing to remind

  // Registry touched during the session → learnings were frozen; stay quiet.
  if (mtime >= state.sessionStart) return;

  if (!sessionLooksSubstantive(cwd, state)) return;

  const urgency =
    event === "PreCompact"
      ? "Context is about to be compacted — freeze before it dies."
      : "Session is ending.";
  process.stdout.write(
    `${JSON.stringify({
      systemMessage:
        `freeze-the-session: this session may hold unfrozen learnings — skills, conventions, checklists. ` +
        `Registry untouched since session start. ${urgency} ` +
        `Consider the freeze-the-session skill (or 'skdd forge') to extract them.`,
    })}\n`,
  );
}

try {
  main();
} catch (err) {
  process.stderr.write(`freeze-reminder: ${err instanceof Error ? err.message : String(err)}\n`);
}
