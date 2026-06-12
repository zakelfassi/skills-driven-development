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
      raw = JSON.parse(readFileSync(p, "utf8")) as unknown;
    } catch {
      return { ok: false, reason: `Failed to parse ${p}: invalid JSON` };
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, reason: `${p} is not a JSON object` };
    }
    const obj = raw as Record<string, unknown>;
    const servers = obj[cfg.mcpKey];
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
