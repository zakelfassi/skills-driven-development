/**
 * Codex CLI MCP adapter — comment-preserving block splice strategy.
 *
 * Codex stores MCP config in ~/.codex/config.toml alongside 380+ lines of
 * unrelated config and hand-authored comments.  We must never re-serialize
 * the whole document; instead we use TEXT-LEVEL block splice:
 *
 *   1. Read: parse full file with smol-toml to enumerate mcp_servers names.
 *   2. Plan: locate managed [mcp_servers.<name>] header lines + block extents
 *      (incl. nested [mcp_servers.<name>.xxx] sub-tables), remove/replace only
 *      those blocks, append new managed blocks at EOF.
 *   3. Gate: re-parse the spliced content with smol-toml before returning the
 *      plan — if it fails, return {ok:false} keeping the original untouched.
 *
 * canonical disabled:true → native enabled = false (entry is kept, not removed).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { atomicWrite, backupFile } from "../backup.js";
import { type CanonicalMcpConfig, isRemote, isStdio, type McpServer } from "../schema.js";
import { deepEqual } from "./_shared.js";
import type {
  HostApplyResult,
  HostReadResult,
  HostSyncPlan,
  HostSyncPlanOk,
  McpHostAdapter,
  ServerChange,
} from "./types.js";

/** Return the TOML dotted-key segment for a server name. Bare TOML keys
 *  (ASCII letters, digits, underscores, dashes) are returned as-is.
 *  Any other name (e.g. "github.com") is JSON-quoted so that it becomes a
 *  single key rather than being interpreted as nested TOML tables. */
function tomlKey(name: string): string {
  if (/^[A-Za-z0-9_-]+$/.test(name)) return name;
  return JSON.stringify(name);
}

/**
 * Strip an inline TOML comment from a line, returning only the portion before
 * the comment-starting `#`.  A `#` inside a quoted string is NOT a comment
 * delimiter — this function handles both single-quoted (no escape sequences in
 * TOML) and double-quoted (backslash escapes) strings correctly.
 *
 * Examples:
 *   `[mcp_servers.foo] # managed`  →  `[mcp_servers.foo] `
 *   `[mcp_servers."a#b"]`          →  `[mcp_servers."a#b"]`  (# is inside quotes)
 */
function stripInlineComment(line: string): string {
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inDouble) {
      if (ch === "\\") {
        i++; // skip the escaped character
        continue;
      }
      if (ch === '"') inDouble = false;
    } else if (inSingle) {
      // TOML literal strings: no escape sequences
      if (ch === "'") inSingle = false;
    } else {
      if (ch === '"') inDouble = true;
      else if (ch === "'") inSingle = true;
      else if (ch === "#") return line.slice(0, i);
    }
  }
  return line;
}

/**
 * Parse the inner content of a TOML table header (the part between `[` and `]`)
 * into an array of key segments, respecting quoted keys and stripping insignificant
 * whitespace around dots and at the start/end.
 *
 * Returns null if the content cannot be parsed as a valid dotted key.
 *
 * Examples:
 *   " mcp_servers.foo "    → ["mcp_servers", "foo"]
 *   "mcp_servers . foo"    → ["mcp_servers", "foo"]
 *   `mcp_servers."a b"`    → ["mcp_servers", "a b"]
 *   `mcp_servers.'lit'`    → ["mcp_servers", "lit"]
 */
