import { Box, render, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useState } from "react";
import { collectDoctorChecks } from "../commands/doctor.js";
import { runLink, runUnlink } from "../commands/link.js";
import { collectMcpPlanLines, runMcpSync } from "../commands/mcp.js";
import type { Harness } from "../lib/harness.js";
import { DoctorPane } from "./panes/doctor.js";
import { McpPane } from "./panes/mcp.js";
import { MirrorsPane } from "./panes/mirrors.js";
import { SkillsPane } from "./panes/skills.js";
import { type HubData, loadHubData, type MirrorRow } from "./state.js";

export type PaneId = "skills" | "mirrors" | "mcp" | "doctor";

const PANES: { id: PaneId; label: string }[] = [
  { id: "skills", label: "Skills" },
  { id: "mirrors", label: "Mirrors" },
  { id: "mcp", label: "MCP" },
  { id: "doctor", label: "Doctor" },
];

/** Injectable action handlers — defaults are the real implementations. */
export interface HubActions {
  link?: (opts: { harness: Harness; cwd: string }) => Promise<void>;
  unlink?: (opts: { harness: Harness; cwd: string }) => Promise<void>;
  dryRunPlan?: () => Promise<string[]>;
}

export interface HubProps {
  data: HubData;
  cwd: string;
  actions?: HubActions;
  /** Override data reload — defaults to loadHubData(cwd). */
  reloader?: (cwd: string) => Promise<HubData>;
}

