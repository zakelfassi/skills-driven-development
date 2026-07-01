#!/usr/bin/env node
// freeze-the-session reminder (SessionEnd + PreCompact).
//
// If the toggle is on, the session looks substantive (nontrivial diff), and
// the colony registry hasn't been touched since session start, surface a
// non-blocking reminder: freeze the learnings before the context dies.
// PreCompact matters most. Deterministic heuristics only — and silent when
// unsure: a chatty hook gets disabled forever.

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureSessionStart, readHookInput, readToggles } from "./lib/state.mjs";

// "Substantive": at least this many changed lines or changed files in the working tree.
const MIN_CHANGED_LINES = 20;
const MIN_CHANGED_FILES = 3;

function diffLooksSubstantive(cwd) {
  const stat = spawnSync("git", ["diff", "--shortstat", "HEAD"], {
    cwd,
    encoding: "utf8",
    timeout: 5000,
  });
  if (stat.status !== 0) return false; // not a git repo → unsure → silent
  const m = (stat.stdout || "").match(
    /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
  );
  if (!m) return false;
  const files = Number(m[1] || 0);
  const lines = Number(m[2] || 0) + Number(m[3] || 0);
  return files >= MIN_CHANGED_FILES || lines >= MIN_CHANGED_LINES;
}

function registryPath(cwd) {
  const project = join(cwd, ".skills-registry.md");
  if (existsSync(project)) return project;
  const global = join(process.env.SKDD_HOME || join(homedir(), ".skdd"), ".skills-registry.md");
  if (existsSync(global)) return global;
  return null; // no colony anywhere → nothing to remind about
}

function main() {
  const event = process.argv[2] || "SessionEnd";
  const input = readHookInput();
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  if (!readToggles(cwd)["freeze-the-session"]) return;

  const state = ensureSessionStart(input.session_id);
  if (!state.sessionStart) return; // can't compare → unsure → silent

  const registry = registryPath(cwd);
  if (!registry) return;

  // Registry touched during the session → learnings were frozen; stay quiet.
  if (statSync(registry).mtimeMs >= state.sessionStart) return;

  if (!diffLooksSubstantive(cwd)) return;

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
