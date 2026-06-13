import { ensureGlobalColony, skddHome } from "../lib/global.js";
import { logger } from "../lib/logger.js";
import { ADAPTERS } from "../lib/mcp/adapters/index.js";
import { isIntendedForHost } from "../lib/mcp/intent.js";
import {
  type CanonicalMcpConfig,
  expandEnvPlaceholders,
  isStdio,
  loadMcpConfigResult,
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
  const loadResult = loadMcpConfigResult(home);

  // Fail closed: corrupt canonical must never silently appear as empty.
  if (loadResult.status === "invalid") {
    logger.error(`mcp.json is invalid: ${loadResult.reason}`);
    return 1;
  }

  const config = loadResult.status === "ok" ? loadResult.config : null;

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
  if (opts.headers && Object.keys(opts.headers).length > 0 && opts.command) {
    logger.error(
      "--headers is only valid for remote servers (--url). Stdio servers do not support request headers.",
    );
    return 1;
  }
  if (opts.hosts && opts.hosts.length > 0) {
    const invalid = opts.hosts.filter((h) => !MCP_HOST_IDS.includes(h));
    if (invalid.length > 0) {
      logger.error(
        `Unknown host ID(s): ${invalid.join(", ")}. Valid IDs: ${MCP_HOST_IDS.join(", ")}.`,
      );
      return 1;
    }
  }

  ensureGlobalColony();
  const home = skddHome();
  const loadResult = loadMcpConfigResult(home);
  if (loadResult.status === "invalid") {
    logger.error(`mcp.json is invalid: ${loadResult.reason}. Fix it before adding servers.`);
    return 1;
  }
  const existing =
    loadResult.status === "ok" ? loadResult.config : { version: 1 as const, servers: {} };

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
  const loadResult = loadMcpConfigResult(home);

  if (loadResult.status === "invalid") {
    logger.error(`mcp.json is invalid: ${loadResult.reason}. Fix it before removing servers.`);
    return 1;
  }

  if (loadResult.status === "absent") {
    logger.error("No mcp.json found. Nothing to remove.");
    return opts.force ? 0 : 1;
  }

  const config = loadResult.config;

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
  if (!opts.dryRun) {
    ensureGlobalColony();
  }
  const home = skddHome();
  const loadResult = loadMcpConfigResult(home);

  // Fail closed: if the canonical file exists but is invalid, abort immediately.
  // Do NOT plan removals — a corrupt file must not trigger mass deletion of managed entries.
  if (loadResult.status === "invalid") {
    logger.error(`mcp.json is invalid: ${loadResult.reason}. Fix it before syncing.`);
    return 1;
  }

  const config = loadResult.status === "ok" ? loadResult.config : null;

  // Load state before the early-exit check so we can detect managed names
  // that require cleanup even when the canonical config is empty.
  let state = loadState(home) ?? emptyState();

  const canonicalIsEmpty = !config || Object.keys(config.servers).length === 0;
  if (canonicalIsEmpty) {
    // Only skip if there are no managed names to clean up.
    const hasManagedNames = MCP_HOST_IDS.some((id) => getMcpManagedNames(state, id).length > 0);
    if (!hasManagedNames) {
      logger.info("No MCP servers configured. Use `skdd mcp add <name>` to add one.");
      return 0;
    }
    // Fall through: run removal planning to delete stale managed entries from host configs.
  }

  // Use an empty-servers config when canonical file is absent — adapters will
  // generate remove ops for any name that is managed-but-not-canonical.
  const effectiveConfig: CanonicalMcpConfig = config ?? { version: 1, servers: {} };

  let exitCode = 0;
  let stateChanged = false;

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
    // Track managed servers whose expansion failed so we can preserve their
    // host entries instead of letting the adapter plan a removal for them.
    const expansionFailedManaged = new Set<string>();
    for (const [name, server] of Object.entries(effectiveConfig.servers)) {
      if (isDroid) {
        // Droid natively supports ${VAR} — write placeholders through as-is.
        resolvedServers[name] = server;
      } else {
        const { resolved, unresolved } = expandServerVars(server);
        if (unresolved.length > 0) {
          if (managed.includes(name)) {
            // A managed server is 'intended for removal/omission on this host' ONLY IF:
            //   - the server is host-excluded by the hosts allowlist, OR
            //   - the server is disabled AND this adapter omits disabled entries
            //     (claude-code/claude-desktop/cursor/gemini: omitsDisabled=true)
            // In all other cases — including disabled servers on native-persist hosts
            // (droid/opencode/codex: omitsDisabled=false) — preserve the existing
            // entry.  A transient unset env var must never trigger destructive removal.
            if (isIntendedForHost(server, hostId, adapter)) {
              // Still intended (or disabled-on-native-persist-host): keep the existing
              // entry.  Do NOT let a transient unset env var trigger destructive removal.
              logger.warn(
                `[${hostId}] Skipping update for "${name}": unresolved env vars: ${unresolved.join(", ")} (existing entry preserved)`,
              );
              expansionFailedManaged.add(name);
            } else {
              // Host-excluded or disabled-on-omitting-host: removal/omission is intended.
              // Removal does not need resolved env values — let the adapter plan it.
              logger.warn(
                `[${hostId}] Skipping "${name}": unresolved env vars: ${unresolved.join(", ")}`,
              );
            }
          } else {
            logger.warn(
              `[${hostId}] Skipping "${name}": unresolved env vars: ${unresolved.join(", ")}`,
            );
          }
          continue;
        }
        resolvedServers[name] = resolved;
      }
    }

    const resolvedConfig: CanonicalMcpConfig = { version: 1, servers: resolvedServers };
    // Exclude expansion-failed managed names from the managed list so the
    // adapter does not plan a removal for them.
    const effectiveManaged = managed.filter((m) => !expansionFailedManaged.has(m));

    // Skip hosts with nothing to do: no intended servers AND no managed cleanup.
    // A host is relevant iff it has intended servers (not excluded by the
    // per-server hosts allowlist) OR managed names that need removal.
    // Irrelevant hosts must not be parsed — a malformed config on an untargeted
    // host must not cause sync to exit 1.
    const hasIntendedServers = Object.values(resolvedConfig.servers).some(
      (server) => !server.hosts || server.hosts.includes(hostId),
    );
    if (!hasIntendedServers && effectiveManaged.length === 0) {
      continue;
    }

    const plan = adapter.plan(resolvedConfig, effectiveManaged);

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

    // Reconcile managed names in the in-memory state.
    // The right discriminant is what the adapter ACTUALLY DID: a managed server
    // remains managed iff it is still PRESENT in the host config after sync.
    // Removal (removedByPlan) and omission (omittedByPlan) both signal absence;
    // everything else is still present and should stay managed.
    //
    // Adapters track omitted[] for ALL absence cases:
    //   • toNativeEntry returns null AND host entry was already absent (disabled/unsupported)
    //   • allowlist excludes this host AND host entry was already absent
    //   • server removed from canonical AND host entry was already absent
    // This replaces the previous activeForHost approach, which was based on the
    // disabled flag and incorrectly purged managed state on hosts that NATIVELY
    // PERSIST disabled entries (droid disabled:true, opencode enabled:false,
    // codex enabled=false) — losing ownership and preventing later safe removal.
    {
      const removedByPlan = new Set(
        plan.changes.filter((c) => c.op === "remove").map((c) => c.name),
      );
      const addedByPlan = plan.changes
        .filter((c) => c.op === "add" || c.op === "update")
        .map((c) => c.name);
      // Names whose host entry is confirmed absent after this sync (adapter
      // intentionally did not write them and reported them as omitted).
      const omittedByPlan = new Set(plan.omitted ?? []);

      const newManaged = [
        // Keep previously managed names that are still PRESENT in the host config:
        // neither removed by the adapter nor confirmed absent (omitted).
        // expansionFailedManaged servers are neither removed nor omitted (the adapter
        // never saw them, so the preserved host entry stays) — they pass this filter
        // and remain managed so the entry can be updated when the var is later set.
        ...managed.filter((m) => !removedByPlan.has(m) && !omittedByPlan.has(m)),
        // Add names newly written by this sync that weren't tracked before.
        ...addedByPlan.filter((n) => !managed.includes(n)),
      ];

      const oldSet = new Set(managed);
      const newSet = new Set(newManaged);
      const changed = oldSet.size !== newSet.size || [...oldSet].some((n) => !newSet.has(n));
      if (changed) {
        state = setMcpManagedNames(state, hostId, newManaged);
        stateChanged = true;
      }
    }
  }

  // Persist the updated state only when something actually changed.
  // Skipping the write on a true no-op prevents mtime churn on .skdd-sync.json.
  if (!opts.dryRun && stateChanged) {
    saveState(home, state);
  }

  return exitCode;
}