export function Hub({ data: initialData, cwd, actions, reloader }: HubProps) {
  const { exit } = useApp();
  const [activePane, setActivePane] = useState<PaneId>("skills");
  const [data, setData] = useState<HubData>(initialData);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [actionMessage, setActionMessage] = useState<string | undefined>();
  const [doctorLoading, setDoctorLoading] = useState(false);
  const [dryRunOutput, setDryRunOutput] = useState<string[] | undefined>();

  const activePaneIdx = PANES.findIndex((p) => p.id === activePane);

  const maxIndex = useCallback((): number => {
    switch (activePane) {
      case "skills":
        return Math.max(0, data.projectSkills.length + data.globalSkills.length - 1);
      case "mirrors":
        return Math.max(0, data.mirrors.length - 1);
      case "mcp":
        return Math.max(0, data.mcpRows.length - 1);
      case "doctor":
        return 0;
    }
  }, [activePane, data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally reset UI state on pane change
  useEffect(() => {
    setSelectedIndex(0);
    setActionMessage(undefined);
    setDryRunOutput(undefined);
  }, [activePane]);

  const reloadData = useCallback(async () => {
    const doReload = reloader ?? loadHubData;
    const fresh = await doReload(cwd);
    setData(fresh);
  }, [cwd, reloader]);

  const reRunDoctor = useCallback(async () => {
    setDoctorLoading(true);
    setActionMessage(undefined);
    const { checks } = await collectDoctorChecks(data.projectRoot, { global: false });
    setData((prev) => ({ ...prev, doctorChecks: checks }));
    setDoctorLoading(false);
    setActionMessage("Doctor checks refreshed");
  }, [data.projectRoot]);

  const toggleMirror = useCallback(async () => {
    if (activePane !== "mirrors") return;
    const mirror: MirrorRow | undefined = data.mirrors[selectedIndex];
    if (!mirror) return;

    const doLink = actions?.link ?? (async (o: { harness: Harness; cwd: string }) => {
      await runLink({ harnesses: [o.harness], cwd: o.cwd, quiet: true });
    });
    const doUnlink = actions?.unlink ?? (async (o: { harness: Harness; cwd: string }) => {
      await runUnlink({ harnesses: [o.harness], cwd: o.cwd, quiet: true });
    });

    if (mirror.status === "ok" || mirror.status === "drift") {
      setActionMessage(`Unlinking ${mirror.harness}…`);
      await doUnlink({ harness: mirror.harness, cwd });
      setActionMessage(`Unlinked ${mirror.harness}`);
    } else {
      setActionMessage(`Linking ${mirror.harness}…`);
      await doLink({ harness: mirror.harness, cwd });
      setActionMessage(`Linked ${mirror.harness}`);
    }
    await reloadData();
  }, [activePane, actions, cwd, data.mirrors, selectedIndex, reloadData]);

  const syncMcp = useCallback(async () => {
    if (activePane !== "mcp") return;
    setActionMessage("Syncing MCP servers…");
    await runMcpSync({ dryRun: false });
    await reloadData();
    setActionMessage("MCP sync complete");
  }, [activePane, reloadData]);

  const dryRunMcp = useCallback(async () => {
    if (activePane !== "mcp") return;
    setDryRunOutput(["Computing dry-run plan…"]);
    const doDryRun = actions?.dryRunPlan ?? collectMcpPlanLines;
    const lines = await doDryRun();
    setDryRunOutput(lines);
  }, [activePane, actions]);

  useInput((input, key) => {
    // Global: quit
    if (input === "q") {
      exit();
      return;
    }

    // Tab navigation
    if (key.tab) {
      const next = (activePaneIdx + 1) % PANES.length;
      setActivePane(PANES[next]!.id);
      return;
    }

    // Pane switching via number keys
    if (input === "1") {
      setActivePane("skills");
      return;
    }
    if (input === "2") {
      setActivePane("mirrors");
      return;
    }
    if (input === "3") {
      setActivePane("mcp");
      return;
    }
    if (input === "4") {
      setActivePane("doctor");
      return;
    }

    // List navigation
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(maxIndex(), i + 1));
      return;
    }

    // Pane-specific actions
    if (key.return && activePane === "mirrors") {
      void toggleMirror();
      return;
    }
    if (input === "r" && activePane === "doctor") {
      void reRunDoctor();
      return;
    }
    if (input === "s" && activePane === "mcp") {
      void syncMcp();
      return;
    }
    if (input === "d" && activePane === "mcp") {
      void dryRunMcp();
      return;
    }
  });

  return (
    <Box flexDirection="column">
      {/* Tab bar */}
      <Box borderStyle="single" paddingX={1}>
        <Text bold>skdd hub </Text>
        {PANES.map((p, i) => (
          <Box key={p.id}>
            {i > 0 && <Text color="gray"> │ </Text>}
            <Text
              bold={p.id === activePane}
              color={p.id === activePane ? "cyan" : "gray"}
              underline={p.id === activePane}
            >
              {i + 1}:{p.label}
            </Text>
          </Box>
        ))}
        <Text color="gray"> q quit · Tab next</Text>
      </Box>

      {/* Active pane */}
      <Box flexDirection="column" paddingTop={1}>
        {activePane === "skills" && (
          <SkillsPane
            projectSkills={data.projectSkills}
            globalSkills={data.globalSkills}
            selectedIndex={selectedIndex}
          />
        )}
        {activePane === "mirrors" && (
          <MirrorsPane
            mirrors={data.mirrors}
            selectedIndex={selectedIndex}
            actionMessage={actionMessage}
          />
        )}
        {activePane === "mcp" && (
          <McpPane rows={data.mcpRows} selectedIndex={selectedIndex} dryRunOutput={dryRunOutput} />
        )}
        {activePane === "doctor" && (
          <DoctorPane
            checks={data.doctorChecks}
            loading={doctorLoading}
            actionMessage={actionMessage}
          />
        )}
      </Box>
    </Box>
  );
}

export async function renderHub(cwd: string): Promise<number> {
  if (!process.stdout.isTTY) {
    process.stderr.write("skdd hub requires an interactive terminal\n");
    return 1;
  }

  const data = await loadHubData(cwd);
  const { waitUntilExit } = render(<Hub data={data} cwd={cwd} />);
  await waitUntilExit();
  return 0;
}
