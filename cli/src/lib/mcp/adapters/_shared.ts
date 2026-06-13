import { existsSync, readFileSync } from "node:fs";
import { atomicWrite, backupFile } from "../backup.js";
import type { CanonicalMcpConfig, McpHostId, McpServer } from "../schema.js";
import type {
  HostApplyResult,
  HostReadResult,
  HostSyncPlan,
  HostSyncPlanOk,
  McpHostAdapter,
  ServerChange,
} from "./types.js";

/**
 * Advance `pos` past whitespace and JSONC comments (// and slash-star…star-slash).
 * Returns the index of the next non-whitespace, non-comment character.
 * Used as a lookahead to detect trailing commas before } or ].
 */
function skipWsAndComments(text: string, pos: number): number {
  let j = pos;
  while (j < text.length) {
    const c = text[j];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      j++;
    } else if (c === "/" && text[j + 1] === "/") {
      // Line comment: skip to end of line
      while (j < text.length && text[j] !== "\n") j++;
    } else if (c === "/" && text[j + 1] === "*") {
      // Block comment: skip to closing star-slash
      j += 2;
      while (j < text.length && !(text[j] === "*" && text[j + 1] === "/")) j++;
      j += 2;
    } else {
      break;
    }
  }
  return j;
}

/**
 * Strip JSONC extensions (// line comments, /* block comments, trailing commas)
 * from input and return standard JSON text. Dependency-free, single-pass approach.
 *
 * A single stateful scan tracks whether the cursor is inside a string literal
 * (including escape handling) and only strips comments and trailing commas
 * OUTSIDE string literals — string values are never rewritten.
 *
 * Fail-closed behaviour:
 * - An unterminated block comment (slash-star with no matching star-slash before EOF) throws
 *   a SyntaxError so the adapter rejects the file rather than silently accepting
 *   malformed input.
 * - Malformed input that is not valid even after stripping will still throw when
 *   passed to JSON.parse.
 *
 * NOTE: Comments are NOT preserved on write. When skdd applies changes to an
 * OpenCode config that contained comments, the written file will be valid JSON
 * without those comments. All unmanaged keys and servers survive via the
 * merge-not-overwrite logic in createJsonAdapter.
 */
export function stripJsonc(text: string): string {
  let i = 0;
  let result = "";

  while (i < text.length) {
    // ── String literal ────────────────────────────────────────────────────────
    // Pass through verbatim (including escape sequences) so that string VALUES
    // containing characters like ',', '}', ']', '/', or '*' are never modified.
    if (text[i] === '"') {
      result += '"';
      i++;
      while (i < text.length) {
        const ch = text[i];
        result += ch;
        i++;
        if (ch === "\\") {
          // Escaped character — copy next char verbatim (don't interpret it)
          if (i < text.length) result += text[i++];
        } else if (ch === '"') {
          break; // end of string
        }
      }
      continue;
    }

    // ── Line comment: // ... \n ───────────────────────────────────────────────
    if (text[i] === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }

    // ── Block comment: /* ... */ ──────────────────────────────────────────────
    if (text[i] === "/" && text[i + 1] === "*") {
      i += 2;
      let terminated = false;
      while (i < text.length) {
        if (text[i] === "*" && text[i + 1] === "/") {
          i += 2;
          terminated = true;
          break;
        }
        i++;
      }
      if (!terminated) {
        throw new SyntaxError("Unterminated block comment in JSONC input");
      }
      continue;
    }

    // ── Trailing comma ────────────────────────────────────────────────────────
    // A comma is a trailing comma when the only characters between it and the
    // next structural character are whitespace or comments, and that next character
    // is } or ]. We perform a non-consuming lookahead and simply skip the comma.
    if (text[i] === ",") {
      const j = skipWsAndComments(text, i + 1);
      if (j < text.length && (text[j] === "}" || text[j] === "]")) {
        // Trailing comma: consume it without emitting
        i++;
        continue;
      }
    }

    // ── Ordinary character ────────────────────────────────────────────────────
    result += text[i++];
  }

  return result;
}

/**
 * Key-order-agnostic deep equality. Used for content-equality checks to
 * avoid spurious writes when host config has different key ordering.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const aa = a as unknown[];
    const ba = b as unknown[];
    if (aa.length !== ba.length) return false;
    return aa.every((v, i) => deepEqual(v, ba[i]));
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => k in objB && deepEqual(objA[k], objB[k]));
}

export interface JsonAdapterConfig {
  id: McpHostId;
  label: string;
  /** Returns absolute path to the host config file; called at runtime so HOME changes are reflected. */
  configPath(): string;
  /** Returns true when this adapter should be used (platform + dir existence). */
  available(): boolean;
  /** Top-level key within the host config object that holds MCP servers. */
  mcpKey: string;
  /**
   * Convert a canonical server entry to its native representation for this host.
   * Return null to omit the server (e.g. disabled, or not supported for this host).
   */
  toNativeEntry(server: McpServer): unknown | null;
  /**
   * Optional: called when toNativeEntry returns null and the server has NOT been
   * explicitly disabled. Return a warning string to surface to the user, or
   * undefined for silent omission.
   */
  onSkipped?: (name: string, server: McpServer) => string | undefined;
  /**
   * Optional: custom parser for the host config file text.
   * Defaults to JSON.parse. Override for hosts that accept non-strict JSON
   * (e.g., JSONC for OpenCode). The function must throw on truly malformed
   * input so the adapter fails closed.
   */
  parseRaw?: (text: string) => unknown;
}