// -- Shared env-expansion helper ----------------------------------------------

// -- collectMcpPlanLines -------------------------------------------------------

/**
 * Compute the MCP dry-run plan and return it as an array of human-readable
 * lines, without printing anything to stdout/stderr. Used by the hub TUI to
 * render the plan inside the MCP pane rather than behind the TUI output.
 */
export async function collectMcpPlanLines(): Promise<string[]> {
  const home = skddHome();
  const loadResult = loadMcpConfigResult(home);

  // Fail closed: surface invalid config as an error line (hub must not crash).
  if (loadResult.status === "invalid") {
    return [`[error] mcp.json is invalid: ${loadResult.reason}`];
  }

  const config = loadResult.status === "ok" ? loadResult.config : null;
  const state = loadState(home) ?? emptyState();

  const canonicalIsEmpty = !config || Object.keys(config.servers).length === 0;
  if (canonicalIsEmpty) {
    const hasManagedNames = MCP_HOST_IDS.some((id) => getMcpManagedNames(state, id).length > 0);
    if (!hasManagedNames) {
      return ["No MCP servers configured."];
    }
  }

  const effectiveConfig: CanonicalMcpConfig = config ?? { version: 1, servers: {} };
  const lines: string[] = [];

  for (const hostId of MCP_HOST_IDS) {
    const adapter = ADAPTERS[hostId];
    if (!adapter) continue;

    if (!adapter.available()) {
      lines.push(`[${hostId}] skipped (unavailable)`);
      continue;
    }

    const managed = getMcpManagedNames(state, hostId);
    const isDroid = hostId === "droid";

    const resolvedServers: Record<string, McpServer> = {};
    // Mirror the same expansionFailedManaged logic as runMcpSync so the hub
    // dry-run preview matches actual sync behavior exactly.
    const expansionFailedManaged = new Set<string>();
    for (const [name, server] of Object.entries(effectiveConfig.servers)) {
      if (isDroid) {
        resolvedServers[name] = server;
      } else {
        const { resolved, unresolved } = expandServerVars(server);
        if (unresolved.length > 0) {
          if (managed.includes(name) && isIntendedForHost(server, hostId, adapter)) {
            // Still intended (or disabled-on-native-persist-host): keep the existing
            // entry. Do NOT let a transient unset env var trigger a removal line.
            expansionFailedManaged.add(name);
          } else {
            lines.push(`[${hostId}] skip "${name}": unresolved ${unresolved.join(", ")}`);
          }
          continue;
        }
        resolvedServers[name] = resolved;
      }
    }

    const resolvedConfig: CanonicalMcpConfig = { version: 1, servers: resolvedServers };
    // Exclude expansion-failed managed names so the adapter does not plan
    // a removal for them (matching runMcpSync's effectiveManaged logic).
    const effectiveManaged = managed.filter((m) => !expansionFailedManaged.has(m));
    const plan = adapter.plan(resolvedConfig, effectiveManaged);

    if (!plan.ok) {
      lines.push(`[${hostId}] blocked: ${plan.reason}`);
      continue;
    }

    if (plan.changes.length === 0) {
      lines.push(`[${hostId}] no changes`);
    } else {
      for (const c of plan.changes) {
        const sym = c.op === "add" ? "+" : c.op === "remove" ? "-" : "~";
        lines.push(`[${hostId}] ${sym} ${c.name}`);
      }
    }
    for (const w of plan.warnings) {
      lines.push(`[${hostId}] warn: ${w}`);
    }
  }

  return lines;
}
