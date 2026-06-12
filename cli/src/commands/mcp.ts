import { ensureGlobalColony, skddHome } from "../lib/global.js";
import { logger } from "../lib/logger.js";
import { ADAPTERS } from "../lib/mcp/adapters/index.js";
import {
  type CanonicalMcpConfig,
  expandEnvPlaceholders,
  isStdio,
  loadMcpConfig,
  MCP_HOST_IDS,
  type McpHostId,
  type McpServer,
  type McpServerRemote,
  type McpServerStdio,
  saveMcpConfig,
  validateMcpConfig,
} from "../lib/mcp/schema.js";
import { getMcpManagedNames, setMcpManagedNames } from "../lib/mcp/state.js";
import { emptyState, loadState, saveState } from "../lib/sync-state.js";

export interface McpListOptions {
  format?: "table" | "json";
}

export async function runMcpList(opts: McpListOptions = {}): Promise<number> {
  ensureGlobalColony();
  const home = skddHome();
  const config = loadMcpConfig(home);

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify(config ?? { version: 1, servers: {} }, null, 2) + "\n");
    return 0;
  }

  if (!config || Object.keys(config.servers).length === 0) {
    logger.info("No MCP servers configured. Use `skdd mcp add <name>` to add one.");
    return 0;
  }

  const entries = Object.entries(config.servers);
  const maxLen = Math.max(...entries.map(([n]) => n.length));

  for (const [name, srv] of entries) {
    const padded = name.padEnd(maxLen);
    const status = srv.disabled ? " [disabled]" : "";
    const hosts = srv.hosts ? ` [hosts: ${srv.hosts.join(", ")}]` : "";
    if ("command" in srv) {
      const s = srv as McpServerStdio;
      const cmd = [s.command, ...(s.args ?? [])].join(" ");
      logger.info(`  ${padded}  stdio  ${cmd}${status}${hosts}`);
    } else {
      const s = srv as McpServerRemote;
      logger.info(`  ${padded}  ${s.type ?? "remote"}  ${s.url}${status}${hosts}`);
    }
  }
  return 0;
}

export interface McpAddOptions {
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // remote
  url?: string;
  type?: "http" | "sse";
  headers?: Record<string, string>;
  // common
  hosts?: McpHostId[];
  disabled?: boolean;
  force?: boolean;
}

export async function runMcpAdd(name: string, opts: McpAddOptions = {}): Promise<number> {
  if (!name || name.trim().length === 0) {
    logger.error("Server name is required.");
    return 1;
  }
  if (opts.command && opts.url) {
    logger.error("Specify either --command or --url, not both.");
    return 1;
  }
  if (!opts.command && !opts.url) {
    logger.error("Either --command (stdio) or --url (remote) is required.");
    return 1;
  }

  ensureGlobalColony();
  const home = skddHome();
  const existing = loadMcpConfig(home) ?? { version: 1 as const, servers: {} };

  if (name in existing.servers && !opts.force) {
    logger.error(`Server "${name}" already exists. Use --force to overwrite.`);
    return 1;
  }

  let srv: McpServer;
  if (opts.command) {
    const s: McpServerStdio = { command: opts.command };
    if (opts.args?.length) s.args = opts.args;
    if (opts.env && Object.keys(opts.env).length) s.env = opts.env;
    if (opts.hosts?.length) s.hosts = opts.hosts;
    if (opts.disabled) s.disabled = opts.disabled;
    srv = s;
  } else {
    const s: McpServerRemote = { url: opts.url! };
    if (opts.type) s.type = opts.type;
    if (opts.headers && Object.keys(opts.headers).length) s.headers = opts.headers;
    if (opts.hosts?.length) s.hosts = opts.hosts;
    if (opts.disabled) s.disabled = opts.disabled;
    srv = s;
  }

  const updated: CanonicalMcpConfig = {
    version: 1,
    servers: { ...existing.servers, [name]: srv },
  };

  const validation = validateMcpConfig(updated);
  if (!validation.ok) {
    for (const e of validation.errors) logger.error(e.message);
    return 1;
  }

  saveMcpConfig(home, updated);
  logger.info(`Added MCP server "${name}".`);
  return 0;
}

export interface McpRemoveOptions {
  force?: boolean;
}

export async function runMcpRemove(name: string, opts: McpRemoveOptions = {}): Promise<number> {
  if (!name || name.trim().length === 0) {
    logger.error("Server name is required.");
    return 1;
  }

  ensureGlobalColony();
  const home = skddHome();
  const config = loadMcpConfig(home);

  if (!config) {
    logger.error("No mcp.json found. Nothing to remove.");
    return opts.force ? 0 : 1;
  }

  if (!(name in config.servers)) {
    logger.error(`Server "${name}" not found in mcp.json.`);
    return opts.force ? 0 : 1;
  }

  const { [name]: _removed, ...rest } = config.servers;
  const updated: CanonicalMcpConfig = { version: 1, servers: rest };
  saveMcpConfig(home, updated);
  logger.info(`Removed MCP server "${name}".`);
  return 0;
}

// -- Sync helpers -------------------------------------------------------------

/**
 * Expand `${VAR}` placeholders in an MCP server's env, url, and headers.
 * Returns the resolved server and any variable names that could not be resolved.
 * Does NOT mutate the original server.
 */
