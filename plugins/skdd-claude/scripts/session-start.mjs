#!/usr/bin/env node
// SessionStart: seed the per-session state file so the other gates can
// compare "since session start" timestamps. Silent, fast, never blocks.

import { ensureSessionStart, readHookInput } from "./lib/state.mjs";

const input = readHookInput();
ensureSessionStart(input.session_id);
