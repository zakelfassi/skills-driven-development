#!/usr/bin/env node
// finish-the-loop Stop gate.
//
// Fires only when ALL of:
//   (a) the toggle in .claude/skdd.local.md is on,
//   (b) the session's diff touches non-test product source,
//   (c) the final assistant message claims success without observed evidence.
//
// Blocks AT MOST ONCE per session (state file) — the second Stop always
// passes, so a stubborn report can't trap the session in a loop.

import { spawnSync } from "node:child_process";
import {
  ensureSessionStart,
  loadState,
  readHookInput,
  readToggles,
  saveState,
} from "./lib/state.mjs";

const UNVERIFIED_CLAIM =
  /\bshould\s+(now\s+)?(work|be\s+(fixed|working|resolved|good))\b|\blikely\s+(fixed|fixes|resolves?d?)\b|\bprobably\s+(works|fixes|fixed|resolves?d?)\b|\bought\s+to\s+(work|fix)\b|\bshould\s+(fix|resolve|handle)\b/i;

const EVIDENCE_MARKER =
  /\bverified\b|\bobserved\b|\bscreenshot\b|\bwatched\s+it\b|\btests?\s+(pass|passed|passing|green)\b|\bI\s+ran\b|\boutput\s+(shows|below|above)\b|\bexit\s+code\s+0\b|\ball\s+\d+\s+tests?\b|\bconfirmed\b/i;

const PRODUCT_SOURCE =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|vue|svelte|sql)$/i;

const TEST_OR_DOCS =
  /(^|\/)(tests?|__tests__|__mocks__|spec|docs?|examples?)\/|\.(test|spec|stories)\.|\.mdx?$|\.txt$/i;

function changedProductFiles(cwd) {
  // -uall lists individual untracked files (default collapses them to "dir/")
  const res = spawnSync("git", ["status", "--porcelain", "-uall"], {
    cwd,
    encoding: "utf8",
    timeout: 5000,
  });
  if (res.status !== 0) return []; // not a git repo → stay silent
  return (res.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .filter((f) => f && PRODUCT_SOURCE.test(f) && !TEST_OR_DOCS.test(f));
}

function main() {
  const input = readHookInput();
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const sessionId = input.session_id;

  // (a) opt-in gate — inert unless the toggle is on
  if (!readToggles(cwd)["finish-the-loop"]) return;

  // anti-loop: block at most once per session
  const state = ensureSessionStart(sessionId);
  if (state.finishLoopBlocked) return;

  // (b) only when product source changed — a docs-only session can't be "unverified"
  if (changedProductFiles(cwd).length === 0) return;

  // (c) unverified-claim language without evidence markers
  const message = String(input.last_assistant_message ?? "");
  if (!message || !UNVERIFIED_CLAIM.test(message) || EVIDENCE_MARKER.test(message)) return;

  const next = loadState(sessionId);
  next.finishLoopBlocked = true;
  next.sessionStart = next.sessionStart || state.sessionStart;
  saveState(sessionId, next);

  process.stdout.write(
    `${JSON.stringify({
      decision: "block",
      reason:
        "finish-the-loop: report claims success without observed evidence — drive the change and attach what you saw, or state plainly that it is unverified.",
    })}\n`,
  );
}

try {
  main();
} catch (err) {
  // A broken gate must never block a session — fail open, note on stderr.
  process.stderr.write(`finish-loop-gate: ${err instanceof Error ? err.message : String(err)}\n`);
}