/**
 * Factory that creates a McpHostAdapter from a JsonAdapterConfig.
 *
 * All six JSON-based adapters share the same read/plan/apply logic; they
 * differ only in configPath(), available(), mcpKey, and toNativeEntry().
 */
export function createJsonAdapter(cfg: JsonAdapterConfig): McpHostAdapter {
  function readImpl(): HostReadResult {
    const p = cfg.configPath();
    if (!existsSync(p)) {
      return { ok: true, serverNames: [], rawDoc: {} };
    }
    let raw: unknown;
    try {
      const parseJson = cfg.parseRaw ?? JSON.parse;
      raw = parseJson(readFileSync(p, "utf8")) as unknown;
    } catch {
      return { ok: false, reason: `Failed to parse ${p}: invalid JSON` };
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, reason: `${p} is not a JSON object` };
    }
    const obj = raw as Record<string, unknown>;
    const servers = obj[cfg.mcpKey];
    if (servers !== undefined) {
      if (typeof servers !== "object" || servers === null || Array.isArray(servers)) {
        const kind = Array.isArray(servers) ? "array" : typeof servers;
        return {
          ok: false,
          reason: `${p}: "${cfg.mcpKey}" must be an object but got ${kind} — refusing to overwrite`,
        };
      }
    }
    let serverNames: string[] = [];
    if (typeof servers === "object" && servers !== null && !Array.isArray(servers)) {
      serverNames = Object.keys(servers as Record<string, unknown>);
    }
    return { ok: true, serverNames, rawDoc: obj };
  }

  return {
    id: cfg.id,
    label: cfg.label,
    configPath: cfg.configPath,
    available: cfg.available,
    read: readImpl,

    plan(canonical: CanonicalMcpConfig, managed: string[]): HostSyncPlan {
      const readResult = readImpl();
      if (!readResult.ok) return { ok: false, reason: readResult.reason };

      // Shallow-copy the root doc so we don't mutate cached state
      const rawDoc: Record<string, unknown> = { ...readResult.rawDoc };

      // Shallow-copy the current servers map (or start empty)
      const existing = rawDoc[cfg.mcpKey];
      const currentServers: Record<string, unknown> =
        typeof existing === "object" && existing !== null && !Array.isArray(existing)
          ? { ...(existing as Record<string, unknown>) }
          : {};

      const nextServers: Record<string, unknown> = { ...currentServers };
      const changes: ServerChange[] = [];
      const warnings: string[] = [];
      const omitted: string[] = [];
      const canonicalNames = new Set(Object.keys(canonical.servers));

      // Process each canonical server
      for (const [name, server] of Object.entries(canonical.servers)) {
        // Respect per-server hosts allowlist
        if (server.hosts && !server.hosts.includes(cfg.id)) {
          // ALLOWLIST NARROWING: if this server was previously managed on this host,
          // remove it now that the host has been excluded from the allowlist.
          if (managed.includes(name) && name in nextServers) {
            changes.push({ op: "remove", name });
            delete nextServers[name];
          }
          continue;
        }

        const nativeEntry = cfg.toNativeEntry(server);

        if (nativeEntry === null) {
          // Server should be omitted (disabled/unsupported): remove if managed
          if (managed.includes(name) && name in nextServers) {
            changes.push({ op: "remove", name });
            delete nextServers[name];
          } else if (managed.includes(name)) {
            // Managed but host entry already absent — adapter intentionally omits
            // this server and there is nothing to remove.  Track in omitted[] so
            // the sync orchestrator can purge it from managed state; otherwise a
            // later user-authored same-name entry would be clobbered.
            omitted.push(name);
          }
          // Surface a warning when the server is skipped for a non-disabled reason.
          if (!server.disabled && cfg.onSkipped) {
            const warn = cfg.onSkipped(name, server);
            if (warn) warnings.push(warn);
          }
          continue;
        }

        if (name in currentServers) {
          // SAME-NAME UNMANAGED SAFETY: if an entry with this name exists but was not
          // placed there by skdd, warn and skip to avoid overwriting user-authored config.
          if (!managed.includes(name)) {
            warnings.push(
              `Skipping "${name}": an unmanaged entry with this name already exists; remove it manually to let skdd manage it.`,
            );
            continue;
          }
          // Content-equality check: skip unchanged servers to avoid write churn.
          // Uses deep-equal (key-order robust) instead of raw stringify.
          if (deepEqual(nativeEntry, currentServers[name])) {
            continue;
          }
          changes.push({ op: "update", name });
        } else {
          changes.push({ op: "add", name });
        }
        nextServers[name] = nativeEntry;
      }

      // Remove servers that were managed but are no longer in canonical
      for (const managedName of managed) {
        if (!canonicalNames.has(managedName) && managedName in nextServers) {
          changes.push({ op: "remove", name: managedName });
          delete nextServers[managedName];
        }
      }

      rawDoc[cfg.mcpKey] = nextServers;

      return {
        ok: true,
        changes,
        filePath: cfg.configPath(),
        finalDoc: rawDoc,
        warnings,
        omitted,
      };
    },

    apply(plan: HostSyncPlan): HostApplyResult {
      if (!plan.ok) return { ok: false, reason: plan.reason };
      if (plan.changes.length === 0) return { ok: true, written: false };

      const { filePath, finalDoc } = plan as HostSyncPlanOk;
      try {
        backupFile(filePath);
        atomicWrite(filePath, JSON.stringify(finalDoc, null, 2) + "\n");
        return { ok: true, written: true };
      } catch (e) {
        return { ok: false, reason: String(e) };
      }
    },
  };
}
