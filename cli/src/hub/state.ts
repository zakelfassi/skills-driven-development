import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { collectDoctorChecks, type DoctorCheck } from "../commands/doctor.js";
import { skddHome } from "../lib/global.js";
import { HARNESSES, type Harness } from "../lib/harness.js";
import { ADAPTERS, type HostReadResult, type HostSyncPlan } from "../lib/mcp/adapters/index.js";
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
  doctorChecks: DoctorCheck[];
}

export async function loadHubData(cwd: string): Promise<HubData> {
  const projectRoot = cwd;
  const globalRoot = skddHome();

  const projectSkills = skillsFromRegistry(loadRegistry(projectRoot), "project");
  const globalSkills = skillsFromRegistry(loadRegistry(globalRoot), "global");

  const mirrors = buildMirrorRows(projectRoot);
  let mcpConfigError: string | undefined;
  const mcpRows = buildMcpRows(globalRoot, {
    onConfigError: (reason) => {
      mcpConfigError = reason;
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

function buildMirrorRows(root: string): MirrorRow[] {
  const state = loadState(root);
  const rows: MirrorRow[] = [];

  const harnessKeys = Object.keys(HARNESSES) as Harness[];
  for (const h of harnessKeys) {
    const profile = HARNESSES[h];
    const mirrorTarget = join(root, profile.skillsDir);
    const recorded = state?.mirrors.find((m) => m.target.includes(profile.skillsDir));

    let status: MirrorRow["status"];
    if (!recorded) {
      status = "unlinked";
    } else if (!existsSync(mirrorTarget)) {
      status = "missing";
    } else {
      status = checkMirrorStatus(mirrorTarget, recorded);
    }

    rows.push({
      harness: h,
      label: profile.label ?? h,
      target: profile.skillsDir,
      status,
    });
  }
  return rows;
}

function checkMirrorStatus(target: string, mirror: SyncMirror): MirrorRow["status"] {
  try {
    const stat = lstatSync(target);
    if (mirror.mode === "symlink" && !stat.isSymbolicLink()) return "drift";
    if (mirror.mode === "copy" && stat.isSymbolicLink()) return "drift";
    return "ok";
  } catch {
    return "missing";
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
}

export function buildMcpRows(globalRoot: string, opts?: BuildMcpRowsOpts): McpRow[] {
  const result = loadMcpConfigResult(globalRoot);
  if (result.status === "invalid") {
    opts?.onConfigError?.(result.reason);
    return [];
  }
  if (result.status === "absent") return [];
  const config = result.config;

  const adapters = opts?.adapters ?? ADAPTERS;
  const loadManaged =
    opts?.loadManaged ?? ((hostId: McpHostId) => loadMcpManagedNames(globalRoot, hostId));

  return Object.entries(config.servers).map(([name, server]) => {
    const hosts: Record<McpHostId, McpCellStatus> = {} as Record<McpHostId, McpCellStatus>;
    const allowlist = server.hosts;

    for (const hostId of ALL_HOST_IDS) {
      if (allowlist && !allowlist.includes(hostId)) {
        hosts[hostId] = "excluded";
        continue;
      }
      const adapter = adapters[hostId];
      if (!adapter || !adapter.available()) {
        hosts[hostId] = "unavailable";
        continue;
      }

      const readResult = adapter.read();
      const managed = loadManaged(hostId);

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
          hosts[hostId] = "needs-env";
          continue;
        }
        planServer = expandedServer;
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

      // Fix 2: distinguish intentional skip from genuine drift.
      // Adapters omit some servers by design (disabled:true on claude-code/cursor/gemini,
      // remote servers on claude-desktop). After a correct sync those servers are neither
      // "managed" nor "present", but the plan emits no add/update for them either.
      // Treat that as "excluded" (in-intended-state), not "drift".
      if (!isManaged || !isPresent) {
        hosts[hostId] = planAddsOrUpdatesThis ? "drift" : "excluded";
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
