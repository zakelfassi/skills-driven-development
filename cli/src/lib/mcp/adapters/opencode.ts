import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isStdio, type McpServer } from "../schema.js";
import { createJsonAdapter } from "./_shared.js";

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
  return {
    type: "remote",
    url: server.url,
    enabled: server.disabled !== true,
  };
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
});