function parseTomlKeySegments(raw: string): string[] | null {
  const segments: string[] = [];
  let i = 0;
  const len = raw.length;

  // Skip leading whitespace
  while (i < len && (raw[i] === " " || raw[i] === "\t")) i++;

  while (i < len) {
    const ch = raw[i];

    if (ch === '"') {
      // Double-quoted key: TOML escape sequences apply
      i++;
      let seg = "";
      while (i < len && raw[i] !== '"') {
        if (raw[i] === "\\") {
          i++;
          if (i >= len) return null;
          const esc = raw[i];
          if (esc === '"') seg += '"';
          else if (esc === "\\") seg += "\\";
          else if (esc === "n") seg += "\n";
          else if (esc === "t") seg += "\t";
          else if (esc === "r") seg += "\r";
          else if (esc === "b") seg += "\b";
          else if (esc === "f") seg += "\f";
          else seg += esc;
        } else {
          seg += raw[i];
        }
        i++;
      }
      if (i >= len) return null; // unterminated double-quoted key
      i++; // skip closing "
      segments.push(seg);
    } else if (ch === "'") {
      // Single-quoted literal key: no escape sequences
      i++;
      let seg = "";
      while (i < len && raw[i] !== "'") {
        seg += raw[i++];
      }
      if (i >= len) return null; // unterminated single-quoted key
      i++; // skip closing '
      segments.push(seg);
    } else if (/[A-Za-z0-9_-]/.test(ch)) {
      // Bare key
      let seg = "";
      while (i < len && /[A-Za-z0-9_-]/.test(raw[i])) {
        seg += raw[i++];
      }
      segments.push(seg);
    } else {
      // Unexpected character
      return null;
    }

    // Skip whitespace after key segment
    while (i < len && (raw[i] === " " || raw[i] === "\t")) i++;

    if (i >= len) break; // end of input — done

    if (raw[i] === ".") {
      i++; // consume dot
      // Skip whitespace after dot
      while (i < len && (raw[i] === " " || raw[i] === "\t")) i++;
      if (i >= len) return null; // trailing dot is invalid
    } else {
      // Unexpected character after segment (e.g. unrecognized char)
      return null;
    }
  }

  return segments.length > 0 ? segments : null;
}

function getCodexDir(): string {
  const codexHome = process.env.CODEX_HOME;
  return codexHome ?? join(homedir(), ".codex");
}

function getConfigPath(): string {
  return join(getCodexDir(), "config.toml");
}

/**
 * Find the [start, end) line range for the block owned by `name`.
 *
 * The block starts at the first line that equals `[mcp_servers.<name>]` and
 * ends just before the next line that starts with `[` but is NOT a sub-table
 * of `name` (i.e. does not start with `[mcp_servers.<name>.`).
 *
 * Exported for unit testing.
 */
export function findBlockExtent(lines: string[], name: string): [number, number] | null {
  const key = tomlKey(name);
  const rootHeader = `[mcp_servers.${key}]`;
  const subPrefix = `[mcp_servers.${key}.`;
  // Expected normalized key segments for the root header
  const rootSegments = ["mcp_servers", name];

  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const stripped = stripInlineComment(lines[i]).trim();
    // Fast path: exact match (common case)
    if (stripped === rootHeader) {
      startIdx = i;
      break;
    }
    // Normalized comparison: parse header into key segments and compare.
    // This handles insignificant whitespace like `[ mcp_servers.foo ]` or
    // `[mcp_servers . foo]` as well as quoted names like `[mcp_servers."a b"]`.
    if (stripped.startsWith("[") && stripped.endsWith("]") && !stripped.startsWith("[[")) {
      const inner = stripped.slice(1, -1);
      const segs = parseTomlKeySegments(inner);
      if (
        segs !== null &&
        segs.length === rootSegments.length &&
        segs.every((s, j) => s === rootSegments[j])
      ) {
        startIdx = i;
        break;
      }
    }
  }

  if (startIdx === -1) return null;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const trimmed = stripInlineComment(lines[i]).trim();
    if (trimmed.startsWith("[")) {
      // Keep sub-tables of this server inside the block.
      // Fast path: exact prefix match.
      if (trimmed.startsWith(subPrefix)) continue;
      // Normalized check: segments start with ["mcp_servers", name] and have more.
      if (trimmed.endsWith("]") && !trimmed.startsWith("[[")) {
        const inner = trimmed.slice(1, -1);
        const segs = parseTomlKeySegments(inner);
        if (
          segs !== null &&
          segs.length > rootSegments.length &&
          rootSegments.every((s, j) => s === segs[j])
        ) {
          continue; // sub-table of this server — stays inside the block
        }
      }
      endIdx = i;
      break;
    }
  }

  return [startIdx, endIdx];
}

/**
 * Find line indices of dotted-key assignments that belong to a given server
 * in the mcp_servers table.
 *
 * Handles configurations where the server is represented using dotted-key form
 * rather than a `[mcp_servers.<name>]` table block. For example:
 *   mcp_servers.foo.command = "cmd"        (root section)
 *   foo.command = "cmd"                    (inside [mcp_servers] section)
 *   mcp_servers.foo = { command = "cmd" }  (inline table, root section)
 *
 * Tracks the current explicit table context so that shortened dotted paths
 * inside `[mcp_servers]` are resolved correctly.
 *
 * Exported for unit testing.
 */
