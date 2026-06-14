/**
 * Regression guard: ensures the `skdd sync` stub command stays removed.
 *
 * The sync command was a never-implemented stub (always exited 2).
 * This test ensures it cannot be silently re-introduced.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

describe("skdd sync removal", () => {
  it("sync.ts command file no longer exists", () => {
    const syncFile = resolve(ROOT, "src/commands/sync.ts");
    expect(existsSync(syncFile)).toBe(false);
  });

  it("index.ts does not import runSync", () => {
    const indexSrc = readFileSync(resolve(ROOT, "src/index.ts"), "utf8");
    expect(indexSrc).not.toMatch(/runSync/);
  });

  it("index.ts does not register a top-level sync command", () => {
    const indexSrc = readFileSync(resolve(ROOT, "src/index.ts"), "utf8");
    // Guard only against the top-level `program.command("sync")` stub being re-introduced.
    // Sub-commands like `mcp.command("sync")` are intentional and allowed.
    expect(indexSrc).not.toMatch(/program\.command\(["']sync["']\)/);
  });

  it("README.md does not reference the sync command or stub", () => {
    const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");
    expect(readme).not.toMatch(/skdd sync/);
    expect(readme).not.toMatch(/### `skdd sync`/);
  });
});
