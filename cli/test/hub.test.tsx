import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorCheck } from "../src/commands/doctor.js";
import { Hub } from "../src/hub/app.js";
import { DoctorPane } from "../src/hub/panes/doctor.js";
import { McpPane } from "../src/hub/panes/mcp.js";
import { MirrorsPane } from "../src/hub/panes/mirrors.js";
import { SkillsPane } from "../src/hub/panes/skills.js";
import {
  buildMcpRows,
  type HubData,
  type McpRow,
  type McpRowAdapter,
  type MirrorRow,
  type SkillRow,
} from "../src/hub/state.js";
import type { ServerChange } from "../src/lib/mcp/adapters/index.js";
import type { McpHostId } from "../src/lib/mcp/schema.js";

// ── SkillsPane ────────────────────────────────────────────────────────────────

describe("SkillsPane", () => {
  const projectSkills: SkillRow[] = [
    { name: "release-cut", source: "local", description: "Cut a release", scope: "project" },
  ];
  const globalSkills: SkillRow[] = [
    { name: "dev-browser", source: "local", description: "Drive a browser", scope: "global" },
  ];

  it("renders skill count summary", () => {
    const { lastFrame, unmount } = render(
      <SkillsPane projectSkills={projectSkills} globalSkills={globalSkills} selectedIndex={0} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("1 project");
    expect(frame).toContain("1 global");
    unmount();
  });

  it("marks first skill as selected", () => {
    const { lastFrame, unmount } = render(
      <SkillsPane projectSkills={projectSkills} globalSkills={globalSkills} selectedIndex={0} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("▶");
    expect(frame).toContain("release-cut");
    unmount();
  });

  it("marks global skill as selected when index points to it", () => {
    const { lastFrame, unmount } = render(
      <SkillsPane projectSkills={projectSkills} globalSkills={globalSkills} selectedIndex={1} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("dev-browser");
    unmount();
  });

  it("shows empty state when no skills", () => {
    const { lastFrame, unmount } = render(
      <SkillsPane projectSkills={[]} globalSkills={[]} selectedIndex={0} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("No skills found");
    unmount();
  });

  it("displays skill descriptions", () => {
    const { lastFrame, unmount } = render(
      <SkillsPane projectSkills={projectSkills} globalSkills={[]} selectedIndex={0} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Cut a release");
    unmount();
  });

  it("shows navigation hint", () => {
    const { lastFrame, unmount } = render(
      <SkillsPane projectSkills={projectSkills} globalSkills={globalSkills} selectedIndex={0} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("navigate");
    unmount();
  });
});

// ── MirrorsPane ───────────────────────────────────────────────────────────────

describe("MirrorsPane", () => {
  const mirrors: MirrorRow[] = [
    { harness: "claude", label: "Claude Code", target: ".claude/skills", status: "ok" },
    { harness: "codex", label: "OpenAI Codex", target: ".codex/skills", status: "unlinked" },
    { harness: "droid", label: "Factory Droid", target: ".factory/skills", status: "drift" },
  ];

  it("renders mirror labels", () => {
    const { lastFrame, unmount } = render(<MirrorsPane mirrors={mirrors} selectedIndex={0} />);
    const frame = lastFrame();
    expect(frame).toContain("Claude Code");
    expect(frame).toContain("OpenAI Codex");
    unmount();
  });

  it("shows ok status icon for synced mirror", () => {
    const { lastFrame, unmount } = render(<MirrorsPane mirrors={mirrors} selectedIndex={0} />);
    const frame = lastFrame();
    expect(frame).toContain("✓");
    unmount();
  });

  it("shows unlinked icon for unlinked mirror", () => {
    const { lastFrame, unmount } = render(<MirrorsPane mirrors={mirrors} selectedIndex={1} />);
    const frame = lastFrame();
    expect(frame).toContain("○");
    unmount();
  });

  it("shows drift icon for drifted mirror", () => {
    const { lastFrame, unmount } = render(<MirrorsPane mirrors={mirrors} selectedIndex={2} />);
    const frame = lastFrame();
    expect(frame).toContain("!");
    unmount();
  });

  it("shows selection marker on selected row", () => {
    const { lastFrame, unmount } = render(<MirrorsPane mirrors={mirrors} selectedIndex={1} />);
    const frame = lastFrame();
    expect(frame).toContain("▶");
    unmount();
  });

  it("shows action message when provided", () => {
    const { lastFrame, unmount } = render(
      <MirrorsPane mirrors={mirrors} selectedIndex={0} actionMessage="Linking claude…" />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Linking claude…");
    unmount();
  });

  it("shows navigation hint", () => {
    const { lastFrame, unmount } = render(<MirrorsPane mirrors={mirrors} selectedIndex={0} />);
    const frame = lastFrame();
    expect(frame).toContain("navigate");
    unmount();
  });

  it("shows empty state when no mirrors", () => {
    const { lastFrame, unmount } = render(<MirrorsPane mirrors={[]} selectedIndex={0} />);
    const frame = lastFrame();
    expect(frame).toContain("No harnesses detected");
    unmount();
  });
});

// ── McpPane ───────────────────────────────────────────────────────────────────

describe("McpPane", () => {
  const mcpRows: McpRow[] = [
    {
      name: "filesystem",
      kind: "stdio",
      hosts: {
        "claude-code": "synced",
        "claude-desktop": "unavailable",
        codex: "excluded",
        droid: "drift",
        cursor: "synced",
        opencode: "unavailable",
        gemini: "unavailable",
      },
    },
    {
      name: "github",
      kind: "stdio",
      hosts: {
        "claude-code": "synced",
        "claude-desktop": "synced",
        codex: "synced",
        droid: "synced",
        cursor: "excluded",
        opencode: "excluded",
        gemini: "excluded",
      },
    },
  ];

  it("renders server names", () => {
    const { lastFrame, unmount } = render(<McpPane rows={mcpRows} selectedIndex={0} />);
    const frame = lastFrame();
    expect(frame).toContain("filesystem");
    expect(frame).toContain("github");
    unmount();
  });

  it("renders host column headers", () => {
    const { lastFrame, unmount } = render(<McpPane rows={mcpRows} selectedIndex={0} />);
    const frame = lastFrame();
    expect(frame).toContain("CC");
    expect(frame).toContain("DR");
    unmount();
  });

  it("shows synced icon", () => {
    const { lastFrame, unmount } = render(<McpPane rows={mcpRows} selectedIndex={0} />);
    const frame = lastFrame();
    expect(frame).toContain("✓");
    unmount();
  });

  it("shows drift icon", () => {
    const { lastFrame, unmount } = render(<McpPane rows={mcpRows} selectedIndex={0} />);
    const frame = lastFrame();
    expect(frame).toContain("!");
    unmount();
  });

  it("shows selection marker", () => {
    const { lastFrame, unmount } = render(<McpPane rows={mcpRows} selectedIndex={1} />);
    const frame = lastFrame();
    expect(frame).toContain("▶");
    expect(frame).toContain("github");
    unmount();
  });

  it("shows dry-run output when provided", () => {
    const { lastFrame, unmount } = render(
      <McpPane rows={mcpRows} selectedIndex={0} dryRunOutput={["Plan: add 2 servers"]} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Plan: add 2 servers");
    unmount();
  });

  it("shows empty state when no servers", () => {
    const { lastFrame, unmount } = render(<McpPane rows={[]} selectedIndex={0} />);
    const frame = lastFrame();
    expect(frame).toContain("No MCP servers");
    unmount();
  });

  it("shows navigation hint", () => {
    const { lastFrame, unmount } = render(<McpPane rows={mcpRows} selectedIndex={0} />);
    const frame = lastFrame();
    expect(frame).toContain("navigate");
    unmount();
  });
});

// ── DoctorPane ────────────────────────────────────────────────────────────────

describe("DoctorPane", () => {
  const checks: DoctorCheck[] = [
    { section: "Colony", status: "ok", message: ".colony.json valid — my-colony@1.0.0" },
    {
      section: "Skills",
      status: "ok",
      message: "3 skill(s) found in skills/",
    },
    {
      section: "Registry",
      status: "warn",
      message: "1 skill(s) on disk missing from registry: new-skill",
      hint: "Run 'skdd forge' to register it.",
    },
    {
      section: "Mirrors",
      status: "error",
      message: ".claude/skills: mirror path does not exist",
      hint: "Run 'skdd link' to repair.",
    },
  ];

  it("renders section headers", () => {
    const { lastFrame, unmount } = render(<DoctorPane checks={checks} />);
    const frame = lastFrame();
    expect(frame).toContain("Colony");
    expect(frame).toContain("Skills");
    expect(frame).toContain("Registry");
    expect(frame).toContain("Mirrors");
    unmount();
  });

  it("shows ok check message", () => {
    const { lastFrame, unmount } = render(<DoctorPane checks={checks} />);
    const frame = lastFrame();
    expect(frame).toContain(".colony.json valid");
    unmount();
  });

  it("shows warn check with hint", () => {
    const { lastFrame, unmount } = render(<DoctorPane checks={checks} />);
    const frame = lastFrame();
    expect(frame).toContain("missing from registry");
    expect(frame).toContain("skdd forge");
    unmount();
  });

  it("shows error check message", () => {
    const { lastFrame, unmount } = render(<DoctorPane checks={checks} />);
    const frame = lastFrame();
    expect(frame).toContain("mirror path does not exist");
    unmount();
  });

  it("shows summary counts", () => {
    const { lastFrame, unmount } = render(<DoctorPane checks={checks} />);
    const frame = lastFrame();
    expect(frame).toContain("2 ok");
    expect(frame).toContain("1 warn");
    expect(frame).toContain("1 error");
    unmount();
  });

  it("shows loading state", () => {
    const { lastFrame, unmount } = render(<DoctorPane checks={[]} loading />);
    const frame = lastFrame();
    expect(frame).toContain("Running checks");
    unmount();
  });

  it("shows empty state when no checks and not loading", () => {
    const { lastFrame, unmount } = render(<DoctorPane checks={[]} />);
    const frame = lastFrame();
    expect(frame).toContain("No checks yet");
    unmount();
  });

  it("shows action message when provided", () => {
    const { lastFrame, unmount } = render(
      <DoctorPane checks={checks} actionMessage="Doctor checks refreshed" />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Doctor checks refreshed");
    unmount();
  });

  it("shows re-check hint", () => {
    const { lastFrame, unmount } = render(<DoctorPane checks={checks} />);
    const frame = lastFrame();
    expect(frame).toContain("r re-check");
    unmount();
  });

  it("shows only ok summary when all pass", () => {
    const allOk: DoctorCheck[] = [
      { section: "Colony", status: "ok", message: "colony ok" },
      { section: "Skills", status: "ok", message: "skills ok" },
    ];
    const { lastFrame, unmount } = render(<DoctorPane checks={allOk} />);
    const frame = lastFrame();
    expect(frame).toContain("2 ok");
    unmount();
  });
});

// ── Hub keypress — mirrors toggle ─────────────────────────────────────────────

describe("Hub keypress — mirrors toggle", () => {
  const makeData = (mirrors: MirrorRow[] = []): HubData => ({
    projectRoot: "/tmp/test",
    globalRoot: "/tmp/global",
    projectSkills: [],
    globalSkills: [],
    mirrors,
    mcpRows: [],
    doctorChecks: [],
  });

  it("Enter on ok mirror triggers unlink action", async () => {
    const mockUnlink = vi.fn().mockResolvedValue(undefined);
    const data = makeData([
      { harness: "claude", label: "Claude Code", target: ".claude/skills", status: "ok" },
    ]);
    const mockReloader = vi.fn().mockResolvedValue(data);

    const { stdin, unmount } = render(
      <Hub data={data} cwd="/tmp/test" actions={{ unlink: mockUnlink }} reloader={mockReloader} />,
    );

    // Switch to mirrors pane
    stdin.write("2");
    await new Promise((r) => setTimeout(r, 30));
    // Press Enter — selectedIndex=0 = ok mirror
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 100));

    expect(mockUnlink).toHaveBeenCalledWith({ harness: "claude", cwd: "/tmp/test" });
    unmount();
  });

  it("Enter on drift mirror triggers unlink action", async () => {
    const mockUnlink = vi.fn().mockResolvedValue(undefined);
    const data = makeData([
      { harness: "droid", label: "Factory Droid", target: ".factory/skills", status: "drift" },
    ]);
    const mockReloader = vi.fn().mockResolvedValue(data);

    const { stdin, unmount } = render(
      <Hub data={data} cwd="/tmp/test" actions={{ unlink: mockUnlink }} reloader={mockReloader} />,
    );

    stdin.write("2");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 100));

    expect(mockUnlink).toHaveBeenCalledWith({ harness: "droid", cwd: "/tmp/test" });
    unmount();
  });

  it("Enter on unlinked mirror triggers link action", async () => {
    const mockLink = vi.fn().mockResolvedValue(undefined);
    const data = makeData([
      { harness: "codex", label: "OpenAI Codex", target: ".codex/skills", status: "unlinked" },
    ]);
    const mockReloader = vi.fn().mockResolvedValue(data);

    const { stdin, unmount } = render(
      <Hub data={data} cwd="/tmp/test" actions={{ link: mockLink }} reloader={mockReloader} />,
    );

    stdin.write("2");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 100));

    expect(mockLink).toHaveBeenCalledWith({ harness: "codex", cwd: "/tmp/test" });
    unmount();
  });

  it("Enter on missing mirror triggers link action", async () => {
    const mockLink = vi.fn().mockResolvedValue(undefined);
    const data = makeData([
      { harness: "gemini", label: "Gemini CLI", target: ".gemini/skills", status: "missing" },
    ]);
    const mockReloader = vi.fn().mockResolvedValue(data);

    const { stdin, unmount } = render(
      <Hub data={data} cwd="/tmp/test" actions={{ link: mockLink }} reloader={mockReloader} />,
    );

    stdin.write("2");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 100));

    expect(mockLink).toHaveBeenCalledWith({ harness: "gemini", cwd: "/tmp/test" });
    unmount();
  });
});

// ── Hub keypress — MCP dry-run ────────────────────────────────────────────────

describe("Hub keypress — MCP dry-run", () => {
  const makeMcpRow = (): McpRow => ({
    name: "skdd-mcp",
    kind: "stdio",
    hosts: {
      "claude-code": "drift",
      "claude-desktop": "unavailable",
      codex: "synced",
      droid: "unavailable",
      cursor: "unavailable",
      opencode: "unavailable",
      gemini: "unavailable",
    },
  });

  const makeData = (mcpRows: McpRow[] = []): HubData => ({
    projectRoot: "/tmp/test",
    globalRoot: "/tmp/global",
    projectSkills: [],
    globalSkills: [],
    mirrors: [],
    mcpRows,
    doctorChecks: [],
  });

  it("d keypress renders dry-run plan lines inside MCP pane", async () => {
    const planLines = ["[claude-code] + skdd-mcp", "[codex] no changes"];
    const mockDryRun = vi.fn().mockResolvedValue(planLines);
    const data = makeData([makeMcpRow()]);
    const mockReloader = vi.fn().mockResolvedValue(data);

    const { stdin, lastFrame, unmount } = render(
      <Hub
        data={data}
        cwd="/tmp/test"
        actions={{ dryRunPlan: mockDryRun }}
        reloader={mockReloader}
      />,
    );

    // Switch to MCP pane
    stdin.write("3");
    await new Promise((r) => setTimeout(r, 30));
    // Press 'd' for dry-run
    stdin.write("d");
    await new Promise((r) => setTimeout(r, 100));

    const frame = lastFrame();
    expect(frame).toContain("[claude-code] + skdd-mcp");
    expect(frame).toContain("[codex] no changes");
    unmount();
  });
});

// ── buildMcpRows unit tests ───────────────────────────────────────────────────

describe("buildMcpRows", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "skdd-hub-mcp-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeAdapter = (
    available: boolean,
    serverNames: string[],
    planChanges: ServerChange[] = [],
  ): McpRowAdapter => ({
    available: () => available,
    read: () =>
      available
        ? { ok: true as const, serverNames, rawDoc: {} }
        : { ok: false as const, reason: "unavailable" },
    plan: (_canonical, _managed) => ({
      ok: true as const,
      changes: planChanges,
      filePath: "",
      finalDoc: {},
      warnings: [],
    }),
  });

  it("returns empty array when no mcp.json exists", () => {
    const rows = buildMcpRows(tmpDir);
    expect(rows).toEqual([]);
  });

  it("synced: server is managed and present in host config", () => {
    writeFileSync(
      join(tmpDir, "mcp.json"),
      JSON.stringify({ version: 1, servers: { myserver: { command: "npx", args: ["-y", "my"] } } }),
    );
    const adapters: Partial<Record<McpHostId, McpRowAdapter>> = {
      "claude-code": makeAdapter(true, ["myserver"]),
    };
    const rows = buildMcpRows(tmpDir, {
      adapters,
      loadManaged: (h) => (h === "claude-code" ? ["myserver"] : []),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hosts["claude-code"]).toBe("synced");
  });

  it("drift: server managed but absent from host config", () => {
    writeFileSync(
      join(tmpDir, "mcp.json"),
      JSON.stringify({ version: 1, servers: { myserver: { command: "npx", args: ["-y", "my"] } } }),
    );
    const adapters: Partial<Record<McpHostId, McpRowAdapter>> = {
      "claude-code": makeAdapter(true, []),
    };
    const rows = buildMcpRows(tmpDir, {
      adapters,
      loadManaged: (h) => (h === "claude-code" ? ["myserver"] : []),
    });
    expect(rows[0]?.hosts["claude-code"]).toBe("drift");
  });

  it("drift: server present in host but not managed by skdd", () => {
    writeFileSync(
      join(tmpDir, "mcp.json"),
      JSON.stringify({ version: 1, servers: { myserver: { command: "npx", args: ["-y", "my"] } } }),
    );
    const adapters: Partial<Record<McpHostId, McpRowAdapter>> = {
      "claude-code": makeAdapter(true, ["myserver"]),
    };
    const rows = buildMcpRows(tmpDir, {
      adapters,
      loadManaged: () => [],
    });
    expect(rows[0]?.hosts["claude-code"]).toBe("drift");
  });

  it("drift: adapter.read() fails (malformed host config)", () => {
    writeFileSync(
      join(tmpDir, "mcp.json"),
      JSON.stringify({ version: 1, servers: { myserver: { command: "npx", args: ["-y", "my"] } } }),
    );
    const adapters: Partial<Record<McpHostId, McpRowAdapter>> = {
      "claude-code": {
        available: () => true,
        read: () => ({ ok: false as const, reason: "parse error" }),
        plan: () => ({ ok: false as const, reason: "parse error" }),
      },
    };
    const rows = buildMcpRows(tmpDir, {
      adapters,
      loadManaged: () => ["myserver"],
    });
    expect(rows[0]?.hosts["claude-code"]).toBe("drift");
  });

  it("unavailable: adapter.available() returns false", () => {
    writeFileSync(
      join(tmpDir, "mcp.json"),
      JSON.stringify({ version: 1, servers: { myserver: { command: "npx", args: ["-y", "my"] } } }),
    );
    const adapters: Partial<Record<McpHostId, McpRowAdapter>> = {
      "claude-code": makeAdapter(false, []),
    };
    const rows = buildMcpRows(tmpDir, { adapters, loadManaged: () => [] });
    expect(rows[0]?.hosts["claude-code"]).toBe("unavailable");
  });

  it("excluded: server hosts allowlist excludes this host", () => {
    writeFileSync(
      join(tmpDir, "mcp.json"),
      JSON.stringify({
        version: 1,
        servers: { myserver: { command: "npx", args: ["-y", "my"], hosts: ["droid"] } },
      }),
    );
    const adapters: Partial<Record<McpHostId, McpRowAdapter>> = {
      "claude-code": makeAdapter(true, ["myserver"]),
      droid: makeAdapter(true, ["myserver"]),
    };
    const rows = buildMcpRows(tmpDir, {
      adapters,
      loadManaged: () => ["myserver"],
    });
    expect(rows[0]?.hosts["claude-code"]).toBe("excluded");
    expect(rows[0]?.hosts["droid"]).toBe("synced");
  });

  it("synced: managed + present + content equal (plan returns no changes)", () => {
    writeFileSync(
      join(tmpDir, "mcp.json"),
      JSON.stringify({ version: 1, servers: { myserver: { command: "npx", args: ["-y", "my"] } } }),
    );
    // plan returns no changes → content matches canonical → synced
    const adapters: Partial<Record<McpHostId, McpRowAdapter>> = {
      "claude-code": makeAdapter(true, ["myserver"], []),
    };
    const rows = buildMcpRows(tmpDir, {
      adapters,
      loadManaged: (h) => (h === "claude-code" ? ["myserver"] : []),
    });
    expect(rows[0]?.hosts["claude-code"]).toBe("synced");
  });

  it("drift: managed + present + content differs (plan returns update change)", () => {
    writeFileSync(
      join(tmpDir, "mcp.json"),
      JSON.stringify({ version: 1, servers: { myserver: { command: "npx", args: ["-y", "my"] } } }),
    );
    // plan returns an "update" change for myserver → content has drifted
    const adapters: Partial<Record<McpHostId, McpRowAdapter>> = {
      "claude-code": makeAdapter(true, ["myserver"], [{ op: "update", name: "myserver" }]),
    };
    const rows = buildMcpRows(tmpDir, {
      adapters,
      loadManaged: (h) => (h === "claude-code" ? ["myserver"] : []),
    });
    expect(rows[0]?.hosts["claude-code"]).toBe("drift");
  });
});
