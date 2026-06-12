import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isStdio, type McpServer } from "../schema.js";
import { createJsonAdapter } from "./_shared.js";

function toNativeEntry(server: McpServer): unknown | null {
  // Claude Desktop is stdio-only; remote servers are not natively supported
  if (!isStdio(server)) return null;
  if (server.disabled) return null;
  const e: Record<string, unknown> = { command: server.command };
  if (server.args?.length) e.args = server.args;
  if (server.env && Object.keys(server.env).length > 0) e.env = server.env;
  return e;
}

function onSkipped(name: string, server: McpServer): string | undefined {
  // Only warn for remote servers — disabled servers are silently omitted.
  if (!isStdio(server)) {
    return `Server "${name}" skipped: Claude Desktop does not support remote MCP servers (url: ${"url" in server ? server.url : "unknown"}).`;
  }
  return undefined;
}

/**
 * Adapter for Claude Desktop (darwin-only).
 *
 * Config: ~/Library/Application Support/Claude/claude_desktop_config.json
 * The file also holds globalShortcut, preferences, isUsingBuiltInNodeForMcp — preserved.
 * Remote servers are skipped silently (Claude Desktop does not support them).
 * available() returns false on non-darwin platforms.
 */
export const claudeDesktopAdapter = createJsonAdapter({
  id: "claude-desktop",
  label: "Claude Desktop",
  configPath() {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
  },
  available() {
    if (process.platform !== "darwin") return false;
    return existsSync(join(homedir(), "Library", "Application Support", "Claude"));
  },
  mcpKey: "mcpServers",
  toNativeEntry,
  onSkipped,
});
