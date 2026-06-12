import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "./backup.js";

export type McpHostId =
  | "claude-code"
  | "claude-desktop"
  | "codex"
  | "droid"
  | "cursor"
  | "opencode"
  | "gemini";

export const MCP_HOST_IDS: McpHostId[] = [
  "claude-code",
  "claude-desktop",
  "codex",
  "droid",
  "cursor",
  "opencode",
  "gemini",
];

export const MCP_CONFIG_FILE = "mcp.json";

// Canonical server shapes — mutually exclusive: either stdio or remote.
export interface McpServerStdio {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  hosts?: McpHostId[];
  disabled?: boolean;
}

export interface McpServerRemote {
  url: string;
  type?: "http" | "sse";
  headers?: Record<string, string>;
  hosts?: McpHostId[];
  disabled?: boolean;
}

export type McpServer = McpServerStdio | McpServerRemote;

export function isStdio(server: McpServer): server is McpServerStdio {
  return "command" in server && typeof (server as McpServerStdio).command === "string";
}

export function isRemote(server: McpServer): server is McpServerRemote {
  return "url" in server && typeof (server as McpServerRemote).url === "string";
}

export interface CanonicalMcpConfig {
  version: 1;
  servers: Record<string, McpServer>;
}

export interface McpValidationError {
  server?: string;
  message: string;
}

// -- Validation --

export type ValidationResult =
  | { ok: true; config: CanonicalMcpConfig }
  | { ok: false; errors: McpValidationError[] };

export function validateMcpConfig(raw: unknown): ValidationResult {
  const errors: McpValidationError[] = [];

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: [{ message: "Config must be a JSON object" }] };
  }

  const obj = raw as Record<string, unknown>;

  if (obj["version"] !== 1) {
    errors.push({ message: `Expected version 1, got ${String(obj["version"])}` });
  }

  if (
    typeof obj["servers"] !== "object" ||
    obj["servers"] === null ||
    Array.isArray(obj["servers"])
  ) {
    errors.push({ message: "servers must be a plain object" });
    return { ok: false, errors };
  }

  const servers = obj["servers"] as Record<string, unknown>;
  for (const [name, entry] of Object.entries(servers)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      errors.push({ server: name, message: "Server entry must be a plain object" });
      continue;
    }
    const srv = entry as Record<string, unknown>;
    const hasCommand = "command" in srv;
    const hasUrl = "url" in srv;
    if (hasCommand && hasUrl) {
      errors.push({ server: name, message: "Server must have either command or url, not both" });
    } else if (!hasCommand && !hasUrl) {
      errors.push({ server: name, message: "Server must have either command or url" });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    config: raw as CanonicalMcpConfig,
  };
}

// -- Load / Save --

/**
 * Scan raw JSON text for duplicate keys at the top level of the "servers" object.
 * Returns the list of duplicated key names (empty if none found).
 *
 * Must run BEFORE JSON.parse, which silently collapses duplicate keys by keeping
 * only the last value, masking configuration errors.
 */
function findDuplicateServerNames(rawText: string): string[] {
  // Locate "servers": { in the raw text
  const serversKeyRe = /"servers"\s*:\s*\{/;
  const match = serversKeyRe.exec(rawText);
  if (!match) return [];

  // The last char of the match is '{' — that is the servers object's opening brace.
  const openBrace = match.index + match[0].length - 1;

  // Walk character-by-character, collecting string keys at depth 1.
  const seen = new Map<string, number>();
  let depth = 0;
  let i = openBrace;

  while (i < rawText.length) {
    const ch = rawText[i];

    if (ch === "{") {
      depth++;
      i++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) break;
      i++;
    } else if (ch === '"') {
      // Parse the JSON string starting at i
      let str = "";
      let j = i + 1;
      let esc = false;
      while (j < rawText.length) {
        const c = rawText[j];
        if (esc) {
          str += c;
          esc = false;
        } else if (c === "\\") {
          esc = true;
        } else if (c === '"') {
          j++;
          break;
        } else {
          str += c;
        }
        j++;
      }
      // j is now past the closing quote
      if (depth === 1) {
        // Check if followed by ':' — if so, this string is an object key
        const rest = rawText.slice(j).trimStart();
        if (rest.startsWith(":")) {
          seen.set(str, (seen.get(str) ?? 0) + 1);
        }
      }
      i = j;
    } else {
      i++;
    }
  }

  return [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}

export function loadMcpConfig(dir: string): CanonicalMcpConfig | null {
  const p = join(dir, MCP_CONFIG_FILE);
  if (!existsSync(p)) return null;
  try {
    const rawText = readFileSync(p, "utf8");
    if (findDuplicateServerNames(rawText).length > 0) return null;
    const raw = JSON.parse(rawText) as unknown;
    const result = validateMcpConfig(raw);
    if (!result.ok) return null;
    return result.config;
  } catch {
    return null;
  }
}

export function saveMcpConfig(dir: string, config: CanonicalMcpConfig): void {
  const result = validateMcpConfig(config);
  if (!result.ok) {
    const msgs = result.errors.map((e) => e.message).join("; ");
    throw new Error(`Cannot save invalid MCP config: ${msgs}`);
  }
  const p = join(dir, MCP_CONFIG_FILE);
  atomicWrite(p, `${JSON.stringify(config, null, 2)}\n`);
}

// -- ${VAR} expansion --

export interface EnvExpansionResult {
  value: string;
  unresolved: string[];
}

const PLACEHOLDER_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Expand `${VAR}` placeholders in `value`.
 *
 * Lookup order: explicit `env` map → `process.env`.
 * Unresolved placeholders are left as-is and their names are collected in `unresolved`.
 */
export function expandEnvPlaceholders(
  value: string,
  env?: Record<string, string | undefined>,
): EnvExpansionResult {
  const unresolved: string[] = [];
  const expanded = value.replace(PLACEHOLDER_RE, (match, varName: string) => {
    const resolved =
      env !== undefined ? (env[varName] ?? process.env[varName]) : process.env[varName];
    if (resolved === undefined) {
      unresolved.push(varName);
      return match; // leave placeholder unchanged
    }
    return resolved;
  });
  return { value: expanded, unresolved };
}
