#!/usr/bin/env node
/**
 * generate-plugin-skillforge.mjs
 * Node ≥20, zero deps
 *
 * Reads skillforge/SKILL.md (canonical source) and applies 7 ordered transforms
 * to produce plugins/skdd-claude/skills/skillforge/SKILL.md.
 *
 * Each transform has a named anchor assertion: if the anchor is not found in
 * the text, the script exits 1 with the rule name (prevents silent drift).
 *
 * Usage:
 *   node scripts/generate-plugin-skillforge.mjs            # write output
 *   node scripts/generate-plugin-skillforge.mjs --check    # byte-compare + unified diff on mismatch, exit 1
 *   node scripts/generate-plugin-skillforge.mjs --selftest # validate all anchors without writing
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CANONICAL = join(ROOT, "skillforge", "SKILL.md");
const OUTPUT = join(ROOT, "plugins", "skdd-claude", "skills", "skillforge", "SKILL.md");

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const SELFTEST = args.includes("--selftest");

// ---------------------------------------------------------------------------
// Anchor assertion
// ---------------------------------------------------------------------------

function assertAnchor(text, anchor, ruleName) {
  if (!text.includes(anchor)) {
    console.error(
      `[generate-plugin-skillforge] Rule "${ruleName}" anchor not found.\n` +
        `  Expected string: ${JSON.stringify(anchor).slice(0, 120)}\n` +
        `  Check that skillforge/SKILL.md still contains this text.`,
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 7 ordered transforms
// ---------------------------------------------------------------------------

function applyTransforms(source) {
  let t = source;

  // ── Rule 1: plugin metadata key ──────────────────────────────────────────
  // Insert `  plugin: skdd-claude` as the last key under metadata:, after spec.
  const r1 = "  spec: agentskills.io\n";
  assertAnchor(t, r1, "rule-1-plugin-metadata-key");
  t = t.replace(r1, r1 + "  plugin: skdd-claude\n");

  // ── Rule 2a: mkdir code fence path rewrite ────────────────────────────────
  // skills/<skill-name>  →  .claude/skills/<skill-name>  (in the bash fence)
  const r2a = "mkdir -p skills/<skill-name>";
  assertAnchor(t, r2a, "rule-2a-mkdir-path-rewrite");
  t = t.replace(r2a, "mkdir -p .claude/skills/<skill-name>");

  // ── Rule 2b: tree diagram path rewrite ────────────────────────────────────
  // skills/<skill-name>/  →  .claude/skills/<skill-name>/  (first line of tree)
  const r2b = "skills/<skill-name>/\n";
  assertAnchor(t, r2b, "rule-2b-tree-path-rewrite");
  t = t.replace(r2b, ".claude/skills/<skill-name>/\n");

  // ── Rule 3: harness note injection ───────────────────────────────────────
  // Insert the multi-harness note paragraph after the closing ``` of the
  // mkdir fence (the line after the fence is a blank line then ### 4.).
  const r3old = "```bash\nmkdir -p .claude/skills/<skill-name>\n```\n\n### 4.";
  assertAnchor(t, r3old, "rule-3-harness-note-injection");
  const r3new =
    "```bash\nmkdir -p .claude/skills/<skill-name>\n```\n\n" +
    "(Or `.codex/skills/`, `.cursor/skills/`, `.github/skills/`, etc. — match the harness." +
    " In Claude Code this plugin targets `.claude/skills/`.)\n\n### 4.";
  t = t.replace(r3old, r3new);

  // ── Rule 4: skeleton status field ────────────────────────────────────────
  // Append `  status: active` after forged-reason: in the SKILL.md skeleton.
  const r4 = '  forged-reason: "<why this was created>"\n';
  assertAnchor(t, r4, "rule-4-skeleton-status-field");
  t = t.replace(r4, r4 + "  status: active\n");

  // ── Rule 5a: registry sentence — skills/ dir reference ───────────────────
  // "same level as `skills/`"  →  "same level as `.claude/`"
  const r5a = "same level as `skills/`";
  assertAnchor(t, r5a, "rule-5a-registry-sentence-skills-dir");
  t = t.replace(r5a, "same level as `.claude/`");

  // ── Rule 5b: registry sentence — skdd forge reference ────────────────────
  // "`skdd forge` handles both formats"  →  "the `skdd` CLI handles both formats"
  const r5b = "`skdd forge` handles both formats automatically";
  assertAnchor(t, r5b, "rule-5b-registry-sentence-skdd-forge");
  t = t.replace(r5b, "the `skdd` CLI handles both formats automatically");

  // ── Rule 6a: heading spacing — ### 5. Add scripts ────────────────────────
  // Ensure blank line between the heading and the first paragraph.
  const r6a_old = "### 5. Add scripts (optional)\nIf";
  assertAnchor(t, r6a_old, "rule-6a-heading-spacing-step-5");
  t = t.replace(r6a_old, "### 5. Add scripts (optional)\n\nIf");

  // ── Rule 6b: heading spacing — ### 6. Register the skill ─────────────────
  const r6b_old = "### 6. Register the skill\nUpdate";
  assertAnchor(t, r6b_old, "rule-6b-heading-spacing-step-6");
  t = t.replace(r6b_old, "### 6. Register the skill\n\nUpdate");

  // ── Rule 7a: checklist description item ───────────────────────────────────
  // Append trigger-language hint to the description checklist line.
  const r7a_old =
    "- [ ] `description` includes what it does AND when to use it\n";
  assertAnchor(t, r7a_old, "rule-7a-checklist-description-trigger-language");
  const r7a_new =
    '- [ ] `description` includes what it does AND when to use it (plus trigger language like "Use when …")\n';
  t = t.replace(r7a_old, r7a_new);

  // ── Rule 7b: checklist name-matches-dir item ──────────────────────────────
  // Insert a new checklist item after the transformed description item.
  const r7b_anchor = r7a_new;
  assertAnchor(t, r7b_anchor, "rule-7b-checklist-name-matches-dir");
  t = t.replace(
    r7b_anchor,
    r7b_anchor + "- [ ] `name` matches the parent directory name\n",
  );

  return t;
}

// ---------------------------------------------------------------------------
// Minimal unified diff (no deps)
// ---------------------------------------------------------------------------

function computeLCS(a, b) {
  const m = a.length;
  const n = b.length;
  // O(m*n) DP — files are short (< 200 lines each), so this is fine
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  // Traceback to extract matching pairs [oldIdx, newIdx]
  const pairs = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      pairs.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return pairs;
}

function unifiedDiff(oldText, newText, fromFile = "a", toFile = "b") {
  const CTX = 3;
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const pairs = computeLCS(oldLines, newLines);

  // Build per-old-line mapping: oldIdx → newIdx (matched), or -1 (removed)
  const oldMatch = new Int32Array(oldLines.length).fill(-1);
  const newMatch = new Int32Array(newLines.length).fill(-1);
  for (const [oi, ni] of pairs) {
    oldMatch[oi] = ni;
    newMatch[ni] = oi;
  }

  // Identify changed regions and build hunks
  const hunks = [];
  let oi = 0;
  let ni = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    // Skip matched pairs
    if (oi < oldLines.length && oldMatch[oi] === ni && ni < newLines.length) {
      oi++;
      ni++;
      continue;
    }
    // We're at a mismatch — collect the full changed block
    const hunkOldStart = oi;
    const hunkNewStart = ni;
    // Advance past all mismatches
    while (
      (oi < oldLines.length && oldMatch[oi] !== ni) ||
      (ni < newLines.length && newMatch[ni] !== oi)
    ) {
      if (oi < oldLines.length && oldMatch[oi] === -1) {
        oi++;
      } else if (ni < newLines.length && newMatch[ni] === -1) {
        ni++;
      } else {
        // Both sides have mismatches for current position
        if (oi < oldLines.length && oldMatch[oi] !== ni) oi++;
        else ni++;
      }
    }
    hunks.push({ oldStart: hunkOldStart, oldEnd: oi, newStart: hunkNewStart, newEnd: ni });
  }

  if (!hunks.length) return "";

  // Merge overlapping hunks with context
  const merged = [];
  for (const h of hunks) {
    const ctxOldStart = Math.max(0, h.oldStart - CTX);
    const ctxOldEnd = Math.min(oldLines.length, h.oldEnd + CTX);
    const ctxNewStart = Math.max(0, h.newStart - CTX);
    const ctxNewEnd = Math.min(newLines.length, h.newEnd + CTX);
    if (merged.length && ctxOldStart <= merged[merged.length - 1].ctxOldEnd) {
      const last = merged[merged.length - 1];
      last.ctxOldEnd = Math.max(last.ctxOldEnd, ctxOldEnd);
      last.ctxNewEnd = Math.max(last.ctxNewEnd, ctxNewEnd);
      last.inner.push(h);
    } else {
      merged.push({ ctxOldStart, ctxOldEnd, ctxNewStart, ctxNewEnd, inner: [h] });
    }
  }

  // Render
  const lines = [`--- ${fromFile}`, `+++ ${toFile}`];
  for (const m of merged) {
    const oldCount = m.ctxOldEnd - m.ctxOldStart;
    const newCount = m.ctxNewEnd - m.ctxNewStart;
    lines.push(
      `@@ -${m.ctxOldStart + 1},${oldCount} +${m.ctxNewStart + 1},${newCount} @@`,
    );
    // Re-walk the region
    let ro = m.ctxOldStart;
    let rn = m.ctxNewStart;
    while (ro < m.ctxOldEnd || rn < m.ctxNewEnd) {
      if (ro < m.ctxOldEnd && rn < m.ctxNewEnd && oldMatch[ro] === rn) {
        lines.push(` ${oldLines[ro]}`);
        ro++;
        rn++;
      } else if (ro < m.ctxOldEnd && oldMatch[ro] === -1) {
        lines.push(`-${oldLines[ro]}`);
        ro++;
      } else if (rn < m.ctxNewEnd && newMatch[rn] === -1) {
        lines.push(`+${newLines[rn]}`);
        rn++;
      } else {
        // Mismatch: emit both sides
        if (ro < m.ctxOldEnd) { lines.push(`-${oldLines[ro]}`); ro++; }
        if (rn < m.ctxNewEnd) { lines.push(`+${newLines[rn]}`); rn++; }
      }
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const canonical = readFileSync(CANONICAL, "utf8");
const generated = applyTransforms(canonical);

if (SELFTEST) {
  // applyTransforms already exits 1 on any anchor miss; if we reach here all passed.
  console.log(
    "[generate-plugin-skillforge] --selftest: all 7 rule anchors matched successfully.",
  );
  process.exit(0);
}

if (CHECK) {
  let existing;
  try {
    existing = readFileSync(OUTPUT, "utf8");
  } catch {
    console.error(
      `[generate-plugin-skillforge] --check: output file not readable: ${OUTPUT}`,
    );
    process.exit(1);
  }
  if (generated === existing) {
    console.log("[generate-plugin-skillforge] OK: plugin SKILL.md is up to date.");
    process.exit(0);
  }
  const diff = unifiedDiff(existing, generated, OUTPUT, "(generated)");
  console.error("[generate-plugin-skillforge] MISMATCH: plugin SKILL.md is out of date.");
  console.error(diff);
  process.exit(1);
}

writeFileSync(OUTPUT, generated, "utf8");
console.log(`[generate-plugin-skillforge] Written: ${OUTPUT}`);
