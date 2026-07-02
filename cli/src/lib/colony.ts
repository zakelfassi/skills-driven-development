import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The canonical skills directory for a colony root: `.colony.json`'s
 * `canonicalSkillsDir` when set, else the default `skills`. Shared by add/push
 * so both honor a project that uses e.g. `playbooks/` as its canonical dir.
 */
export function canonicalDirName(root: string): string {
  const p = join(root, ".colony.json");
  if (!existsSync(p)) return "skills";
  try {
    const manifest = JSON.parse(readFileSync(p, "utf8")) as { canonicalSkillsDir?: string };
    if (typeof manifest.canonicalSkillsDir === "string" && manifest.canonicalSkillsDir.length > 0) {
      return manifest.canonicalSkillsDir;
    }
  } catch {
    // malformed .colony.json is doctor's concern, not ours
  }
  return "skills";
}
