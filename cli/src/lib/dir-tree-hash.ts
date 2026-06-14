import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

/**
 * Compute a deterministic hash of a directory tree's structure and content.
 *
 * Hashed elements:
 *   - Files (path + content)
 *   - Symlinks (path + link target)
 *   - Directory presence, including empty directories (path marker emitted before recursion)
 *   - Any unsupported/special entry (block device, char device, socket, FIFO, etc.) causes
 *     the result to be randomised so the directory is NEVER considered identical to another;
 *     the bias is always "when in doubt, do not delete".
 *
 * Returns a 16-char hex digest.
 */
export function dirTreeHash(dir: string): string {
  const hash = createHash("sha256");
  let hasSpecialEntry = false;

  function walk(d: string, rel: string) {
    const entries = readdirSync(d, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      const entryAbs = join(d, entry.name);
      if (entry.isDirectory()) {
        // Emit a dir marker so that an empty directory is distinguished from its absence.
        hash.update(`dir:${entryRel}\n`);
        walk(entryAbs, entryRel);
      } else if (entry.isSymbolicLink()) {
        const target = readlinkSync(entryAbs);
        hash.update(`symlink:${entryRel}\n${target}\n`);
      } else if (entry.isFile()) {
        hash.update(`file:${entryRel}\n`);
        hash.update(readFileSync(entryAbs));
        hash.update("\n");
      } else {
        // Unsupported entry type (block/char device, socket, FIFO, etc.).
        // Mark as non-comparable; the dir must be preserved for manual review.
        hasSpecialEntry = true;
      }
    }
  }

  walk(dir, "");

  if (hasSpecialEntry) {
    // Hash in random bytes to guarantee the digest is unique and can never match
    // any other directory, including itself on a second call.
    hash.update(randomBytes(16));
  }

  return hash.digest("hex").slice(0, 16);
}
