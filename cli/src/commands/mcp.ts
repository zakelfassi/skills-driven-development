import { ensureGlobalColony, skddHome } from "../lib/global.js";
import { logger } from "../lib/logger.js";
import {
  type CanonicalMcpConfig,
  loadMcpConfig,
  type McpHostId,
  type McpServer,
  type McpServerRemote,
  type McpServerStdio,
  saveMcpConfig,
  validateMcpConfig,
} from "../lib/mcp/schema.js";

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
