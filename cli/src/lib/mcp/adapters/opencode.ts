import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isStdio, type McpServer } from "../schema.js";
import { createJsonAdapter, stripJsonc } from "./_shared.js";

function toNativeEntry(server: McpServer): unknown {
  // OpenCode's native schema differs from the others:
  //   - key is "mcp" (not "mcpServers")
  //   - stdio: type:"local", command is an ARRAY [cmd, ...args], env key is "environment"
  //   - remote: type:"remote", url
  //   - disabled maps to enabled:false (no entry removal)
  if (isStdio(server)) {
    const cmd = [server.command, ...(server.args ?? [])];
    const e: Record<string, unknown> = { type: "local", command: cmd };
    if (server.env && Object.keys(server.env).length > 0) e.environment = server.env;
    e.enabled = server.disabled !== true;
    return e;
  }
  // remote
  const e: Record<string, unknown> = {
    type: "remote",
    url: server.url,
    enabled: server.disabled !== true,
  };
  if (server.headers && Object.keys(server.headers).length > 0) e.headers = server.headers;
  return e;
}

/**
 * Adapter for OpenCode (~/.config/opencode/opencode.json).
 *
 * OpenCode uses a different schema from the other hosts:
 *   - the servers live under the "mcp" key (not "mcpServers")
 *   - stdio command is a single argv array: [cmd, ...args]
 *   - env is "environment", disabled is "enabled: false"
 *
 * The file also holds "$schema" and other config keys — preserved by surgical merge.
 */
export const opencodeAdapter = createJsonAdapter({
  id: "opencode",
  label: "OpenCode",
  configPath() {
    return join(homedir(), ".config", "opencode", "opencode.json");
  },
  available() {
    return existsSync(join(homedir(), ".config", "opencode"));
  },
  mcpKey: "mcp",
  toNativeEntry,
  // OpenCode accepts JSONC (comments + trailing commas) per opencode.ai/docs/config.
  // Strip JSONC extensions before parsing so user configs with comments are not
  // wrongly rejected. Writes use JSON.stringify (comments are lost on apply but
  // all unmanaged keys/servers are preserved via the merge-not-overwrite logic).
  parseRaw: (text) => JSON.parse(stripJsonc(text)),
});
