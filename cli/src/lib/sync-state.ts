import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ResolvedLinkMode } from "./fs-link.js";

export interface SyncMirror {
  target: string; // path relative to project root
  mode: ResolvedLinkMode;
  createdAt: string;
  updatedAt?: string;
}

export interface SyncState {
  version: number;
  canonical: string; // path relative to project root
  mirrors: SyncMirror[];
}

export const STATE_VERSION = 1;
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
    return {
      version: raw.version,
      canonical: raw.canonical,
      mirrors: raw.mirrors as SyncMirror[],
    };
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
