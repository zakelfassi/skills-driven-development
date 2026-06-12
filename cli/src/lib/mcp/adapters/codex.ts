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
import type {
  HostApplyResult,
  HostReadResult,
  HostSyncPlan,
  HostSyncPlanOk,
  McpHostAdapter,
  ServerChange,
} from "./types.js";

function getConfigPath(): string {
  return join(homedir(), ".codex", "config.toml");
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
  const rootHeader = `[mcp_servers.${name}]`;
  const subPrefix = `[mcp_servers.${name}.`;

  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimEnd() === rootHeader) {
      startIdx = i;
      break;
    }
  }

  if (startIdx === -1) return null;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trimEnd();
    if (trimmed.startsWith("[") && !trimmed.startsWith(subPrefix)) {
      endIdx = i;
      break;
    }
  }

  return [startIdx, endIdx];
}

/**
 * Serialize a single canonical server entry to a TOML block string.
 * `disabled:true` maps to `enabled = false`.
 */
function serverToTomlBlock(name: string, server: McpServer): string {
  const parts: string[] = [`[mcp_servers.${name}]`];

  if (isStdio(server)) {
    parts.push(`command = ${JSON.stringify(server.command)}`);
    if (server.args?.length) {
      const argsToml = `[${server.args.map((a) => JSON.stringify(a)).join(", ")}]`;
      parts.push(`args = ${argsToml}`);
    }
    if (server.env && Object.keys(server.env).length > 0) {
      const envEntries = Object.entries(server.env)
        .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
        .join(", ");
      parts.push(`env = {${envEntries}}`);
    }
  } else if (isRemote(server)) {
    parts.push(`url = ${JSON.stringify(server.url)}`);
    if (server.type) {
      parts.push(`type = ${JSON.stringify(server.type)}`);
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

  for (const name of allNames) {
    const extent = findBlockExtent(lines, name);
    if (extent && !seenStarts.has(extent[0])) {
      seenStarts.add(extent[0]);
      extents.push(extent);
    }
  }

  // Remove blocks descending by start index so earlier removals don't shift later indices.
  extents.sort((a, b) => b[0] - a[0]);
  for (const [start, end] of extents) {
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
  try {
    parseToml(content);
  } catch (e) {
    return { ok: false, reason: `Post-splice re-parse failed: ${String(e)}` };
  }

  return { ok: true, content };
}

export const codexAdapter: McpHostAdapter = {
  id: "codex",
  label: "Codex CLI",

  configPath(): string {
    return getConfigPath();
  },

  available(): boolean {
    return existsSync(join(homedir(), ".codex"));
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

    // Parse existing content to learn what server names already exist.
    let existingNames = new Set<string>();
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
          existingNames = new Set(Object.keys(servers as Record<string, unknown>));
        }
      }
    }

    const changes: ServerChange[] = [];
    const warnings: string[] = [];
    const toRemove: string[] = [];
    const toUpsert: Array<[string, McpServer]> = [];
    const canonicalNames = new Set(Object.keys(canonical.servers));

    // Determine adds and updates from canonical servers.
    for (const [name, server] of Object.entries(canonical.servers)) {
      // Respect per-server hosts allowlist.
      if (server.hosts && !server.hosts.includes("codex")) continue;

      const op: ServerChange["op"] = existingNames.has(name) ? "update" : "add";
      changes.push({ op, name });
      toUpsert.push([name, server]);
    }

    // Determine removals: managed servers that have left the canonical config.
    for (const managedName of managed) {
      if (!canonicalNames.has(managedName) && existingNames.has(managedName)) {
        changes.push({ op: "remove", name: managedName });
        toRemove.push(managedName);
      }
    }

    if (changes.length === 0) {
      return {
        ok: true,
        changes: [],
        filePath: p,
        finalDoc: { _tomlContent: originalContent },
        warnings,
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
      };
    }

    return {
      ok: true,
      changes,
      filePath: p,
      finalDoc: { _tomlContent: result.content },
      warnings,
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
