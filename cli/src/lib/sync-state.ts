import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ResolvedLinkMode } from "./fs-link.js";

export interface SyncMirror {
  target: string; // path relative to project root
  mode: ResolvedLinkMode;
  createdAt: string;
  updatedAt?: string;
}

export interface McpHostSyncInfo {
  managed: string[]; // server names managed by skdd for this host
  lastSync: string; // ISO timestamp
}

export interface SyncState {
  version: number;
  canonical: string; // path relative to project root
  mirrors: SyncMirror[];
  mcp?: { hosts: Record<string, McpHostSyncInfo> }; // keyed by McpHostId
}

export const STATE_VERSION = 2;
const STATE_FILE = ".skdd-sync.json";

export function statePath(cwd: string): string {
  return join(resolve(cwd), STATE_FILE);
}

export function emptyState(canonical = "skills"): SyncState {
  return { version: STATE_VERSION, canonical, mirrors: [] };
}

export function loadState(cwd: string): SyncState | null {
  const p = statePath(cwd);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<SyncState>;
    if (typeof raw.version !== "number" || !raw.canonical || !Array.isArray(raw.mirrors)) {
      return null;
    }
    const state: SyncState = {
      version: STATE_VERSION,
      canonical: raw.canonical,
      mirrors: raw.mirrors as SyncMirror[],
    };
    if (raw.mcp !== undefined) {
      const rawMcp = raw.mcp as Record<string, unknown>;
      const rawHosts = rawMcp["hosts"];
      if (rawHosts !== null && typeof rawHosts === "object" && !Array.isArray(rawHosts)) {
        const hosts: Record<string, McpHostSyncInfo> = {};
        for (const [hostId, hostVal] of Object.entries(rawHosts as Record<string, unknown>)) {
          if (hostVal !== null && typeof hostVal === "object" && !Array.isArray(hostVal)) {
            const h = hostVal as Record<string, unknown>;
            const rawManaged = h["managed"];
            const managed = Array.isArray(rawManaged)
              ? (rawManaged as unknown[]).filter((s): s is string => typeof s === "string")
              : [];
            const lastSync =
              typeof h["lastSync"] === "string" ? h["lastSync"] : new Date().toISOString();
            hosts[hostId] = { managed, lastSync };
          }
        }
        state.mcp = { hosts };
      } else {
        state.mcp = { hosts: {} };
      }
    }
    return state;
  } catch {
    return null;
  }
}

export function saveState(cwd: string, state: SyncState): void {
  writeFileSync(statePath(cwd), JSON.stringify(state, null, 2) + "\n");
}

export function upsertMirror(state: SyncState, target: string, mode: ResolvedLinkMode): SyncState {
  const now = new Date().toISOString();
  const existing = state.mirrors.find((m) => m.target === target);
  if (existing) {
    existing.mode = mode;
    existing.updatedAt = now;
  } else {
    state.mirrors.push({ target, mode, createdAt: now });
  }
  return state;
}

export function removeMirror(state: SyncState, target: string): SyncState {
  state.mirrors = state.mirrors.filter((m) => m.target !== target);
  return state;
}
