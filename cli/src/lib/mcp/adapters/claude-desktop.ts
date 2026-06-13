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
 * Resolve the Claude Desktop config directory and config file path for the
 * given platform. Extracted as a pure function so it can be unit-tested
 * without mocking process.platform or process.env.
 *
 * @param platform - value of process.platform ("darwin", "win32", etc.)
 * @param appdata  - value of process.env.APPDATA (Windows; may be undefined)
 * @param homeDir  - resolved homedir() value
 */
export function resolveClaudeDesktopPaths(
  platform: string,
  appdata: string | undefined,
  homeDir: string,
): { dir: string; configPath: string } {
  if (platform === "win32") {
    const base = appdata ?? join(homeDir, "AppData", "Roaming");
    const dir = join(base, "Claude");
    return { dir, configPath: join(dir, "claude_desktop_config.json") };
  }
  // darwin (Linux is unsupported — available() returns false before this is called)
  const dir = join(homeDir, "Library", "Application Support", "Claude");
  return { dir, configPath: join(dir, "claude_desktop_config.json") };
}

/**
 * Adapter for Claude Desktop (darwin + win32).
 *
 * Config paths:
 *   macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json
 *   Windows: %APPDATA%\Claude\claude_desktop_config.json
 *            (falls back to ~/AppData/Roaming/Claude/ when APPDATA is unset)
 *
 * The file also holds globalShortcut, preferences, isUsingBuiltInNodeForMcp — preserved.
 * Remote servers are skipped (Claude Desktop does not support them).
 * available() returns false on Linux and other unsupported platforms.
 */
export const claudeDesktopAdapter = createJsonAdapter({
  id: "claude-desktop",
  label: "Claude Desktop",
  // Claude Desktop is stdio-only; remote MCP servers are not natively supported.
  acceptsRemote: false,
  configPath() {
    return resolveClaudeDesktopPaths(process.platform, process.env.APPDATA, homedir()).configPath;
  },
  available() {
    if (process.platform !== "darwin" && process.platform !== "win32") return false;
    return existsSync(
      resolveClaudeDesktopPaths(process.platform, process.env.APPDATA, homedir()).dir,
    );
  },
  mcpKey: "mcpServers",
  toNativeEntry,
  onSkipped,
});
