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
  commitsSince,
  loadState,
  readHookInput,
  readToggles,
  sessionChangedPaths,
} from "./lib/state.mjs";

// "Substantive": at least this many files changed/added since session start,
// or any commit made during the session.
const MIN_CHANGED_FILES = 3;

function sessionLooksSubstantive(cwd, state) {
  // Commits made during the session count even if the tree is now clean.
  if (commitsSince(cwd, state.startRev) > 0) return true;
  return sessionChangedPaths(cwd, state).length >= MIN_CHANGED_FILES;
}

/** The colony registry file (md or json), project first then global, or null. */
function registryPath(cwd) {
  const home = process.env.SKDD_HOME || join(homedir(), ".skdd");
  const candidates = [
    join(cwd, ".skills-registry.md"),
    join(cwd, ".skills-registry.json"),
    join(home, ".skills-registry.md"),
    join(home, ".skills-registry.json"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
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

  const registry = registryPath(cwd);
  if (!registry) return;

  // Registry touched during the session → learnings were frozen; stay quiet.
  if (statSync(registry).mtimeMs >= state.sessionStart) return;

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