export function findDottedKeyLines(lines: string[], name: string): number[] {
  const indices: number[] = [];
  let currentTableSegs: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const stripped = stripInlineComment(lines[i]).trim();

    // Array-of-tables header — update context, don't collect
    if (stripped.startsWith("[[") && stripped.endsWith("]]")) {
      const inner = stripped.slice(2, -2);
      currentTableSegs = parseTomlKeySegments(inner) ?? [];
      continue;
    }

    // Table header — update context, don't collect
    if (stripped.startsWith("[") && stripped.endsWith("]") && !stripped.startsWith("[[")) {
      const inner = stripped.slice(1, -1);
      currentTableSegs = parseTomlKeySegments(inner) ?? [];
      continue;
    }

    // Skip blank lines and comment-only lines
    if (stripped === "" || stripped.startsWith("#")) continue;

    // Find the first unquoted '=' to locate the key/value boundary
    let eqIdx = -1;
    let inDbl = false;
    let inSng = false;
    for (let j = 0; j < stripped.length; j++) {
      const ch = stripped[j];
      if (inDbl) {
        if (ch === "\\") {
          j++;
          continue;
        }
        if (ch === '"') inDbl = false;
      } else if (inSng) {
        if (ch === "'") inSng = false;
      } else if (ch === '"') {
        inDbl = true;
      } else if (ch === "'") {
        inSng = true;
      } else if (ch === "=") {
        eqIdx = j;
        break;
      }
    }
    if (eqIdx < 0) continue;

    const rawKey = stripped.slice(0, eqIdx).trim();
    const keySegs = parseTomlKeySegments(rawKey);
    if (!keySegs || keySegs.length === 0) continue;

    // Full path = current table context + line key segments
    const fullPath = [...currentTableSegs, ...keySegs];

    // Collect if the assignment belongs to mcp_servers.<name>
    if (fullPath.length >= 2 && fullPath[0] === "mcp_servers" && fullPath[1] === name) {
      indices.push(i);
    }
  }

  return indices;
}

/**
 * Find extents for nested subtable blocks `[mcp_servers.<name>.*]` that fall
 * OUTSIDE any of the already-covered line ranges.
 *
 * These arise when the parent server block and one of its sub-tables are
 * separated by an unrelated TOML section, e.g.:
 *
 *   [mcp_servers.foo]              ← covered by findBlockExtent → [0, 3)
 *   command = "x"
 *   [other]                        ← causes findBlockExtent to stop
 *   y = 1
 *   [mcp_servers.foo.tools.search] ← orphaned — returned here
 *   enabled = true
 *
 * Exported for unit testing.
 */
export function findOrphanedSubtableExtents(
  lines: string[],
  name: string,
  coveredRanges: ReadonlyArray<[number, number]>,
): Array<[number, number]> {
  const rootSegments = ["mcp_servers", name];
  const results: Array<[number, number]> = [];

  function isCovered(idx: number): boolean {
    return coveredRanges.some(([s, e]) => idx >= s && idx < e);
  }

  let i = 0;
  while (i < lines.length) {
    if (isCovered(i)) {
      i++;
      continue;
    }

    const stripped = stripInlineComment(lines[i]).trim();

    if (stripped.startsWith("[") && !stripped.startsWith("[[") && stripped.endsWith("]")) {
      const inner = stripped.slice(1, -1);
      const segs = parseTomlKeySegments(inner);

      if (
        segs !== null &&
        segs.length > rootSegments.length &&
        rootSegments.every((s, j) => s === segs[j])
      ) {
        // Found an orphaned nested subtable of `name`
        const startIdx = i;
        let endIdx = lines.length;
        for (let j = i + 1; j < lines.length; j++) {
          const t = stripInlineComment(lines[j]).trim();
          if (t.startsWith("[")) {
            if (!t.startsWith("[[") && t.endsWith("]")) {
              const inner2 = t.slice(1, -1);
              const segs2 = parseTomlKeySegments(inner2);
              if (
                segs2 !== null &&
                segs2.length > segs.length &&
                segs.every((s, k) => s === segs2[k])
              ) {
                continue; // sub-sub-table stays in this block
              }
            }
            endIdx = j;
            break;
          }
        }
        results.push([startIdx, endIdx]);
        i = endIdx;
        continue;
      }
    }
    i++;
  }

  return results;
}

