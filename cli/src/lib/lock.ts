import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * `.skdd-lock.json` — full-fidelity provenance for skills installed via `skdd add`.
 * The registry's Source column carries the human-readable short form
 * (`owner/repo@shortsha (drop)`); the lock file keeps the full sha so
 * `skdd doctor` can later detect upstream drift.
 */
export interface LockEntry {
  source: string; // owner/repo, git URL, or local path label
  drop: string;
  sha: string | null; // full commit sha of the source at add time
  addedAt: string; // ISO timestamp
}

export interface LockFile {
  version: number;
  skills: Record<string, LockEntry>;
}

export const LOCK_VERSION = 1;
const LOCK_FILE = ".skdd-lock.json";

export function lockPath(cwd: string): string {
  return join(resolve(cwd), LOCK_FILE);
}

export function loadLock(cwd: string): LockFile {
  const p = lockPath(cwd);
  if (!existsSync(p)) return { version: LOCK_VERSION, skills: {} };
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<LockFile>;
    if (typeof raw.skills !== "object" || raw.skills === null) {
      return { version: LOCK_VERSION, skills: {} };
    }
    return { version: LOCK_VERSION, skills: raw.skills as Record<string, LockEntry> };
  } catch {
    return { version: LOCK_VERSION, skills: {} };
  }
}

export function saveLock(cwd: string, lock: LockFile): void {
  writeFileSync(lockPath(cwd), JSON.stringify(lock, null, 2) + "\n");
}

export function upsertLockEntry(cwd: string, name: string, entry: LockEntry): void {
  const lock = loadLock(cwd);
  lock.skills[name] = entry;
  saveLock(cwd, lock);
}
