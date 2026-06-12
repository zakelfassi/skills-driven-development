import {
  emptyState,
  loadState,
  type McpHostSyncInfo,
  type SyncState,
  saveState,
} from "../sync-state.js";
import type { McpHostId } from "./schema.js";

export type { McpHostSyncInfo };

/**
 * Return the list of server names that skdd currently manages for a given host.
 * Returns an empty array if no mcp state exists yet for that host.
 */
export function getMcpManagedNames(state: SyncState, hostId: McpHostId): string[] {
  return state.mcp?.hosts[hostId]?.managed ?? [];
}

/**
 * Return a new SyncState with the managed names for `hostId` updated.
 */
export function setMcpManagedNames(
  state: SyncState,
  hostId: McpHostId,
  names: string[],
  lastSync = new Date().toISOString(),
): SyncState {
  const hosts = { ...(state.mcp?.hosts ?? {}) };
  hosts[hostId] = { managed: names, lastSync };
  return { ...state, mcp: { hosts } };
}

/**
 * Load the mcp managed-names for `hostId` from the state file in `dir`.
 * Returns an empty array when the state file does not exist or has no mcp section.
 */
export function loadMcpManagedNames(dir: string, hostId: McpHostId): string[] {
  const state = loadState(dir);
  if (!state) return [];
  return getMcpManagedNames(state, hostId);
}

/**
 * Persist the managed names for `hostId` to the state file in `dir`.
 * Reads the current state first so other fields are preserved.
 */
export function saveMcpManagedNames(dir: string, hostId: McpHostId, names: string[]): void {
  const state = loadState(dir) ?? emptyState();
  const updated = setMcpManagedNames(state, hostId, names);
  saveState(dir, updated);
}
