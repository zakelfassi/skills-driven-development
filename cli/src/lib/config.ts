import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { skddHome } from "./global.js";

/** User-level skdd configuration, read from ~/.skdd/config.toml. */
export interface SkddConfig {
  /** Default Commons repo (`owner/repo`) for `skdd push`, `skdd drops`, and bare `skdd add`. */
  commons: string;
}

export const DEFAULT_COMMONS = "zakelfassi/skdd-commons";

export function configPath(): string {
  return join(skddHome(), "config.toml");
}

export function loadConfig(): SkddConfig {
  const defaults: SkddConfig = { commons: DEFAULT_COMMONS };
  const p = configPath();
  if (!existsSync(p)) return defaults;
  // A present-but-broken config is a user error, not "no config" — surface it,
  // so a typo in a configured private Commons doesn't silently target the default.
  let raw: Record<string, unknown>;
  try {
    raw = parseToml(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Malformed ${p}: ${(err as Error).message}`);
  }
  return {
    commons: typeof raw["commons"] === "string" ? (raw["commons"] as string) : defaults.commons,
  };
}
