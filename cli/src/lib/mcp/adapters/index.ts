import type { McpHostId } from "../schema.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { claudeDesktopAdapter } from "./claude-desktop.js";
import { cursorAdapter } from "./cursor.js";
import { droidAdapter } from "./droid.js";
import { geminiAdapter } from "./gemini.js";
import { opencodeAdapter } from "./opencode.js";
import type { McpHostAdapter } from "./types.js";

export type {
  HostApplyResult,
  HostApplyResultErr,
  HostApplyResultOk,
  HostReadErr,
  HostReadOk,
  HostReadResult,
  HostSyncPlan,
  HostSyncPlanErr,
  HostSyncPlanOk,
  McpHostAdapter,
  ServerChange,
} from "./types.js";

/**
 * Registry of available MCP host adapters keyed by host ID.
 *
 * Partial because the codex adapter (TOML-based) is added by a separate
 * feature (f-m2-mcp-codex).  Callers must guard: `ADAPTERS[id] != null`.
 */
export const ADAPTERS: Partial<Record<McpHostId, McpHostAdapter>> = {
  "claude-code": claudeCodeAdapter,
  "claude-desktop": claudeDesktopAdapter,
  // codex: added in f-m2-mcp-codex (TOML block-splice adapter)
  droid: droidAdapter,
  cursor: cursorAdapter,
  opencode: opencodeAdapter,
  gemini: geminiAdapter,
};
