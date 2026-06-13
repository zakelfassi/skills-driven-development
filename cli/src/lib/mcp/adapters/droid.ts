import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isStdio, type McpServer } from "../schema.js";
import { createJsonAdapter } from "./_shared.js";

function toNativeEntry(server: McpServer): unknown {
  // Droid supports a native disabled flag — keep the entry but mark it disabled
  // Droid also natively supports ${VAR} expansion, so env placeholder strings
  // are passed through unexpanded (the canonical value is written as-is).
  if (isStdio(server)) {
    const e: Record<string, unknown> = { type: "stdio", command: server.command };
    if (server.args?.length) e.args = server.args;
    if (server.env && Object.keys(server.env).length > 0) e.env = server.env;
    if (server.disabled) e.disabled = true;
    return e;
  }
  // remote
  const e: Record<string, unknown> = { type: server.type ?? "http", url: server.url };
  if (server.headers && Object.keys(server.headers).length > 0) e.headers = server.headers;
  if (server.disabled) e.disabled = true;
  return e;
}

/**
 * Adapter for Factory Droid (~/.factory/mcp.json).
 *
 * Droid's native schema uses an explicit "type" field and a "disabled" boolean.
 * It natively supports ${VAR} expansion, so env values with placeholders are
 * passed through as-is (never resolved before writing to this host).
 * The file also holds persistentPermissions — preserved by surgical merge.
 */
export const droidAdapter = createJsonAdapter({
  id: "droid",
  label: "Factory Droid",
  configPath() {
    return join(homedir(), ".factory", "mcp.json");
  },
  available() {
    return existsSync(join(homedir(), ".factory"));
  },
  mcpKey: "mcpServers",
  // Droid natively persists disabled entries (disabled:true); never omits them.
  omitsDisabled: false,
  toNativeEntry,
});
