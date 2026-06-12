import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isStdio, type McpServer } from "../schema.js";
import { createJsonAdapter } from "./_shared.js";

function toNativeEntry(server: McpServer): unknown | null {
  // Cursor has no native disabled flag → omit disabled servers
  if (server.disabled) return null;
  if (isStdio(server)) {
    const e: Record<string, unknown> = { command: server.command };
    if (server.args?.length) e.args = server.args;
    if (server.env && Object.keys(server.env).length > 0) e.env = server.env;
    return e;
  }
  // remote: just url (type is inferred by Cursor)
  return { url: server.url };
}

/**
 * Adapter for Cursor (~/.cursor/mcp.json).
 *
 * The real file is often a minified single-line JSON; writing pretty-printed
 * JSON is fine (Cursor re-reads either form).  All unmanaged sibling keys
 * in mcpServers are preserved by surgical merge.
 */
export const cursorAdapter = createJsonAdapter({
  id: "cursor",
  label: "Cursor",
  configPath() {
    return join(homedir(), ".cursor", "mcp.json");
  },
  available() {
    return existsSync(join(homedir(), ".cursor"));
  },
  mcpKey: "mcpServers",
  toNativeEntry,
});
