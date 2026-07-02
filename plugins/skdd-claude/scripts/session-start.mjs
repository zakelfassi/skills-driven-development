#!/usr/bin/env node
// SessionStart: snapshot the repo (HEAD + changed/untracked paths) and stamp the
// start time, resetting any prior run's state so a resume doesn't inherit a stale
// anti-loop flag or baseline. Silent, fast, never blocks.

import { readHookInput, resetSessionStart } from "./lib/state.mjs";

const input = readHookInput();
const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
resetSessionStart(input.session_id, cwd);
