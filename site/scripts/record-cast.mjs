#!/usr/bin/env node
/**
 * record-cast.mjs — Records real skdd CLI output for TerminalCast component.
 *
 * Runs the built CLI in a temp dir:
 *   1. skdd init --harness=claude
 *   2. skdd forge release-notes --non-interactive --from-description "..."
 *   3. skdd doctor
 *
 * Captures stdout with ANSI, converts via tiny SGR parser to HTML spans,
 * writes site/src/data/skdd-cast.json as [{type, text, delayMs}].
 *
 * delayMs = cumulative start time (ms) for that item's animation.
 *
 * Run: pnpm run record-cast (from site/) or node scripts/record-cast.mjs
 */

import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../../cli/dist/index.js");
const OUT_FILE = resolve(__dirname, "../src/data/skdd-cast.json");

// ── Tiny SGR parser ──────────────────────────────────────────────────────────
// Handles the subset of ANSI codes emitted by picocolors (the CLI's color lib).
function sgrToHtml(raw) {
  let s = raw;
  // bold: ESC[1m...ESC[22m
  s = s.replace(/\x1b\[1m([\s\S]*?)\x1b\[22m/g, '<b>$1</b>');
  // dim: ESC[2m...ESC[22m
  s = s.replace(/\x1b\[2m([\s\S]*?)\x1b\[22m/g, '<span class="tc-dim">$1</span>');
  // green: ESC[32m...ESC[39m
  s = s.replace(/\x1b\[32m([\s\S]*?)\x1b\[39m/g, '<span class="tc-green">$1</span>');
  // yellow: ESC[33m...ESC[39m
  s = s.replace(/\x1b\[33m([\s\S]*?)\x1b\[39m/g, '<span class="tc-yellow">$1</span>');
  // strip any remaining ESC sequences
  s = s.replace(/\x1b\[[0-9;]*m/g, '');
  return s;
}

// Strip ANSI to measure plain-text length (for typewriter timing)
function plainLen(raw) {
  return raw.replace(/\x1b\[[0-9;]*m/g, '').length;
}

// ── Timing constants ─────────────────────────────────────────────────────────
const CHAR_MS = 55;       // ms per character for typewriter effect
const CMD_PAUSE = 350;    // pause after typing before output appears
const LINE_PAUSE = 75;    // gap between output lines
const SECTION_PAUSE = 900; // gap between CLI commands

// ── Run a CLI command, return trimmed stdout ─────────────────────────────────
function runCmd(cwd, args) {
  try {
    return execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '1', NO_COLOR: undefined },
    });
  } catch (e) {
    // Some commands exit non-zero (e.g. doctor with warnings) — return stdout anyway
    return (e.stdout || '') + (e.stderr || '');
  }
}

// ── Build transcript ─────────────────────────────────────────────────────────
function buildTranscript(commands) {
  const items = [];
  let cursor = 500; // initial delay before first character

  for (const { label, output } of commands) {
    // Command prompt line
    const cmdText = `$ skdd ${label}`;
    items.push({ type: 'cmd', text: cmdText, delayMs: cursor });
    cursor += plainLen(cmdText) * CHAR_MS + CMD_PAUSE;

    // Output lines
    const lines = output.split('\n').filter(l => l.length > 0);
    for (const line of lines) {
      items.push({ type: 'out', text: sgrToHtml(line), delayMs: cursor });
      cursor += LINE_PAUSE;
    }

    // Pause before next command
    cursor += SECTION_PAUSE;
  }

  return { items, totalMs: cursor + 1500 }; // +1.5s end pause before loop
}

// ── Main ─────────────────────────────────────────────────────────────────────
const tmpDir = mkdtempSync(join(tmpdir(), 'skdd-cast-'));
console.log(`Recording in temp dir: ${tmpDir}`);

try {
  const initOut = runCmd(tmpDir, ['init', '--harness=claude']);
  console.log('✓ init done');

  const forgeOut = runCmd(tmpDir, [
    'forge', 'release-notes',
    '--non-interactive',
    '--from-description',
    'Summarise merged PRs and generate a user-facing CHANGELOG entry for each release',
  ]);
  console.log('✓ forge done');

  const doctorOut = runCmd(tmpDir, ['doctor']);
  console.log('✓ doctor done');

  const commands = [
    { label: 'init --harness=claude', output: initOut.trim() },
    {
      label: 'forge release-notes --non-interactive',
      output: forgeOut.trim(),
    },
    { label: 'doctor', output: doctorOut.trim() },
  ];

  const { items, totalMs } = buildTranscript(commands);

  const outData = { totalMs, items };

  mkdirSync(resolve(__dirname, '../src/data'), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(outData, null, 2) + '\n');
  console.log(`\n✓ Wrote ${items.length} items to ${OUT_FILE}`);
  console.log(`  Total animation duration: ${(totalMs / 1000).toFixed(1)}s`);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
