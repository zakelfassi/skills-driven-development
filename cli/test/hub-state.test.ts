/**
 * Unit tests for hub/state.ts buildMcpRows — env-var expansion and intentional-skip detection.
 *
 * Bug 1: buildMcpRows was calling adapter.plan() with the unexpanded canonical config,
 *        so a server whose env contains ${VAR} would always appear as "drift" even after
 *        a correct sync (the host file holds the resolved value; the plan sees a diff).
 *        Fix: expand ${VAR} from process.env before calling plan; mark as "needs-env"
 *        when a variable is unresolved.
 *
 * Bug 2: The early `!isManaged || !isPresent` branch marked intentionally-omitted servers
 *        (e.g. disabled:true on claude-code/cursor/gemini, or any remote server on
 *        claude-desktop) as "drift", even though sync produced no change for them.
 *        Fix: consult the plan; if the plan emits no add/update for this server, treat
 *        it as "excluded" (in-intended-state), not "drift".
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildMcpRows, type McpRowAdapter } from "../src/hub/state.js";
import type { HostReadResult, HostSyncPlan, ServerChange } from "../src/lib/mcp/adapters/types.js";
import type { CanonicalMcpConfig } from "../src/lib/mcp/schema.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skdd-hub-state-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Write a canonical mcp.json under `dir`. */
function writeConfig(dir: string, config: CanonicalMcpConfig): void {
  writeFileSync(join(dir, "mcp.json"), JSON.stringify(config, null, 2));
}

/** Build a minimal ok HostSyncPlan with given changes. */
function okPlan(changes: ServerChange[] = []): HostSyncPlan {
  return { ok: true, changes, filePath: "/fake", finalDoc: {}, warnings: [] };
}

/**
 * Create a fixture McpRowAdapter.
 * - `planFn` receives the canonical config passed to adapter.plan() and can
 *   inspect it to assert env expansion happened.
 * - `serverNames` is what the host file currently contains.
 */
function makeAdapter(opts: {
  serverNames?: string[];
  planFn?: (canonical: CanonicalMcpConfig, managed: string[]) => HostSyncPlan;
  available?: boolean;
}): McpRowAdapter {
  return {
    available: () => opts.available ?? true,
    read: (): HostReadResult => ({
      ok: true,
      serverNames: opts.serverNames ?? [],
      rawDoc: {},
    }),
    plan: opts.planFn ?? ((_c, _m) => okPlan()),
  };
}

// ── Bug 1: ${VAR} env expansion ──────────────────────────────────────────────

