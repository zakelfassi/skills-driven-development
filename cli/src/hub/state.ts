import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { collectDoctorChecks, type DoctorCheck } from "../commands/doctor.js";
import { skddHome } from "../lib/global.js";
import { HARNESSES, type Harness } from "../lib/harness.js";
import { ADAPTERS } from "../lib/mcp/adapters/index.js";
import { loadMcpConfig, type McpHostId } from "../lib/mcp/schema.js";
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

export type McpCellStatus = "synced" | "drift" | "excluded" | "unavailable";

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
  doctorChecks: DoctorCheck[];
}

export async function loadHubData(cwd: string): Promise<HubData> {
  const projectRoot = cwd;
  const globalRoot = skddHome();

  const projectSkills = skillsFromRegistry(loadRegistry(projectRoot), "project");
  const globalSkills = skillsFromRegistry(loadRegistry(globalRoot), "global");

  const mirrors = buildMirrorRows(projectRoot);
  const mcpRows = buildMcpRows(globalRoot);
  const { checks: doctorChecks } = await collectDoctorChecks(projectRoot, { global: false });

  return { projectRoot, globalRoot, projectSkills, globalSkills, mirrors, mcpRows, doctorChecks };
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

function buildMcpRows(globalRoot: string): McpRow[] {
  const config = loadMcpConfig(globalRoot);
  if (!config) return [];

  return Object.entries(config.servers).map(([name, server]) => {
    const hosts: Record<McpHostId, McpCellStatus> = {} as Record<McpHostId, McpCellStatus>;
    const allowlist = server.hosts;

    for (const hostId of ALL_HOST_IDS) {
      if (allowlist && !allowlist.includes(hostId)) {
        hosts[hostId] = "excluded";
        continue;
      }
      const adapter = ADAPTERS[hostId];
      if (!adapter || !adapter.available()) {
        hosts[hostId] = "unavailable";
        continue;
      }
      hosts[hostId] = "drift"; // default until we check
    }

    return {
      name,
      kind: "command" in server ? "stdio" : "remote",
      hosts,
    } as McpRow;
  });
}