function expandServerVars(server: McpServer): { resolved: McpServer; unresolved: string[] } {
  const allUnresolved: string[] = [];

  if (isStdio(server)) {
    const resolved: McpServerStdio = { command: server.command };
    if (server.args?.length) resolved.args = server.args;
    if (server.env && Object.keys(server.env).length > 0) {
      const expandedEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(server.env)) {
        const { value, unresolved } = expandEnvPlaceholders(v);
        expandedEnv[k] = value;
        allUnresolved.push(...unresolved);
      }
      resolved.env = expandedEnv;
    }
    if (server.hosts?.length) resolved.hosts = server.hosts;
    if (server.disabled !== undefined) resolved.disabled = server.disabled;
    return { resolved, unresolved: allUnresolved };
  }

  // Remote server
  const { value: expandedUrl, unresolved: urlUnresolved } = expandEnvPlaceholders(server.url);
  allUnresolved.push(...urlUnresolved);
  const resolved: McpServerRemote = { url: expandedUrl };
  if (server.type) resolved.type = server.type;
  if (server.headers && Object.keys(server.headers).length > 0) {
    const expandedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(server.headers)) {
      const { value, unresolved } = expandEnvPlaceholders(v);
      expandedHeaders[k] = value;
      allUnresolved.push(...unresolved);
    }
    resolved.headers = expandedHeaders;
  }
  if (server.hosts?.length) resolved.hosts = server.hosts;
  if (server.disabled !== undefined) resolved.disabled = server.disabled;
  return { resolved, unresolved: allUnresolved };
}

// -- runMcpSync ---------------------------------------------------------------

export interface McpSyncOptions {
  dryRun?: boolean;
}

/**
 * Orchestrate syncing the canonical mcp.json to all available host adapters.
 *
 * For each available host:
 *   1. Expand ${VAR} in env/url/headers (skip server + warn if unresolved,
 *      except for droid which handles ${VAR} natively and receives as-is).
 *   2. Call adapter.plan() with the resolved canonical + current managed names.
 *      If the host config is malformed → log error, set exit 1, continue.
 *   3. If --dry-run: print plan, no writes.
 *   4. Otherwise: call adapter.apply(); update managed names in sync-state.
 *
 * Canonical file is never modified; secrets never copied back from host files.
 * Exits 1 if any host was blocked (malformed config), 0 otherwise.
 */
export async function runMcpSync(opts: McpSyncOptions = {}): Promise<number> {
  ensureGlobalColony();
  const home = skddHome();
  const config = loadMcpConfig(home);

  if (!config || Object.keys(config.servers).length === 0) {
    logger.info("No MCP servers configured. Use `skdd mcp add <name>` to add one.");
    return 0;
  }

  let exitCode = 0;
  // Load state once; we accumulate mcp host updates in memory then save once.
  let state = loadState(home) ?? emptyState();

  for (const hostId of MCP_HOST_IDS) {
    const adapter = ADAPTERS[hostId];
    if (!adapter) continue;

    if (!adapter.available()) {
      logger.info(`[${hostId}] skipped (host not available)`);
      continue;
    }

    const managed = getMcpManagedNames(state, hostId);
    const isDroid = hostId === "droid";

    // Build the canonical config for this host, expanding vars where needed.
    const resolvedServers: Record<string, McpServer> = {};
    for (const [name, server] of Object.entries(config.servers)) {
      if (isDroid) {
        // Droid natively supports ${VAR} — write placeholders through as-is.
        resolvedServers[name] = server;
      } else {
        const { resolved, unresolved } = expandServerVars(server);
        if (unresolved.length > 0) {
          logger.warn(
            `[${hostId}] Skipping "${name}": unresolved env vars: ${unresolved.join(", ")}`,
          );
          continue;
        }
        resolvedServers[name] = resolved;
      }
    }

    const resolvedConfig: CanonicalMcpConfig = { version: 1, servers: resolvedServers };
    const plan = adapter.plan(resolvedConfig, managed);

    if (!plan.ok) {
      logger.error(`[${hostId}] blocked: ${plan.reason}`);
      exitCode = 1;
      continue;
    }

    // Print the plan changes.
    if (plan.changes.length === 0) {
      logger.info(`[${hostId}] no changes`);
    } else {
      for (const c of plan.changes) {
        const sym = c.op === "add" ? "+" : c.op === "remove" ? "-" : "~";
        logger.info(`[${hostId}] ${sym} ${c.name}`);
      }
    }
    for (const w of plan.warnings) {
      logger.warn(`[${hostId}] ${w}`);
    }

    if (opts.dryRun) continue;

    const applyResult = adapter.apply(plan);
    if (!applyResult.ok) {
      logger.error(`[${hostId}] apply failed: ${applyResult.reason}`);
      exitCode = 1;
      continue;
    }

    // Update managed names in the in-memory state.
    if (plan.changes.length > 0) {
      const removed = new Set(plan.changes.filter((c) => c.op === "remove").map((c) => c.name));
      const addedOrUpdated = plan.changes
        .filter((c) => c.op === "add" || c.op === "update")
        .map((c) => c.name);
      const newManaged = [
        ...managed.filter((m) => !removed.has(m)),
        ...addedOrUpdated.filter((n) => !managed.includes(n)),
      ];
      state = setMcpManagedNames(state, hostId, newManaged);
    }
  }

  // Persist the updated state once (no-op on dry-run).
  if (!opts.dryRun) {
    saveState(home, state);
  }

  return exitCode;
}