/**
 * Serialize a single canonical server entry to a TOML block string.
 * `disabled:true` maps to `enabled = false`.
 */
function serverToTomlBlock(name: string, server: McpServer): string {
  const key = tomlKey(name);
  const parts: string[] = [`[mcp_servers.${key}]`];

  if (isStdio(server)) {
    parts.push(`command = ${JSON.stringify(server.command)}`);
    if (server.args?.length) {
      const argsToml = `[${server.args.map((a) => JSON.stringify(a)).join(", ")}]`;
      parts.push(`args = ${argsToml}`);
    }
    if (server.env && Object.keys(server.env).length > 0) {
      const envEntries = Object.entries(server.env)
        .map(([k, v]) => `${tomlKey(k)} = ${JSON.stringify(v)}`)
        .join(", ");
      parts.push(`env = {${envEntries}}`);
    }
  } else if (isRemote(server)) {
    parts.push(`url = ${JSON.stringify(server.url)}`);
    if (server.type) {
      parts.push(`type = ${JSON.stringify(server.type)}`);
    }
    if (server.headers && Object.keys(server.headers).length > 0) {
      const headerEntries = Object.entries(server.headers)
        .map(([k, v]) => `${tomlKey(k)} = ${JSON.stringify(v)}`)
        .join(", ");
      parts.push(`http_headers = {${headerEntries}}`);
    }
  }

  if (server.disabled) {
    parts.push("enabled = false");
  }

  return `${parts.join("\n")}\n`;
}

/**
 * Splice managed blocks out of the TOML content and append replacement blocks.
 *
 * - `toRemove`: names to delete entirely.
 * - `toUpsert`: names to replace with new blocks (old block removed, new appended at EOF).
 *
 * Returns the post-splice content, or `{ok:false}` when the re-parse gate fails.
 *
 * Exported for unit testing (allows direct testing of the gate).
 */
