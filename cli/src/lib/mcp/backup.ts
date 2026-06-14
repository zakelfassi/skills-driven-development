import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/**
 * Create a rolling `.bak` copy of `filePath` before the first write in a sync run.
 * No-op when the source file does not yet exist.
 */
export function backupFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  copyFileSync(filePath, `${filePath}.bak`);
}

/**
 * Atomic write: write `content` to a temp file in the same directory, then
 * rename it over `filePath`.  On POSIX and NTFS same-volume renames are atomic.
 */
export function atomicWrite(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmp = join(dir, `.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  try {
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, filePath);
  } catch (err) {
    // Clean up tmp on failure (best-effort)
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // ignore
    }
    throw err;
  }
}
