import type { McpHostId } from "../schema.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { claudeDesktopAdapter } from "./claude-desktop.js";
import { codexAdapter } from "./codex.js";
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
 * Registry of all MCP host adapters keyed by host ID.
 *
 * Callers should guard: `ADAPTERS[id] != null` since the registry is typed
 * as Partial to allow future additions.
 */
export const ADAPTERS: Partial<Record<McpHostId, McpHostAdapter>> = {
  "claude-code": claudeCodeAdapter,
  "claude-desktop": claudeDesktopAdapter,
  codex: codexAdapter,
  droid: droidAdapter,
  cursor: cursorAdapter,
  opencode: opencodeAdapter,
  gemini: geminiAdapter,
};
