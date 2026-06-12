import { homedir } from "node:os";
import { join } from "node:path";
import { isStdio, type McpServer } from "../schema.js";
import { createJsonAdapter } from "./_shared.js";

function toNativeEntry(server: McpServer): unknown | null {
  // Claude Code has no native disabled flag at user scope → omit the entry
  if (server.disabled) return null;
  if (isStdio(server)) {
    const e: Record<string, unknown> = { command: server.command };
    if (server.args?.length) e.args = server.args;
    if (server.env && Object.keys(server.env).length > 0) e.env = server.env;
    return e;
  }
  // remote: {type, url, headers?}
  const e: Record<string, unknown> = { type: server.type ?? "http", url: server.url };
  if (server.headers && Object.keys(server.headers).length > 0) e.headers = server.headers;
  return e;
}

/**
 * Adapter for Claude Code (~/.claude.json).
 *
 * The file holds ~40 top-level keys beyond mcpServers (projects, caches,
 * onboarding state, etc.).  Only the mcpServers key is touched; all siblings
 * are preserved byte-for-byte via surgical JSON merge.
 */
export const claudeCodeAdapter = createJsonAdapter({
  id: "claude-code",
  label: "Claude Code",
  configPath() {
    return join(homedir(), ".claude.json");
  },
  // Always considered available; configPath() may not exist yet (first sync creates it)
  available() {
    return true;
  },
  mcpKey: "mcpServers",
  toNativeEntry,
});
