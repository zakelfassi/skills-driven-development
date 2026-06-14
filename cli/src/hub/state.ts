import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { collectDoctorChecks, type DoctorCheck } from "../commands/doctor.js";
import { dirTreeHash } from "../lib/dir-tree-hash.js";
import { skddHome } from "../lib/global.js";
import { HARNESSES, type Harness } from "../lib/harness.js";
import { ADAPTERS, type HostReadResult, type HostSyncPlan } from "../lib/mcp/adapters/index.js";
import { isIntendedForHost } from "../lib/mcp/intent.js";
import {
  type CanonicalMcpConfig,
  expandEnvPlaceholders,
  isStdio,
  loadMcpConfigResult,
  type McpHostId,
  type McpServer,
} from "../lib/mcp/schema.js";
import { loadMcpManagedNames } from "../lib/mcp/state.js";
import { loadRegistry, type Registry } from "../lib/registry.js";
import { loadState, type SyncMirror } from "../lib/sync-state.js";

export const ALL_HOST_IDS: McpHostId[] = [
  "claude-code",
  "claude-desktop",
  "codex",
  "droid",
  "cursor",
  "opencode",
  "gemini",
];

export interface SkillRow {
  name: string;
  source: string;
  description: string;
  scope: "project" | "global";
}

export interface MirrorRow {
  harness: Harness;
  label: string;
  target: string;
  status: "ok" | "drift" | "missing" | "unlinked";
  /**
   * Only set when status === "drift".
   * "safe"   – the existing mirror is a symlink (wrong target) or a recorded managed
   *            copy that is currently a symlink; runLink() can repair it non-destructively.
   * "unsafe" – an unmanaged real directory exists where a symlink was expected;
   *            must not be auto-deleted (user data at risk).
   */
  driftKind?: "safe" | "unsafe";
}

export type McpCellStatus = "synced" | "drift" | "excluded" | "unavailable" | "needs-env";

export interface McpRow {
  name: string;
  kind: "stdio" | "remote";
  hosts: Record<McpHostId, McpCellStatus>;
}

export interface HubData {
  projectRoot: string;
  globalRoot: string;
  projectSkills: SkillRow[];
  globalSkills: SkillRow[];
  mirrors: MirrorRow[];
  mcpRows: McpRow[];
  mcpConfigError?: string;
  /** Set when a project or global .skills-registry.json is malformed and could not be loaded. */
  registryError?: string;
  /** Total managed MCP entries pending removal when the canonical registry is empty. */
  pendingMcpRemovals: number;
  doctorChecks: DoctorCheck[];
}

