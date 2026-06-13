import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isStdio, type McpServer } from "../schema.js";
import { createJsonAdapter } from "./_shared.js";

function toNativeEntry(server: McpServer): unknown | null {
  // Gemini CLI has no native disabled flag → omit disabled servers
  if (server.disabled) return null;
  if (isStdio(server)) {
    const e: Record<string, unknown> = { command: server.command };
    if (server.args?.length) e.args = server.args;
    if (server.env && Object.keys(server.env).length > 0) e.env = server.env;
    return e;
  }
  // remote: canonical type 'http' → httpUrl (Streamable HTTP), 'sse'/absent → url (SSE)
  const urlKey = server.type === "http" ? "httpUrl" : "url";
  const e: Record<string, unknown> = { [urlKey]: server.url };
  if (server.headers && Object.keys(server.headers).length > 0) e.headers = server.headers;
  return e;
}

/**
 * Adapter for Gemini CLI (~/.gemini/settings.json).
 *
 * The file also holds general, security, ui, and other config — preserved by
 * surgical merge.  Note: Gemini CLI is transitioning to Antigravity CLI
 * (2026-06-18 for unpaid tiers); available() checks ~/.gemini existence so
 * it degrades gracefully if the directory is removed.
 */
export const geminiAdapter = createJsonAdapter({
  id: "gemini",
  label: "Gemini CLI",
  configPath() {
    return join(homedir(), ".gemini", "settings.json");
  },
  available() {
    return existsSync(join(homedir(), ".gemini"));
  },
  mcpKey: "mcpServers",
  toNativeEntry,
});