export function spliceBlocks(
  originalContent: string,
  toRemove: string[],
  toUpsert: Array<[string, McpServer]>,
): { ok: true; content: string } | { ok: false; reason: string } {
  const lines = originalContent.split("\n");

  // Collect all block extents for names that need removal or replacement.
  // Process names in combined order so we detect all affected blocks.
  const allNames = [...toRemove, ...toUpsert.map(([n]) => n)];
  const extents: Array<[number, number]> = [];
  const seenStarts = new Set<number>();

  const toRemoveSet = new Set(toRemove);

  for (const name of allNames) {
    const extent = findBlockExtent(lines, name);
    if (extent && !seenStarts.has(extent[0])) {
      seenStarts.add(extent[0]);
      extents.push(extent);
    } else if (!extent) {
      // No table-block header found. Try dotted-key form.
      const dottedIndices = findDottedKeyLines(lines, name);
      if (dottedIndices.length > 0) {
        for (const idx of dottedIndices) {
          if (!seenStarts.has(idx)) {
            seenStarts.add(idx);
            extents.push([idx, idx + 1]);
          }
        }
      } else if (toRemoveSet.has(name)) {
        // Planned removal but cannot locate the server's TOML representation
        // (not a table block, not dotted-key lines). Refuse silently dropping
        // ownership — surface a clear error so the operator can clean up manually.
        return {
          ok: false,
          reason: `skdd: cannot safely remove managed server "${name}" — its TOML representation could not be located; manual cleanup needed`,
        };
      }
      // For toUpsert with no existing representation: new add, nothing to remove.
    }
  }

  // Second pass: find any orphaned nested subtable blocks for each name.
  // These are [mcp_servers.<name>.*] headers that appear OUTSIDE the extents
  // already collected above (e.g., when the parent block and a sub-table are
  // separated by an unrelated TOML section).
  const coveredSoFar: Array<[number, number]> = [...extents];
  for (const name of allNames) {
    const orphaned = findOrphanedSubtableExtents(lines, name, coveredSoFar);
    for (const ext of orphaned) {
      if (!seenStarts.has(ext[0])) {
        seenStarts.add(ext[0]);
        extents.push(ext);
        coveredSoFar.push(ext);
      }
    }
  }

  // Merge overlapping or nested extents. This can arise when findDottedKeyLines
  // adds single-line extents for fields inside a [mcp_servers.foo.*] subtable
  // that findOrphanedSubtableExtents also covers as a block. Without merging,
  // the overlapping extents produce incorrect splice results.
  extents.sort((a, b) => a[0] - b[0]); // ascending for merge
  const mergedExtents: Array<[number, number]> = [];
  for (const ext of extents) {
    if (mergedExtents.length === 0) {
      mergedExtents.push([ext[0], ext[1]]);
    } else {
      const last = mergedExtents[mergedExtents.length - 1];
      if (ext[0] < last[1]) {
        // Overlapping: expand the last extent to cover both
        if (ext[1] > last[1]) last[1] = ext[1];
      } else {
        mergedExtents.push([ext[0], ext[1]]);
      }
    }
  }

  // Remove merged blocks descending by start index so earlier removals don't shift later indices.
  mergedExtents.sort((a, b) => b[0] - a[0]);
  for (const [start, end] of mergedExtents) {
    lines.splice(start, end - start);
  }

  // Drop trailing blank lines before appending managed blocks.
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  let content = lines.join("\n");
  if (content.length > 0 && !content.endsWith("\n")) {
    content += "\n";
  }

  // Append new managed blocks at EOF.
  for (const [name, server] of toUpsert) {
    content += `\n${serverToTomlBlock(name, server)}`;
  }

  // Re-parse gate: if the splice produced invalid TOML, abort.
  let reparsedDoc: unknown;
  try {
    reparsedDoc = parseToml(content);
  } catch (e) {
    return { ok: false, reason: `Post-splice re-parse failed: ${String(e)}` };
  }

  // Ownership verification: confirm that every server in toRemove is truly
  // gone from the re-parsed config. If any still appears (e.g., due to an
  // inline-table form we couldn't splice line-by-line), return BLOCKED rather
  // than silently retaining stale ownership.
  if (toRemove.length > 0 && typeof reparsedDoc === "object" && reparsedDoc !== null) {
    const servers = (reparsedDoc as Record<string, unknown>).mcp_servers;
    if (typeof servers === "object" && servers !== null) {
      for (const name of toRemove) {
        if (name in (servers as Record<string, unknown>)) {
          return {
            ok: false,
            reason: `skdd: managed server "${name}" still present in config after removal attempt; manual cleanup needed`,
          };
        }
      }
    }
  }

  return { ok: true, content };
}