export async function loadHubData(cwd: string): Promise<HubData> {
  const projectRoot = cwd;
  const globalRoot = skddHome();

  const registryErrors: string[] = [];
  let projectSkills: SkillRow[] = [];
  let globalSkills: SkillRow[] = [];

  try {
    projectSkills = skillsFromRegistry(loadRegistry(projectRoot), "project");
  } catch (err) {
    registryErrors.push(`project registry: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    globalSkills = skillsFromRegistry(loadRegistry(globalRoot), "global");
  } catch (err) {
    registryErrors.push(`global registry: ${err instanceof Error ? err.message : String(err)}`);
  }

  const registryError = registryErrors.length > 0 ? registryErrors.join("; ") : undefined;

  const mirrors = buildMirrorRows(projectRoot);
  let mcpConfigError: string | undefined;
  let pendingMcpRemovals = 0;
  const mcpRows = buildMcpRows(globalRoot, {
    onConfigError: (reason) => {
      mcpConfigError = reason;
    },
    onPendingRemovals: (count) => {
      pendingMcpRemovals = count;
    },
  });
  const { checks: doctorChecks } = await collectDoctorChecks(projectRoot, { global: false });

  return {
    projectRoot,
    globalRoot,
    projectSkills,
    globalSkills,
    mirrors,
    mcpRows,
    mcpConfigError,
    registryError,
    pendingMcpRemovals,
    doctorChecks,
  };
}

function skillsFromRegistry(registry: Registry, scope: "project" | "global"): SkillRow[] {
  return registry.skills.map((s) => ({
    name: s.name,
    source: s.source,
    description: s.description,
    scope,
  }));
}

export function buildMirrorRows(root: string): MirrorRow[] {
  const state = loadState(root);
  const rows: MirrorRow[] = [];
  // Resolve canonical path once — used by symlink verification below.
  const canonicalPath = state ? resolve(root, state.canonical) : resolve(root, "skills");

  const harnessKeys = Object.keys(HARNESSES) as Harness[];
  for (const h of harnessKeys) {
    const profile = HARNESSES[h];
    const mirrorTarget = join(root, profile.skillsDir);
    const recorded = state?.mirrors.find((m) => m.target.includes(profile.skillsDir));

    let statusResult: Pick<MirrorRow, "status" | "driftKind">;
    if (!recorded) {
      statusResult = { status: "unlinked" };
    } else if (!existsSync(mirrorTarget)) {
      statusResult = { status: "missing" };
    } else {
      statusResult = checkMirrorStatus(mirrorTarget, recorded, canonicalPath);
    }

    rows.push({
      harness: h,
      label: profile.label ?? h,
      target: profile.skillsDir,
      ...statusResult,
    });
  }
  return rows;
}

function checkMirrorStatus(
  target: string,
  mirror: SyncMirror,
  canonicalPath: string,
): Pick<MirrorRow, "status" | "driftKind"> {
  try {
    const stat = lstatSync(target);
    if (mirror.mode === "symlink" && !stat.isSymbolicLink()) {
      // Real directory where a symlink was expected — unmanaged user data, unsafe to auto-repair.
      return { status: "drift", driftKind: "unsafe" };
    }
    if (mirror.mode === "copy" && stat.isSymbolicLink()) {
      // Recorded as copy but a symlink exists — runLink() can safely switch it back.
      return { status: "drift", driftKind: "safe" };
    }
    if (mirror.mode === "symlink") {
      // Verify the symlink still points at the canonical skills dir (mirrors doctor's logic).
      const linkTarget = readlinkSync(target);
      const expected = relative(dirname(target), canonicalPath);
      if (linkTarget !== expected) {
        // Wrong-target symlink — runLink() can re-link it non-destructively.
        return { status: "drift", driftKind: "safe" };
      }
    }
    if (mirror.mode === "copy") {
      // Verify the copy is still in sync with the canonical skills tree.
      // After a manual edit under canonical skills/, the COPY can be stale while the
      // hub would otherwise show ok. Compare trees; if contents diverge, mark drift.
      if (dirTreeHash(target) !== dirTreeHash(canonicalPath)) {
        return { status: "drift", driftKind: "safe" };
      }
    }
    return { status: "ok" };
  } catch {
    return { status: "missing" };
  }
}

/**
 * Expand `${VAR}` placeholders in a server's env/url/headers using process.env.
 * Returns the expanded server and a list of unresolved variable names.
 * Used by buildMcpRows so the plan comparison is apples-to-apples with what
 * the host file holds (the resolved value), not the raw canonical placeholder.
 */
function expandServerForPlan(server: McpServer): { server: McpServer; unresolved: string[] } {
  const unresolved: string[] = [];

  if (isStdio(server)) {
    const expandedEnv: Record<string, string> | undefined = server.env
      ? Object.fromEntries(
          Object.entries(server.env).map(([k, v]) => {
            const result = expandEnvPlaceholders(v);
            unresolved.push(...result.unresolved);
            return [k, result.value];
          }),
        )
      : undefined;
    return {
      server: expandedEnv !== undefined ? { ...server, env: expandedEnv } : { ...server },
      unresolved,
    };
  }

  // Remote server: expand url and headers.
  const urlResult = expandEnvPlaceholders(server.url);
  unresolved.push(...urlResult.unresolved);

  const expandedHeaders: Record<string, string> | undefined = server.headers
    ? Object.fromEntries(
        Object.entries(server.headers).map(([k, v]) => {
          const result = expandEnvPlaceholders(v);
          unresolved.push(...result.unresolved);
          return [k, result.value];
        }),
      )
    : undefined;

  return {
    server: {
      ...server,
      url: urlResult.value,
      ...(expandedHeaders !== undefined ? { headers: expandedHeaders } : {}),
    },
    unresolved,
  };
}

/** Minimal adapter surface needed by buildMcpRows — enables injection in tests. */
export interface McpRowAdapter {
  /** Whether this adapter omits disabled entries (true) or persists them natively (false). */
  omitsDisabled: boolean;
  /** Whether this adapter supports remote MCP servers. Defaults to true when absent. */
  acceptsRemote?: boolean;
  available(): boolean;
  read(): HostReadResult;
  plan(canonical: CanonicalMcpConfig, managed: string[]): HostSyncPlan;
}

export interface BuildMcpRowsOpts {
  /** Override the adapter registry (default: ADAPTERS from adapters/index). */
  adapters?: Partial<Record<McpHostId, McpRowAdapter>>;
  /** Override how managed server names are fetched per host (default: loadMcpManagedNames). */
  loadManaged?: (hostId: McpHostId) => string[];
  /**
   * Called when the canonical mcp.json exists but is invalid.
   * The hub uses this to surface an error indicator instead of silently
   * showing an empty matrix. Not called for an absent file.
   */
  onConfigError?: (reason: string) => void;
  /**
   * Called when the canonical registry is empty (absent or zero servers) but
   * the managed-state still lists names that runMcpSync would REMOVE from host
   * configs. The argument is the total count of pending-removal entries across
   * all hosts. Not called when managed state is also empty.
   */
  onPendingRemovals?: (count: number) => void;
}

/** Sum managed entries across all hosts and fire onPendingRemovals if > 0. */
function notifyPendingRemovals(
  loadManaged: (hostId: McpHostId) => string[],
  onPendingRemovals: ((count: number) => void) | undefined,
): void {
  if (!onPendingRemovals) return;
  const total = ALL_HOST_IDS.reduce((sum, hostId) => sum + loadManaged(hostId).length, 0);
  if (total > 0) onPendingRemovals(total);
}

export function buildMcpRows(globalRoot: string, opts?: BuildMcpRowsOpts): McpRow[] {
  const result = loadMcpConfigResult(globalRoot);

  const adapters = opts?.adapters ?? ADAPTERS;
  const loadManaged =
    opts?.loadManaged ?? ((hostId: McpHostId) => loadMcpManagedNames(globalRoot, hostId));

  if (result.status === "invalid") {
    opts?.onConfigError?.(result.reason);
    return [];
  }
  if (result.status === "absent") {
    notifyPendingRemovals(loadManaged, opts?.onPendingRemovals);
    return [];
  }
  const config = result.config;

  if (Object.keys(config.servers).length === 0) {
    notifyPendingRemovals(loadManaged, opts?.onPendingRemovals);
    return [];
  }

  return Object.entries(config.servers).map(([name, server]) => {
    const hosts: Record<McpHostId, McpCellStatus> = {} as Record<McpHostId, McpCellStatus>;
    const allowlist = server.hosts;

    for (const hostId of ALL_HOST_IDS) {
      if (allowlist && !allowlist.includes(hostId)) {
        // Before marking as excluded, check whether the server is still managed AND
        // present in the host config. When a user narrows the hosts allowlist to
        // remove a host, runMcpSync would REMOVE the existing entry on the next sync.
        // Show it as "drift" (pending-removal) so users know action is needed, rather
        // than hiding it as "excluded" and silently letting the stale entry linger.
        // A truly excluded server that is NOT present (already cleaned up) stays "excluded".
        //
        // M17 fix: check managed state BEFORE calling adapter.read() so a malformed
        // but irrelevant excluded host config is never parsed. Only read the host
        // config when there is a pending managed removal to surface.
        const excludedAdapter = adapters[hostId];
        if (excludedAdapter && excludedAdapter.available()) {
          const excludedManaged = loadManaged(hostId);
          if (excludedManaged.includes(name)) {
            const excludedRead = excludedAdapter.read();
            if (!excludedRead.ok || excludedRead.serverNames.includes(name)) {
              // Malformed config with pending managed cleanup, OR server still
              // present → sync will block on the config or plan a removal →
              // surface as drift so users know action is needed.
              hosts[hostId] = "drift";
              continue;
            }
            // Managed but already absent from a readable config → cleaned up →
            // fall through to "excluded".
          }
          // Not managed → no cleanup pending → no need to read host config.
        }
        hosts[hostId] = "excluded";
        continue;
      }
      const adapter = adapters[hostId];
      if (!adapter || !adapter.available()) {
        hosts[hostId] = "unavailable";
        continue;
      }

      const managed = loadManaged(hostId);

      // M17 fix 1: skip reading host config when the server is not intended for
      // this host AND there is no managed cleanup pending. Mirrors what
      // runMcpSync does — it skips the host entirely when there is nothing to
      // do. Avoids false drift from malformed-but-irrelevant host configs.
      if (!isIntendedForHost(server, hostId, adapter) && !managed.includes(name)) {
        hosts[hostId] = "excluded";
        continue;
      }

      const readResult = adapter.read();

      if (!readResult.ok) {
        // Malformed host config — treat as drift
        hosts[hostId] = "drift";
        continue;
      }

      const isManaged = managed.includes(name);
      const isPresent = readResult.serverNames.includes(name);

      // Fix 1: expand ${VAR} placeholders before computing plan/status.
      // The host file holds the resolved value; passing the unexpanded canonical to
      // plan() makes it always see a diff → permanent false-positive "drift".
      // If a variable is unset, mark as "needs-env" instead of misleading "drift".
      //
      // Exception: Droid natively supports ${VAR} and stores placeholders verbatim,
      // so the host file and canonical both contain the unexpanded form. Expanding
      // for Droid would produce false drift when the env var is set. Mirror the same
      // per-host rule that runMcpSync uses.
      let planServer: McpServer;
      if (hostId === "droid") {
        planServer = server; // Droid: passthrough, no expansion
      } else {
        const { server: expandedServer, unresolved } = expandServerForPlan(server);
        if (unresolved.length > 0) {
          // Before flagging needs-env, check whether the adapter actually intends
          // to include this server. If not (disabled on an omitting-host like
          // claude-code/cursor/gemini, or remote on a stdio-only host like
          // claude-desktop), env resolution is irrelevant — the adapter will
          // omit/remove the entry regardless of placeholder values. Fall through
          // with the unexpanded server so the plan-based logic determines the
          // real status (excluded / drift-pending-removal).
          // Only show needs-env for servers genuinely intended for this host.
          if (isIntendedForHost(server, hostId, adapter)) {
            hosts[hostId] = "needs-env";
            continue;
          }
          // Not intended → env values don't affect the outcome; use unexpanded.
          planServer = server;
        } else {
          planServer = expandedServer;
        }
      }

      // Build an expanded config for plan comparison (only this server's values change).
      const expandedConfig: CanonicalMcpConfig = {
        ...config,
        servers: { ...config.servers, [name]: planServer },
      };

      // Content-equality check: synced requires the host entry to match canonical.
      // Use adapter.plan() — zero changes for this server means content is equal.
      const syncPlan = adapter.plan(expandedConfig, managed);

      if (!syncPlan.ok) {
        hosts[hostId] = "drift";
        continue;
      }

      const planAddsOrUpdatesThis = syncPlan.changes.some(
        (c) => (c.op === "add" || c.op === "update") && c.name === name,
      );

      // Fix 2: distinguish intentional skip, genuine drift, and name collision.
      //
      // Adapters omit some servers by design (disabled:true on claude-code/cursor/gemini,
      // remote servers on claude-desktop). After a correct sync those servers are neither
      // "managed" nor "present", and the plan emits no add/update for them.
      // Treat that as "excluded" (intended-state), not "drift".
      //
      // However, when a canonical server targets a host that already has an UNMANAGED
      // entry of the same name, the adapter emits no add/update (it skips with a warning)
      // even though the canonical intent can never be synced until the conflict is resolved.
      // Detect this by: server IS present, NOT managed, and plan has a warning mentioning
      // the name — surface it as "drift" so users know they must resolve the conflict.
      if (!isManaged || !isPresent) {
        if (planAddsOrUpdatesThis) {
          hosts[hostId] = "drift";
        } else if (
          isPresent &&
          !isManaged &&
          isIntendedForHost(server, hostId, adapter) &&
          syncPlan.warnings.some((w) => w.includes(`"${name}"`))
        ) {
          // Unmanaged entry of the same name blocks sync — show as drift/conflict.
          // M17 fix 2: only treat warnings as unmanaged-name collisions when the
          // server IS intended for the host. Intentional-skip warnings (e.g. remote
          // on a stdio-only host) also mention the server name but are NOT
          // collisions — the canonical server can never sync there regardless.
          hosts[hostId] = "drift";
        } else {
          hosts[hostId] = "excluded";
        }
        continue;
      }

      // Server is managed and present: check content equality.
      hosts[hostId] = syncPlan.changes.some((c) => c.name === name) ? "drift" : "synced";
    }

    return {
      name,
      kind: "command" in server ? "stdio" : "remote",
      hosts,
    } as McpRow;
  });
}
