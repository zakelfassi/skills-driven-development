import { logger } from "../lib/logger.js";

export interface SyncOptions {
  cwd?: string;
}

/**
 * `skdd sync` — pull skills from a remote registry URL into the local colony.
 *
 * Intentionally stubbed until the federated discovery protocol lands.
 * Tracked in the colony/discovery.md roadmap as "Option 3: Agent-to-agent sharing".
 */
export async function runSync(_url: string | undefined, _opts: SyncOptions = {}): Promise<number> {
  logger.warn("`skdd sync` is not yet implemented.");
  logger.dim(
    "Federated colony sync is on the roadmap. For now, fork skills manually or clone a colony repo.",
  );
  logger.dim("Track progress: https://github.com/zakelfassi/skills-driven-development/issues");
  return 2;
}