describe("buildMcpRows — ${VAR} env expansion (bug 1)", () => {
  const ENV_VAR = "SKDD_TEST_HUB_SECRET_12345";

  afterEach(() => {
    delete process.env[ENV_VAR];
  });

  it("server with ${VAR} that resolves to the host value appears as 'synced' not 'drift'", () => {
    process.env[ENV_VAR] = "resolved-secret";

    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "env-srv": {
          command: "cmd",
          env: { SECRET: `\${${ENV_VAR}}` },
        },
      },
    };
    writeConfig(tmp, config);

    // The adapter's plan() checks whether the config it received has the
    // EXPANDED value — i.e. the fix passed the resolved value, not the placeholder.
    const adapter = makeAdapter({
      serverNames: ["env-srv"],
      planFn: (canonical, _managed) => {
        const srv = canonical.servers["env-srv"] as {
          command: string;
          env?: Record<string, string>;
        };
        const wasExpanded = srv.env?.SECRET === "resolved-secret";
        return wasExpanded ? okPlan() : okPlan([{ op: "update", name: "env-srv" }]);
      },
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": adapter },
      loadManaged: () => ["env-srv"],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].hosts["claude-code"]).toBe("synced");
  });

  it("server with ${VAR} whose var is unset shows 'needs-env' not 'drift'", () => {
    delete process.env[ENV_VAR]; // ensure unset

    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "env-srv": {
          command: "cmd",
          env: { SECRET: `\${${ENV_VAR}}` },
        },
      },
    };
    writeConfig(tmp, config);

    // Plan would produce no changes (server content matches except for unresolved var)
    const adapter = makeAdapter({
      serverNames: ["env-srv"],
      planFn: (_c, _m) => okPlan(),
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": adapter },
      loadManaged: () => ["env-srv"],
    });

    expect(rows[0].hosts["claude-code"]).toBe("needs-env");
  });

  it("server with ${VAR} in remote url shows 'needs-env' when var is unset", () => {
    delete process.env[ENV_VAR];

    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "remote-srv": {
          url: `https://mcp.example.com/\${${ENV_VAR}}/endpoint`,
          type: "http",
        },
      },
    };
    writeConfig(tmp, config);

    const adapter = makeAdapter({
      serverNames: ["remote-srv"],
      planFn: (_c, _m) => okPlan(),
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": adapter },
      loadManaged: () => ["remote-srv"],
    });

    expect(rows[0].hosts["claude-code"]).toBe("needs-env");
  });

  it("server with ${VAR} in remote url shows 'synced' when var resolves and plan is clean", () => {
    process.env[ENV_VAR] = "token123";

    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "remote-srv": {
          url: `https://mcp.example.com/\${${ENV_VAR}}/endpoint`,
          type: "http",
        },
      },
    };
    writeConfig(tmp, config);

    const adapter = makeAdapter({
      serverNames: ["remote-srv"],
      planFn: (canonical, _managed) => {
        const srv = canonical.servers["remote-srv"] as { url: string };
        const wasExpanded = srv.url === "https://mcp.example.com/token123/endpoint";
        return wasExpanded ? okPlan() : okPlan([{ op: "update", name: "remote-srv" }]);
      },
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": adapter },
      loadManaged: () => ["remote-srv"],
    });

    expect(rows[0].hosts["claude-code"]).toBe("synced");
  });

  it("server without ${VAR} is unaffected (still synced/drift based on plan)", () => {
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "plain-srv": { command: "npx", args: ["-y", "pkg"] },
      },
    };
    writeConfig(tmp, config);

    // Plan has no changes → synced
    const adapterSynced = makeAdapter({
      serverNames: ["plain-srv"],
      planFn: (_c, _m) => okPlan(),
    });
    const rowsSynced = buildMcpRows(tmp, {
      adapters: { "claude-code": adapterSynced },
      loadManaged: () => ["plain-srv"],
    });
    expect(rowsSynced[0].hosts["claude-code"]).toBe("synced");

    // Plan has an update → drift
    const adapterDrift = makeAdapter({
      serverNames: ["plain-srv"],
      planFn: (_c, _m) => okPlan([{ op: "update", name: "plain-srv" }]),
    });
    const rowsDrift = buildMcpRows(tmp, {
      adapters: { "claude-code": adapterDrift },
      loadManaged: () => ["plain-srv"],
    });
    expect(rowsDrift[0].hosts["claude-code"]).toBe("drift");
  });
});

// ── Bug 2: intentional skip → "excluded" not "drift" ────────────────────────

