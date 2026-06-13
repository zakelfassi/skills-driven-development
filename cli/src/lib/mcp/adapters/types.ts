import type { CanonicalMcpConfig, McpHostId } from "../schema.js";

export type { McpHostId };

export interface HostReadOk {
  ok: true;
  serverNames: string[];
  rawDoc: Record<string, unknown>;
}

export interface HostReadErr {
  ok: false;
  reason: string;
}

export type HostReadResult = HostReadOk | HostReadErr;

export interface ServerChange {
  op: "add" | "update" | "remove";
  name: string;
}

export interface HostSyncPlanOk {
  ok: true;
  changes: ServerChange[];
  filePath: string;
  finalDoc: Record<string, unknown>;
  warnings: string[];
  /**
   * Server names the adapter intentionally decided NOT to write on this host
   * (e.g. disabled:true, remote server on a stdio-only host) AND whose host
   * entry was already absent (so no `remove` change was needed either).
   *
   * After a successful sync the orchestrator uses this list to drop those names
   * from managed state, so a later user-authored same-name entry is not
   * clobbered on the next sync.
   *
   * Absent (undefined) is equivalent to an empty array — adapters that never
   * produce omissions may omit this field.
   */
  omitted?: string[];
}

export interface HostSyncPlanErr {
  ok: false;
  reason: string;
}

export type HostSyncPlan = HostSyncPlanOk | HostSyncPlanErr;

export interface HostApplyResultOk {
  ok: true;
  /** true when at least one server was written; false when no changes */
  written: boolean;
}

export interface HostApplyResultErr {
  ok: false;
  reason: string;
}

export type HostApplyResult = HostApplyResultOk | HostApplyResultErr;

/**
 * Interface that every MCP host adapter must implement.
 *
 * plan()/apply() split enables --dry-run: call plan() to get the intended
 * mutations, inspect/display them, then call apply() only if not dry-running.
 */
export interface McpHostAdapter {
  id: McpHostId;
  label: string;
  /** Absolute path to the host config file, homedir-aware. */
  configPath(): string;
  /** True when this adapter is usable (platform check + existence heuristic). */
  available(): boolean;
  /** Parse the host config and return current server names + raw document. */
  read(): HostReadResult;
  /**
   * Compute the set of adds/updates/removes needed to bring the host config in
   * line with `canonical`, constrained to only touch server names in `managed`.
   * Performs no IO.
   */
  plan(canonical: CanonicalMcpConfig, managed: string[]): HostSyncPlan;
  /**
   * Backup + atomic-write the final document produced by plan().
   * No-op (written: false) when plan.changes is empty.
   */
  apply(plan: HostSyncPlan): HostApplyResult;
}
