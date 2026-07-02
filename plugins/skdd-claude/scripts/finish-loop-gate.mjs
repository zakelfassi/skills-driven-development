#!/usr/bin/env node
// finish-the-loop Stop gate.
//
// Fires only when ALL of:
//   (a) the toggle in .claude/skdd.local.md is on,
//   (b) THIS session introduced a change to non-test product source
//       (measured against the SessionStart baseline, not just a dirty tree),
//   (c) the final assistant message claims success without observed evidence.
//
// Blocks AT MOST ONCE per session (state file) — the second Stop always
// passes, so a stubborn report can't trap the session in a loop. If the
// anti-loop flag can't be persisted, it PASSES rather than risk looping.

import {
  committedPathsSince,
  loadState,
  readHookInput,
  readToggles,
  saveState,
  sessionChangedPaths,
} from "./lib/state.mjs";

const UNVERIFIED_CLAIM =
  /\bshould\s+(now\s+)?(work|be\s+(fixed|working|resolved|good))\b|\blikely\s+(fixed|fixes|resolves?d?)\b|\bprobably\s+(works|fixes|fixed|resolves?d?)\b|\bought\s+to\s+(work|fix)\b|\bshould\s+(fix|resolve|handle)\b/i;

const EVIDENCE_MARKER =
  /\bverified\b|\bobserved\b|\bscreenshot\b|\bwatched\s+it\b|\btests?\s+(pass|passed|passing|green)\b|\bI\s+ran\s+(it|them|the\b|tests?\b|npm\b|pnpm\b|yarn\b|node\b|python\b|the\s+(app|server|build|suite|command)\b)|\boutput\s+(shows|below|above)\b|\bexit\s+code\s+0\b|\ball\s+\d+\s+tests?\b|\bconfirmed\b/i;

const PRODUCT_SOURCE =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|vue|svelte|sql)$/i;

// Test/docs paths that never count as product source. Covers dir conventions
// (tests/, __tests__/, spec/, docs/, examples/), infix styles (.test./.spec./
// .stories.), and suffix styles (foo_test.go, foo_spec.rb, test_foo.py), plus
// prose files.
const TEST_OR_DOCS =
  /(^|\/)(tests?|__tests__|__mocks__|spec|specs|docs?|examples?)\/|\.(test|spec|stories)\.|(^|\/)test_[^/]*$|_(test|spec)\.[A-Za-z0-9]+$|\.mdx?$|\.txt$/i;

const isProductSource = (f) => PRODUCT_SOURCE.test(f) && !TEST_OR_DOCS.test(f);

function main() {
  const input = readHookInput();
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const sessionId = input.session_id;

  // (a) opt-in gate — inert unless the toggle is on
  if (!readToggles(cwd)["finish-the-loop"]) return;

  // anti-loop: block at most once per session
  const state = loadState(sessionId);
  if (state.finishLoopBlocked) return;

  // Fail open when we have no SessionStart baseline (state file missing/cleaned,
  // or SessionStart never ran): without it we can't attribute changes to this
  // session, and the gate is documented to stay quiet when unsure.
  if (!state.sessionStart) return;

  // (b) product source changed BY THIS SESSION — content-compared against the
  // SessionStart baseline (an already-dirty file the session never touched is
  // ignored; a further edit to a pre-dirty file counts) PLUS anything committed
  // since session start (the commit-before-final-report workflow leaves a clean
  // worktree but still changed product source).
  const worktreeChanges = sessionChangedPaths(cwd, state, isProductSource);
  const committedChanges = committedPathsSince(cwd, state.startRev).filter(isProductSource);
  if (worktreeChanges.length === 0 && committedChanges.length === 0) return;

  // (c) unverified-claim language without evidence markers
  const message = String(input.last_assistant_message ?? "");
  if (!message || !UNVERIFIED_CLAIM.test(message) || EVIDENCE_MARKER.test(message)) return;

  // Persist the anti-loop flag FIRST. If we can't (unwritable/full $TMPDIR),
  // pass instead of blocking — a gate that can't remember it fired would block
  // every Stop, which is worse than missing one nudge.
  const next = { ...state, finishLoopBlocked: true };
  if (!saveState(sessionId, next)) {
    process.stderr.write("finish-loop-gate: could not persist anti-loop state; passing.\n");
    return;
  }

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