describe("buildMcpRows — intentional skip detection (bug 2)", () => {
  it("disabled server not in host config and plan emits no change → 'excluded'", () => {
    // e.g. disabled:true on claude-code: adapter omits the server → no add in plan
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "disabled-srv": { command: "echo", disabled: true },
      },
    };
    writeConfig(tmp, config);

    // Adapter intentionally skips disabled servers: plan returns no changes for it
    const adapter = makeAdapter({
      serverNames: [], // not present in host
      planFn: (_c, _m) => okPlan(), // plan emits no add
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": adapter },
      loadManaged: () => [], // never managed (adapter skipped it at sync time)
    });

    expect(rows[0].hosts["claude-code"]).toBe("excluded");
  });

  it("remote server on claude-desktop (plan emits no change) → 'excluded' not 'drift'", () => {
    // claude-desktop skips remote servers; plan returns no changes for them
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "remote-srv": { url: "https://mcp.example.com", type: "http" },
      },
    };
    writeConfig(tmp, config);

    const adapter = makeAdapter({
      serverNames: [], // not in host (never written)
      planFn: (_c, _m) => okPlan(), // no add — intentional skip
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-desktop": adapter },
      loadManaged: () => [],
    });

    expect(rows[0].hosts["claude-desktop"]).toBe("excluded");
  });

  it("server not yet synced (plan emits add) → 'drift'", () => {
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "new-srv": { command: "cmd" },
      },
    };
    writeConfig(tmp, config);

    // Plan would add the server → user needs to run sync
    const adapter = makeAdapter({
      serverNames: [],
      planFn: (_c, _m) => okPlan([{ op: "add", name: "new-srv" }]),
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": adapter },
      loadManaged: () => [],
    });

    expect(rows[0].hosts["claude-code"]).toBe("drift");
  });

  it("server in managed list but missing from host config → 'drift'", () => {
    // Server was previously synced (in managed) but is now absent from host
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "my-srv": { command: "cmd" },
      },
    };
    writeConfig(tmp, config);

    const adapter = makeAdapter({
      serverNames: [], // missing from host
      planFn: (_c, _m) => okPlan([{ op: "add", name: "my-srv" }]),
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": adapter },
      loadManaged: () => ["my-srv"], // was previously managed
    });

    expect(rows[0].hosts["claude-code"]).toBe("drift");
  });

  it("server present in host but not in managed list, plan emits no change → 'excluded'", () => {
    // e.g. server was removed from managed state (user unmanaged it) but is still in host
    // plan sees it's there but was asked not to touch it → no change → excluded
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "orphan-srv": { command: "cmd" },
      },
    };
    writeConfig(tmp, config);

    const adapter = makeAdapter({
      serverNames: ["orphan-srv"],
      planFn: (_c, _m) => okPlan(), // plan emits no change (server not touched)
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": adapter },
      loadManaged: () => [], // not managed
    });

    // Not managed → excluded (adapter doesn't touch it)
    expect(rows[0].hosts["claude-code"]).toBe("excluded");
  });

  it("hosts allowlist exclusion still yields 'excluded'", () => {
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "allowlisted-srv": {
          command: "cmd",
          hosts: ["droid" as import("../src/lib/mcp/schema.js").McpHostId],
        },
      },
    };
    writeConfig(tmp, config);

    const adapter = makeAdapter({ serverNames: [] });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": adapter },
      loadManaged: () => [],
    });

    // claude-code is not in the hosts allowlist → "excluded"
    expect(rows[0].hosts["claude-code"]).toBe("excluded");
  });
});

// ── Regression: existing correct behaviors still work ────────────────────────

describe("buildMcpRows — regression (unchanged behaviors)", () => {
  it("unavailable adapter → 'unavailable'", () => {
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: { "my-srv": { command: "cmd" } },
    };
    writeConfig(tmp, config);

    const adapter = makeAdapter({ available: false });
    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": adapter },
      loadManaged: () => [],
    });

    expect(rows[0].hosts["claude-code"]).toBe("unavailable");
  });

  it("read() returns ok:false → 'drift'", () => {
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: { "my-srv": { command: "cmd" } },
    };
    writeConfig(tmp, config);

    const brokenAdapter: McpRowAdapter = {
      available: () => true,
      read: () => ({ ok: false, reason: "parse error" }),
      plan: (_c, _m) => okPlan(),
    };

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": brokenAdapter },
      loadManaged: () => [],
    });

    expect(rows[0].hosts["claude-code"]).toBe("drift");
  });

  it("plan() returns ok:false → 'drift'", () => {
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: { "my-srv": { command: "cmd" } },
    };
    writeConfig(tmp, config);

    const adapter = makeAdapter({
      serverNames: ["my-srv"],
      planFn: (_c, _m) => ({ ok: false, reason: "malformed" }),
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": adapter },
      loadManaged: () => ["my-srv"],
    });

    expect(rows[0].hosts["claude-code"]).toBe("drift");
  });

  it("empty mcp.json returns empty rows", () => {
    // No mcp.json → null config → empty rows
    const rows = buildMcpRows(tmp);
    expect(rows).toHaveLength(0);
  });
});
