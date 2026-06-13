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

    // --- Field type validation ---

    // Shared optional fields
    if ("hosts" in srv) {
      const hosts = srv["hosts"];
      if (!Array.isArray(hosts) || hosts.some((h) => typeof h !== "string")) {
        errors.push({ server: name, message: "hosts must be an array of strings" });
      } else {
        const unknownHosts = (hosts as string[]).filter(
          (h) => !MCP_HOST_IDS.includes(h as McpHostId),
        );
        if (unknownHosts.length > 0) {
          errors.push({
            server: name,
            message: `hosts contains unknown IDs: ${unknownHosts.join(", ")}. Valid IDs: ${MCP_HOST_IDS.join(", ")}`,
          });
        }
      }
    }
    if ("disabled" in srv) {
      if (typeof srv["disabled"] !== "boolean") {
        errors.push({ server: name, message: "disabled must be a boolean" });
      }
    }

    // Stdio-specific fields
    if (hasCommand) {
      if (typeof srv["command"] !== "string") {
        errors.push({ server: name, message: "command must be a string" });
      }
      if ("args" in srv) {
        const args = srv["args"];
        if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
          errors.push({ server: name, message: "args must be an array of strings" });
        }
      }
      if ("env" in srv) {
        const env = srv["env"];
        if (
          typeof env !== "object" ||
          env === null ||
          Array.isArray(env) ||
          Object.values(env as Record<string, unknown>).some((v) => typeof v !== "string")
        ) {
          errors.push({ server: name, message: "env must be an object with string values" });
        }
      }
    }

    // Remote-specific fields
    if (hasUrl) {
      if (typeof srv["url"] !== "string") {
        errors.push({ server: name, message: "url must be a string" });
      }
      if ("type" in srv) {
        const type = srv["type"];
        if (type !== "http" && type !== "sse") {
          errors.push({ server: name, message: 'type must be "http" or "sse"' });
        }
      }
      if ("headers" in srv) {
        const headers = srv["headers"];
        if (
          typeof headers !== "object" ||
          headers === null ||
          Array.isArray(headers) ||
          Object.values(headers as Record<string, unknown>).some((v) => typeof v !== "string")
        ) {
          errors.push({ server: name, message: "headers must be an object with string values" });
        }
      }
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
 * Parse a JSON string starting at position `pos` (which must point at the opening `"`).
 * Returns the decoded string value and the index immediately after the closing `"`.
 */
function parseJsonString(rawText: string, pos: number): { value: string; end: number } {
  let raw = "";
  let j = pos + 1; // skip opening '"'
  while (j < rawText.length) {
    const c = rawText[j];
    if (c === "\\") {
      // Include backslash + next char verbatim so JSON.parse can decode later.
      raw += c;
      j++;
      if (j < rawText.length) {
        raw += rawText[j];
        j++;
      }
    } else if (c === '"') {
      j++; // skip closing '"'
      break;
    } else {
      raw += c;
      j++;
    }
  }
  // Decode JSON escape sequences (e.g. \u0061 → 'a') via JSON.parse.
  let value: string;
  try {
    value = JSON.parse('"' + raw + '"') as string;
  } catch {
    value = raw; // fallback: malformed escapes won't be valid keys
  }
  return { value, end: j };
}

/**
 * Scan raw JSON text for duplicate keys at the top level of the "servers" object.
 * Returns the list of duplicated key names (empty if none found).
 *
 * Must run BEFORE JSON.parse, which silently collapses duplicate keys by keeping
 * only the last value, masking configuration errors.
 *
 * Crucially, this function tracks brace/bracket DEPTH and string state so that it
 * locates the DEPTH-1 (canonical, top-level) "servers" key specifically.  A
 * hand-edited file that contains a nested `"servers"` object inside some other
 * value (e.g. `"metadata": { "servers": { … } }`) must not fool the scan into
 * checking the wrong object.
 */
function findDuplicateServerNames(rawText: string): string[] {
  // ── Phase 1: find the opening '{' of the top-level "servers" value ──────────
  //
  // Walk the entire raw text, maintaining a brace/bracket depth counter and
  // skipping over string content so that braces inside strings don't skew the
  // depth.  We look for a "servers" key only when depth == 1 (i.e. we are
  // directly inside the outermost JSON object).

  let i = 0;
  let depth = 0;
  let serversStart = -1; // index of '{' that opens the canonical servers map

  while (i < rawText.length) {
    const ch = rawText[i];

    if (ch === "{" || ch === "[") {
      depth++;
      i++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth < 0) break; // malformed JSON
      i++;
    } else if (ch === '"') {
      const { value, end } = parseJsonString(rawText, i);

      if (depth === 1) {
        // We are inside the top-level object.  Check whether this string is
        // immediately followed by ':' (making it an object key).
        let afterStr = end;
        while (
          afterStr < rawText.length &&
          rawText[afterStr] !== ":" &&
          rawText[afterStr] !== '"'
        ) {
          const wc = rawText[afterStr];
          if (wc !== " " && wc !== "\t" && wc !== "\n" && wc !== "\r") break;
          afterStr++;
        }
        if (afterStr < rawText.length && rawText[afterStr] === ":" && value === "servers") {
          // Found the "servers" key at depth 1.  Locate its value (must be '{').
          let valuePos = afterStr + 1;
          while (valuePos < rawText.length) {
            const vc = rawText[valuePos];
            if (vc === " " || vc === "\t" || vc === "\n" || vc === "\r") {
              valuePos++;
            } else {
              break;
            }
          }
          if (valuePos < rawText.length && rawText[valuePos] === "{") {
            serversStart = valuePos;
            break;
          }
        }
      }

      i = end;
    } else {
      i++;
    }
  }

  if (serversStart === -1) return [];

  // ── Phase 2: scan the canonical servers object for duplicate top-level keys ──
  //
  // Starting at serversStart (the '{' of the servers map), walk
  // character-by-character and collect string keys at depth 1 within that
  // object.  We deliberately do NOT handle '['/']' here: server values are
  // always plain objects, and skipping array brackets is safe because
  //   • strings inside arrays are not followed by ':'
  //   • nested '{' / '}' inside arrays are tracked correctly by the depth counter.

  const seen = new Map<string, number>();
  let sdepth = 0;
  let k = serversStart;

  while (k < rawText.length) {
    const ch = rawText[k];

    if (ch === "{") {
      sdepth++;
      k++;
    } else if (ch === "}") {
      sdepth--;
      if (sdepth === 0) break;
      k++;
    } else if (ch === '"') {
      const { value, end } = parseJsonString(rawText, k);

      if (sdepth === 1) {
        // Check if followed by ':' — if so, this string is a server name key.
        const rest = rawText.slice(end).trimStart();
        if (rest.startsWith(":")) {
          seen.set(value, (seen.get(value) ?? 0) + 1);
        }
      }
      k = end;
    } else {
      k++;
    }
  }

  return [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}

/**
 * Discriminated result for loading the canonical mcp.json.
 *
 * - `absent`  — file does not exist (not an error; callers may create it)
 * - `invalid` — file exists but is malformed or fails schema validation
 * - `ok`      — file exists and is valid
 */
export type LoadMcpConfigResult =
  | { status: "ok"; config: CanonicalMcpConfig }
  | { status: "absent" }
  | { status: "invalid"; reason: string };

/**
 * Load the canonical mcp.json and return a discriminated result.
 * Unlike `loadMcpConfig`, this distinguishes between an absent file and a
 * present-but-invalid one, enabling callers to fail closed on corruption.
 */
export function loadMcpConfigResult(dir: string): LoadMcpConfigResult {
  const p = join(dir, MCP_CONFIG_FILE);
  if (!existsSync(p)) return { status: "absent" };
  try {
    const rawText = readFileSync(p, "utf8");
    const dupes = findDuplicateServerNames(rawText);
    if (dupes.length > 0) {
      return { status: "invalid", reason: `Duplicate server names: ${dupes.join(", ")}` };
    }
    const raw = JSON.parse(rawText) as unknown;
    const result = validateMcpConfig(raw);
    if (!result.ok) {
      const msgs = result.errors
        .map((e) => (e.server ? `${e.server}: ${e.message}` : e.message))
        .join("; ");
      return { status: "invalid", reason: msgs };
    }
    return { status: "ok", config: result.config };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "invalid", reason: `Parse error: ${msg}` };
  }
}

export function loadMcpConfig(dir: string): CanonicalMcpConfig | null {
  const result = loadMcpConfigResult(dir);
  if (result.status === "ok") return result.config;
  return null;
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