export const codexAdapter: McpHostAdapter = {
  id: "codex",
  label: "Codex CLI",
  // Codex natively persists disabled entries (enabled=false); never omits them.
  omitsDisabled: false,

  configPath(): string {
    return getConfigPath();
  },

  available(): boolean {
    return existsSync(getCodexDir());
  },

  read(): HostReadResult {
    const p = getConfigPath();
    if (!existsSync(p)) {
      return { ok: true, serverNames: [], rawDoc: {} };
    }
    let parsed: unknown;
    try {
      parsed = parseToml(readFileSync(p, "utf8"));
    } catch {
      return { ok: false, reason: `Failed to parse ${p}: invalid TOML` };
    }
    if (typeof parsed !== "object" || parsed === null) {
      return { ok: false, reason: `${p} is not a TOML object` };
    }
    const obj = parsed as Record<string, unknown>;
    const mcpServers = obj.mcp_servers;
    let serverNames: string[] = [];
    if (typeof mcpServers === "object" && mcpServers !== null && !Array.isArray(mcpServers)) {
      serverNames = Object.keys(mcpServers as Record<string, unknown>);
    }
    return { ok: true, serverNames, rawDoc: obj };
  },

  plan(canonical: CanonicalMcpConfig, managed: string[]): HostSyncPlan {
    const p = getConfigPath();
    const originalContent = existsSync(p) ? readFileSync(p, "utf8") : "";

    // Parse existing content to learn what server names + data already exist.
    let existingNames = new Set<string>();
    let existingServersParsed: Record<string, unknown> = {};
    if (originalContent) {
      let parsed: unknown;
      try {
        parsed = parseToml(originalContent);
      } catch {
        return { ok: false, reason: `Failed to parse ${p}: invalid TOML` };
      }
      if (typeof parsed === "object" && parsed !== null) {
        const obj = parsed as Record<string, unknown>;
        const servers = obj.mcp_servers;
        if (typeof servers === "object" && servers !== null && !Array.isArray(servers)) {
          const serversObj = servers as Record<string, unknown>;
          existingNames = new Set(Object.keys(serversObj));
          existingServersParsed = serversObj;
        }
      }
    }

    const changes: ServerChange[] = [];
    const warnings: string[] = [];
    const omitted: string[] = [];
    const toRemove: string[] = [];
    const toUpsert: Array<[string, McpServer]> = [];
    const canonicalNames = new Set(Object.keys(canonical.servers));

    // Determine adds and updates from canonical servers.
    for (const [name, server] of Object.entries(canonical.servers)) {
      // Respect per-server hosts allowlist.
      if (server.hosts && !server.hosts.includes("codex")) {
        // ALLOWLIST NARROWING: if this server was previously managed on codex,
        // remove it now that codex has been excluded from the allowlist.
        if (managed.includes(name) && existingNames.has(name)) {
          changes.push({ op: "remove", name });
          toRemove.push(name);
        } else if (managed.includes(name)) {
          // Managed but TOML block already absent — track in omitted so managed
          // state is purged and a future same-name entry is not clobbered.
          omitted.push(name);
        }
        continue;
      }

      if (existingNames.has(name)) {
        // SAME-NAME UNMANAGED SAFETY: don't overwrite entries not placed by skdd.
        if (!managed.includes(name)) {
          warnings.push(
            `Skipping "${name}": an unmanaged entry with this name already exists; remove it manually to let skdd manage it.`,
          );
          continue;
        }

        // CONTENT-EQUALITY CHECK (parity with JSON adapters): compare parsed
        // existing server data with what we would generate, using deep-equal so
        // key ordering differences do not trigger spurious writes.
        const newBlock = serverToTomlBlock(name, server);
        let newParsed: unknown;
        try {
          const reparsed = parseToml(newBlock);
          const reparsedServers = (reparsed as Record<string, unknown>).mcp_servers;
          if (typeof reparsedServers === "object" && reparsedServers !== null) {
            newParsed = (reparsedServers as Record<string, unknown>)[name];
          }
        } catch {
          // Cannot parse generated block — treat as changed
        }
        if (newParsed !== undefined && deepEqual(existingServersParsed[name], newParsed)) {
          continue; // no change, skip splice
        }

        changes.push({ op: "update", name });
        toUpsert.push([name, server]);
      } else {
        changes.push({ op: "add", name });
        toUpsert.push([name, server]);
      }
    }

    // Determine removals: managed servers that have left the canonical config.
    for (const managedName of managed) {
      if (!canonicalNames.has(managedName) && existingNames.has(managedName)) {
        changes.push({ op: "remove", name: managedName });
        toRemove.push(managedName);
      } else if (!canonicalNames.has(managedName)) {
        // Managed, not in canonical, AND TOML block already absent — track in
        // omitted so managed state is purged even when no removal change was needed.
        omitted.push(managedName);
      }
    }

    if (changes.length === 0) {
      return {
        ok: true,
        changes: [],
        filePath: p,
        finalDoc: { _tomlContent: originalContent },
        warnings,
        omitted,
      };
    }

    const result = spliceBlocks(originalContent, toRemove, toUpsert);
    if (!result.ok) {
      return { ok: false, reason: result.reason };
    }

    // Content-equality check: if splice produced identical content, no writes needed
    if (result.content === originalContent) {
      return {
        ok: true,
        changes: [],
        filePath: p,
        finalDoc: { _tomlContent: originalContent },
        warnings,
        omitted,
      };
    }

    return {
      ok: true,
      changes,
      filePath: p,
      finalDoc: { _tomlContent: result.content },
      warnings,
      omitted,
    };
  },

  apply(plan: HostSyncPlan): HostApplyResult {
    if (!plan.ok) return { ok: false, reason: plan.reason };
    if (plan.changes.length === 0) return { ok: true, written: false };

    const { filePath, finalDoc } = plan as HostSyncPlanOk;
    const content = finalDoc._tomlContent as string;
    try {
      backupFile(filePath);
      atomicWrite(filePath, content);
      return { ok: true, written: true };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  },
};
