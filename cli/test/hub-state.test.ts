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
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildMcpRows,
  buildMirrorRows,
  loadHubData,
  type McpRowAdapter,
} from "../src/hub/state.js";
import { SKDD_HOME_ENV } from "../src/lib/global.js";
import type { HostReadResult, HostSyncPlan, ServerChange } from "../src/lib/mcp/adapters/types.js";
import type { CanonicalMcpConfig } from "../src/lib/mcp/schema.js";

const skipOnWindows = platform() === "win32";
const runUnix = skipOnWindows ? it.skip : it;

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
 * - `omitsDisabled` mirrors the real adapter capability (default: true for
 *   omitting-hosts like claude-code/cursor/gemini; false for persist-hosts).
 * - `acceptsRemote` mirrors the real adapter capability (default: true;
 *   false for stdio-only hosts like claude-desktop).
 */
function makeAdapter(opts: {
  serverNames?: string[];
  planFn?: (canonical: CanonicalMcpConfig, managed: string[]) => HostSyncPlan;
  available?: boolean;
  omitsDisabled?: boolean;
  acceptsRemote?: boolean;
}): McpRowAdapter {
  return {
    omitsDisabled: opts.omitsDisabled ?? true,
    acceptsRemote: opts.acceptsRemote,
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
      omitsDisabled: false,
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

// ── M5-A1: corrupt canonical config → onConfigError (not empty matrix) ───────

describe("buildMcpRows — corrupt mcp.json surfaces error via onConfigError (M5-A1)", () => {
  it("calls onConfigError with a reason when mcp.json has malformed JSON", () => {
    writeFileSync(join(tmp, "mcp.json"), "{ not valid json }", "utf8");

    let capturedError: string | undefined;
    const rows = buildMcpRows(tmp, {
      onConfigError: (r) => {
        capturedError = r;
      },
    });

    expect(rows).toHaveLength(0);
    expect(capturedError).toBeDefined();
    expect(capturedError).toBeTruthy();
  });

  it("calls onConfigError when mcp.json fails schema validation (wrong version)", () => {
    writeFileSync(join(tmp, "mcp.json"), JSON.stringify({ version: 99, servers: {} }), "utf8");

    let capturedError: string | undefined;
    buildMcpRows(tmp, {
      onConfigError: (r) => {
        capturedError = r;
      },
    });
    expect(capturedError).toBeDefined();
  });

  it("calls onConfigError when mcp.json has unknown host IDs in hosts array", () => {
    writeFileSync(
      join(tmp, "mcp.json"),
      JSON.stringify({ version: 1, servers: { srv: { command: "echo", hosts: ["claude"] } } }),
      "utf8",
    );

    let capturedError: string | undefined;
    buildMcpRows(tmp, {
      onConfigError: (r) => {
        capturedError = r;
      },
    });
    expect(capturedError).toBeDefined();
  });

  it("does NOT call onConfigError when mcp.json is absent (absent is not invalid)", () => {
    // No mcp.json in tmp → absent
    let called = false;
    const rows = buildMcpRows(tmp, {
      onConfigError: () => {
        called = true;
      },
    });

    expect(called).toBe(false);
    expect(rows).toHaveLength(0);
  });

  it("does NOT call onConfigError when mcp.json is valid", () => {
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: { "my-srv": { command: "cmd" } },
    };
    writeConfig(tmp, config);

    let called = false;
    buildMcpRows(tmp, {
      adapters: { "claude-code": makeAdapter({ serverNames: [] }) },
      loadManaged: () => [],
      onConfigError: () => {
        called = true;
      },
    });

    expect(called).toBe(false);
  });
});

// ── M5-A13: droid ${VAR} passthrough — no false drift ────────────────────────

describe("buildMcpRows — droid host skips env expansion (M5-A13)", () => {
  const DROID_VAR = "SKDD_TEST_DROID_SECRET_99991";

  afterEach(() => {
    delete process.env[DROID_VAR];
  });

  it("droid server with ${VAR} in env shows 'synced' (not 'drift') when env var is set", () => {
    // When the env var IS set, non-droid hosts would expand the value and potentially
    // see a diff if the droid file holds the unexpanded form. The droid host must skip
    // expansion so the plan receives the canonical ${VAR} form and correctly reports "synced".
    process.env[DROID_VAR] = "some-secret-value";

    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "droid-srv": {
          command: "cmd",
          env: { API_KEY: `\${${DROID_VAR}}` },
        },
      },
    };
    writeConfig(tmp, config);

    // The droid adapter receives the UNEXPANDED canonical (placeholder intact).
    // If expansion had happened, the adapter's plan would see a diff and return an update.
    const droidAdapter = makeAdapter({
      serverNames: ["droid-srv"],
      planFn: (canonical, _managed) => {
        const srv = canonical.servers["droid-srv"] as {
          command: string;
          env?: Record<string, string>;
        };
        // Verify the placeholder was NOT expanded
        const stillHasPlaceholder = srv.env?.API_KEY === `\${${DROID_VAR}}`;
        // If placeholder is present → plan ok (synced); if expanded → simulate diff
        return stillHasPlaceholder ? okPlan() : okPlan([{ op: "update", name: "droid-srv" }]);
      },
    });

    const rows = buildMcpRows(tmp, {
      adapters: { droid: droidAdapter },
      loadManaged: () => ["droid-srv"],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].hosts["droid"]).toBe("synced");
  });

  it("droid server with ${VAR} in env does NOT show 'needs-env' even when env var is unset", () => {
    // Droid stores ${VAR} verbatim — it's intentional, not a missing env issue.
    // If env var is not set, non-droid hosts show 'needs-env'. Droid should NOT.
    delete process.env[DROID_VAR];

    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "droid-srv": {
          command: "cmd",
          env: { API_KEY: `\${${DROID_VAR}}` },
        },
      },
    };
    writeConfig(tmp, config);

    // Adapter returns no changes → synced (droid file already has the placeholder)
    const droidAdapter = makeAdapter({
      serverNames: ["droid-srv"],
      planFn: (_c, _m) => okPlan(),
    });

    const rows = buildMcpRows(tmp, {
      adapters: { droid: droidAdapter },
      loadManaged: () => ["droid-srv"],
    });

    expect(rows[0].hosts["droid"]).toBe("synced");
    expect(rows[0].hosts["droid"]).not.toBe("needs-env");
  });

  it("non-droid host still expands ${VAR} and shows 'needs-env' when unset", () => {
    // Ensure the droid-specific passthrough doesn't accidentally affect other hosts.
    delete process.env[DROID_VAR];

    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "shared-srv": {
          command: "cmd",
          env: { KEY: `\${${DROID_VAR}}` },
        },
      },
    };
    writeConfig(tmp, config);

    const adapter = makeAdapter({
      serverNames: ["shared-srv"],
      planFn: (_c, _m) => okPlan(),
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": adapter },
      loadManaged: () => ["shared-srv"],
    });

    expect(rows[0].hosts["claude-code"]).toBe("needs-env");
  });
});

// ── M6 f-m6-hub-empty-removals: empty canonical + managed names → pending removals ──

describe("buildMcpRows — empty canonical + managed names → pending removals (M6)", () => {
  it("absent mcp.json + managed names for one host → calls onPendingRemovals with count", () => {
    // No mcp.json → absent canonical; managed state has 2 names for claude-code
    let capturedCount: number | undefined;
    const rows = buildMcpRows(tmp, {
      loadManaged: (hostId) => (hostId === "claude-code" ? ["srv1", "srv2"] : []),
      onPendingRemovals: (count) => {
        capturedCount = count;
      },
    });

    expect(rows).toHaveLength(0);
    expect(capturedCount).toBe(2);
  });

  it("valid mcp.json with zero servers + managed names → calls onPendingRemovals", () => {
    // mcp.json exists but servers:{} → canonical is effectively empty
    writeConfig(tmp, { version: 1, servers: {} });

    let capturedCount: number | undefined;
    const rows = buildMcpRows(tmp, {
      loadManaged: (hostId) => (hostId === "claude-code" ? ["old-srv"] : []),
      onPendingRemovals: (count) => {
        capturedCount = count;
      },
    });

    expect(rows).toHaveLength(0);
    expect(capturedCount).toBe(1);
  });

  it("absent canonical + no managed names → does NOT call onPendingRemovals", () => {
    let called = false;
    buildMcpRows(tmp, {
      loadManaged: () => [],
      onPendingRemovals: () => {
        called = true;
      },
    });

    expect(called).toBe(false);
  });

  it("absent canonical + managed names across multiple hosts → sums all hosts", () => {
    // claude-code: 2, codex: 1, droid: 3 → total 6
    let capturedCount: number | undefined;
    buildMcpRows(tmp, {
      loadManaged: (hostId) => {
        if (hostId === "claude-code") return ["a", "b"];
        if (hostId === "codex") return ["c"];
        if (hostId === "droid") return ["d", "e", "f"];
        return [];
      },
      onPendingRemovals: (count) => {
        capturedCount = count;
      },
    });

    expect(capturedCount).toBe(6);
  });

  it("invalid mcp.json → does NOT call onPendingRemovals (onConfigError is called instead)", () => {
    writeFileSync(join(tmp, "mcp.json"), "{ not valid json }", "utf8");

    let pendingCalled = false;
    let configErrorCalled = false;
    buildMcpRows(tmp, {
      loadManaged: (hostId) => (hostId === "claude-code" ? ["srv"] : []),
      onPendingRemovals: () => {
        pendingCalled = true;
      },
      onConfigError: () => {
        configErrorCalled = true;
      },
    });

    expect(pendingCalled).toBe(false);
    expect(configErrorCalled).toBe(true);
  });
});

// ── f-m8-hub-narrowing-removal: allowlist narrowing → pending removal as drift ──

describe("buildMcpRows — narrowed allowlist pending removal (f-m8)", () => {
  it("excluded by allowlist + managed + present in host → 'drift' (pending removal)", () => {
    // Server targets only 'droid'; claude-code is excluded by allowlist.
    // But claude-code still has the server in its config AND in managed state
    // (user previously synced it before narrowing the allowlist).
    // runMcpSync would REMOVE it on next sync → show as drift, not excluded.
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "narrowed-srv": {
          command: "cmd",
          hosts: ["droid" as import("../src/lib/mcp/schema.js").McpHostId],
        },
      },
    };
    writeConfig(tmp, config);

    const adapter = makeAdapter({
      serverNames: ["narrowed-srv"], // still present in host config
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": adapter },
      loadManaged: (hostId) => (hostId === "claude-code" ? ["narrowed-srv"] : []),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].hosts["claude-code"]).toBe("drift");
  });

  it("excluded by allowlist + NOT present in host → 'excluded' (already clean)", () => {
    // Server targets only 'droid'; claude-code is excluded.
    // claude-code does NOT have the server in its config (already removed or never added).
    // No pending removal needed → show as excluded.
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "narrowed-srv": {
          command: "cmd",
          hosts: ["droid" as import("../src/lib/mcp/schema.js").McpHostId],
        },
      },
    };
    writeConfig(tmp, config);

    const adapter = makeAdapter({
      serverNames: [], // not present in host config
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": adapter },
      loadManaged: () => [], // not managed either
    });

    expect(rows[0].hosts["claude-code"]).toBe("excluded");
  });

  it("excluded by allowlist + managed but NOT present in host → 'excluded'", () => {
    // In managed state but not in host config — was removed externally.
    // Still excluded by allowlist, and without a host entry there's nothing to remove.
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "narrowed-srv": {
          command: "cmd",
          hosts: ["droid" as import("../src/lib/mcp/schema.js").McpHostId],
        },
      },
    };
    writeConfig(tmp, config);

    const adapter = makeAdapter({
      serverNames: [], // not present in host config
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": adapter },
      loadManaged: (hostId) => (hostId === "claude-code" ? ["narrowed-srv"] : []),
    });

    // Managed but not present → no pending removal needed → excluded
    expect(rows[0].hosts["claude-code"]).toBe("excluded");
  });

  it("excluded by allowlist + present but NOT managed → 'excluded'", () => {
    // Present in host but was never managed by skdd (unmanaged entry).
    // Allowlist excludes the host; since it's not managed, skdd won't remove it.
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "narrowed-srv": {
          command: "cmd",
          hosts: ["droid" as import("../src/lib/mcp/schema.js").McpHostId],
        },
      },
    };
    writeConfig(tmp, config);

    const adapter = makeAdapter({
      serverNames: ["narrowed-srv"], // present but not managed
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": adapter },
      loadManaged: () => [], // not managed
    });

    expect(rows[0].hosts["claude-code"]).toBe("excluded");
  });

  it("narrowing on one host does not affect other hosts in the allowlist", () => {
    // Server targets droid only. droid itself should be synced; claude-code is excluded+managed+present → drift.
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "narrowed-srv": {
          command: "cmd",
          hosts: ["droid" as import("../src/lib/mcp/schema.js").McpHostId],
        },
      },
    };
    writeConfig(tmp, config);

    const droidAdapter = makeAdapter({
      serverNames: ["narrowed-srv"],
      planFn: (_c, _m) => okPlan(), // synced
    });
    const claudeAdapter = makeAdapter({
      serverNames: ["narrowed-srv"], // still present (pending removal)
    });

    const rows = buildMcpRows(tmp, {
      adapters: {
        droid: droidAdapter,
        "claude-code": claudeAdapter,
      },
      loadManaged: (hostId) => (["droid", "claude-code"].includes(hostId) ? ["narrowed-srv"] : []),
    });

    expect(rows[0].hosts["droid"]).toBe("synced");
    expect(rows[0].hosts["claude-code"]).toBe("drift");
  });
});

// ── f-m7-hub-mirror-accuracy: symlink target verification ────────────────────

describe("buildMirrorRows — symlink pointing at non-canonical target → 'drift'", () => {
  /** Write a minimal .skdd-sync.json state recording a symlink mirror. */
  function writeState(root: string, canonical: string, mirrorTarget: string): void {
    writeFileSync(
      join(root, ".skdd-sync.json"),
      JSON.stringify({
        version: 2,
        canonical,
        mirrors: [{ target: mirrorTarget, mode: "symlink", createdAt: "2026-01-01T00:00:00.000Z" }],
      }),
    );
  }

  runUnix("symlink pointing at a non-canonical target → status is 'drift'", () => {
    // Set up: canonical skills dir + a decoy dir
    mkdirSync(join(tmp, "skills"), { recursive: true });
    mkdirSync(join(tmp, "other-dir"), { recursive: true });
    mkdirSync(join(tmp, ".claude"), { recursive: true });
    // Symlink → ../other-dir (wrong — should be ../skills)
    symlinkSync("../other-dir", join(tmp, ".claude/skills"), "dir");
    writeState(tmp, "skills", ".claude/skills");

    const rows = buildMirrorRows(tmp);
    const claudeRow = rows.find((r) => r.harness === "claude");

    expect(claudeRow).toBeDefined();
    expect(claudeRow!.status).toBe("drift");
  });

  runUnix("symlink pointing at the canonical target → status is 'ok'", () => {
    mkdirSync(join(tmp, "skills"), { recursive: true });
    mkdirSync(join(tmp, ".claude"), { recursive: true });
    // Symlink → ../skills (correct)
    symlinkSync("../skills", join(tmp, ".claude/skills"), "dir");
    writeState(tmp, "skills", ".claude/skills");

    const rows = buildMirrorRows(tmp);
    const claudeRow = rows.find((r) => r.harness === "claude");

    expect(claudeRow).toBeDefined();
    expect(claudeRow!.status).toBe("ok");
  });

  it("regular directory (not a symlink) recorded as symlink → 'drift'", () => {
    mkdirSync(join(tmp, "skills"), { recursive: true });
    // Create a real directory instead of a symlink
    mkdirSync(join(tmp, ".claude/skills"), { recursive: true });
    writeState(tmp, "skills", ".claude/skills");

    const rows = buildMirrorRows(tmp);
    const claudeRow = rows.find((r) => r.harness === "claude");

    expect(claudeRow?.status).toBe("drift");
  });

  it("target missing → 'missing'", () => {
    mkdirSync(join(tmp, "skills"), { recursive: true });
    // Don't create .claude/skills
    writeState(tmp, "skills", ".claude/skills");

    const rows = buildMirrorRows(tmp);
    const claudeRow = rows.find((r) => r.harness === "claude");

    expect(claudeRow?.status).toBe("missing");
  });

  it("no recorded mirror → 'unlinked'", () => {
    const rows = buildMirrorRows(tmp);
    const claudeRow = rows.find((r) => r.harness === "claude");
    expect(claudeRow?.status).toBe("unlinked");
  });
});

// ── f-m7-hub-mirror-accuracy: malformed registry → error state ───────────────

describe("loadHubData — malformed registry → registryError set, does not throw", () => {
  let skddTmp: string;

  beforeEach(() => {
    skddTmp = mkdtempSync(join(tmpdir(), "skdd-hub-reg-global-"));
  });

  afterEach(() => {
    delete process.env[SKDD_HOME_ENV];
    rmSync(skddTmp, { recursive: true, force: true });
  });

  it("malformed project .skills-registry.json → registryError set, projectSkills empty", async () => {
    writeFileSync(join(tmp, ".skills-registry.json"), "{ not valid json }", "utf8");
    process.env[SKDD_HOME_ENV] = skddTmp;

    const data = await loadHubData(tmp);

    expect(data.registryError).toBeDefined();
    expect(data.registryError).toMatch(/project registry/);
    expect(data.projectSkills).toHaveLength(0);
    // global registry was clean (empty skddTmp) → no global error
    expect(data.registryError).not.toMatch(/global registry/);
  });

  it("malformed global .skills-registry.json → registryError set, globalSkills empty", async () => {
    writeFileSync(join(skddTmp, ".skills-registry.json"), "{ not valid json }", "utf8");
    process.env[SKDD_HOME_ENV] = skddTmp;

    const data = await loadHubData(tmp);

    expect(data.registryError).toBeDefined();
    expect(data.registryError).toMatch(/global registry/);
    expect(data.globalSkills).toHaveLength(0);
  });

  it("both registries malformed → registryError contains both messages", async () => {
    writeFileSync(join(tmp, ".skills-registry.json"), "{ not valid json }", "utf8");
    writeFileSync(join(skddTmp, ".skills-registry.json"), "{ not valid json }", "utf8");
    process.env[SKDD_HOME_ENV] = skddTmp;

    const data = await loadHubData(tmp);

    expect(data.registryError).toBeDefined();
    expect(data.registryError).toMatch(/project registry/);
    expect(data.registryError).toMatch(/global registry/);
    expect(data.projectSkills).toHaveLength(0);
    expect(data.globalSkills).toHaveLength(0);
  });

  it("valid registry → no registryError", async () => {
    process.env[SKDD_HOME_ENV] = skddTmp;

    const data = await loadHubData(tmp);

    expect(data.registryError).toBeUndefined();
  });
});

// ── f-m9-hub-needs-env: adapter intent before needs-env ──────────────────────

describe("buildMcpRows — adapter intent checked before needs-env (f-m9)", () => {
  const UNSET_VAR = "SKDD_TEST_M9_SECRET_77773";

  afterEach(() => {
    delete process.env[UNSET_VAR];
  });

  it("disabled server + unset env on omitting-host (omitsDisabled=true) → excluded, NOT needs-env", () => {
    // Server is disabled; on a host like claude-code that omits disabled entries,
    // the adapter would skip the entry regardless of whether env vars are set.
    // The hub should show 'excluded' (adapter-intent), not 'needs-env'.
    delete process.env[UNSET_VAR];

    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "disabled-env-srv": {
          command: "cmd",
          env: { KEY: `\${${UNSET_VAR}}` },
          disabled: true,
        },
      },
    };
    writeConfig(tmp, config);

    // Adapter omits disabled entries; plan returns no add (server is intentionally absent)
    const adapter = makeAdapter({
      serverNames: [],
      planFn: (_c, _m) => okPlan(),
      omitsDisabled: true,
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": adapter },
      loadManaged: () => [],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].hosts["claude-code"]).toBe("excluded");
    expect(rows[0].hosts["claude-code"]).not.toBe("needs-env");
  });

  it("disabled server + unset env + managed+present → drift (pending removal), NOT needs-env", () => {
    // Server is disabled on an omitting-host; still present in host config (not yet removed).
    // Adapter would remove it on next sync — show as 'drift', not 'needs-env'.
    delete process.env[UNSET_VAR];

    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "disabled-env-srv": {
          command: "cmd",
          env: { KEY: `\${${UNSET_VAR}}` },
          disabled: true,
        },
      },
    };
    writeConfig(tmp, config);

    // Adapter plans a removal (entry is still in host config)
    const adapter = makeAdapter({
      serverNames: ["disabled-env-srv"],
      planFn: (_c, _m) => okPlan([{ op: "remove", name: "disabled-env-srv" }]),
      omitsDisabled: true,
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": adapter },
      loadManaged: () => ["disabled-env-srv"],
    });

    expect(rows[0].hosts["claude-code"]).toBe("drift");
    expect(rows[0].hosts["claude-code"]).not.toBe("needs-env");
  });

  it("remote server + unset url on stdio-only host (acceptsRemote=false) → excluded, NOT needs-env", () => {
    // Claude Desktop is stdio-only; remote servers are skipped regardless of URL value.
    // When the URL has an unresolved placeholder, hub should show 'excluded', not 'needs-env'.
    delete process.env[UNSET_VAR];

    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "remote-env-srv": {
          url: `https://mcp.example.com/\${${UNSET_VAR}}/endpoint`,
          type: "http",
        },
      },
    };
    writeConfig(tmp, config);

    // Adapter skips remote servers; plan returns no add
    const adapter = makeAdapter({
      serverNames: [],
      planFn: (_c, _m) => okPlan(),
      omitsDisabled: true,
      acceptsRemote: false, // stdio-only host (e.g. claude-desktop)
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-desktop": adapter },
      loadManaged: () => [],
    });

    expect(rows[0].hosts["claude-desktop"]).toBe("excluded");
    expect(rows[0].hosts["claude-desktop"]).not.toBe("needs-env");
  });

  it("genuinely intended server + unset env on normal host → still needs-env", () => {
    // A non-disabled stdio server targeted at a host that supports it: if env vars
    // are missing, the server cannot be synced → should still show 'needs-env'.
    delete process.env[UNSET_VAR];

    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "intended-srv": {
          command: "cmd",
          env: { KEY: `\${${UNSET_VAR}}` },
        },
      },
    };
    writeConfig(tmp, config);

    const adapter = makeAdapter({
      serverNames: [],
      planFn: (_c, _m) => okPlan([{ op: "add", name: "intended-srv" }]),
      omitsDisabled: true,
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": adapter },
      loadManaged: () => [],
    });

    expect(rows[0].hosts["claude-code"]).toBe("needs-env");
  });

  it("disabled server on persist-host (omitsDisabled=false) + unset env → still needs-env", () => {
    // On droid/opencode/codex (omitsDisabled=false), a disabled server is kept in
    // the host config with a native disabled marker. The server IS still intended
    // (it needs to be written as disabled), so unresolved env → needs-env.
    delete process.env[UNSET_VAR];

    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "disabled-env-srv": {
          command: "cmd",
          env: { KEY: `\${${UNSET_VAR}}` },
          disabled: true,
        },
      },
    };
    writeConfig(tmp, config);

    const adapter = makeAdapter({
      serverNames: [],
      planFn: (_c, _m) => okPlan([{ op: "add", name: "disabled-env-srv" }]),
      omitsDisabled: false, // persist-host (droid, opencode, codex)
    });

    const rows = buildMcpRows(tmp, {
      adapters: { opencode: adapter },
      loadManaged: () => [],
    });

    expect(rows[0].hosts["opencode"]).toBe("needs-env");
  });

  it("remote server + unset url + managed+present on stdio-only host (claude-desktop) → drift, NOT needs-env (M9-A2)", () => {
    // M9-A2: A remote server (url with unresolved placeholder) is managed and
    // still present in a stdio-only host (claude-desktop, acceptsRemote=false).
    // The adapter plans a removal (it should never have been written there).
    // Hub must show 'drift' (pending removal), NOT 'needs-env'.
    delete process.env[UNSET_VAR];

    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "remote-managed-srv": {
          url: `https://mcp.example.com/\${${UNSET_VAR}}/endpoint`,
          type: "http",
        },
      },
    };
    writeConfig(tmp, config);

    // Server is present in host config AND adapter plans removal
    const adapter = makeAdapter({
      serverNames: ["remote-managed-srv"],
      planFn: (_c, _m) => okPlan([{ op: "remove", name: "remote-managed-srv" }]),
      omitsDisabled: true,
      acceptsRemote: false, // stdio-only host (claude-desktop)
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-desktop": adapter },
      loadManaged: () => ["remote-managed-srv"],
    });

    expect(rows[0].hosts["claude-desktop"]).toBe("drift");
    expect(rows[0].hosts["claude-desktop"]).not.toBe("needs-env");
  });
});

// ── f-m17: buildMirrorRows driftKind — safe vs unsafe drift ──────────────────

describe("buildMirrorRows — driftKind (f-m17)", () => {
  /** Write a minimal .skdd-sync.json recording a mirror with given mode. */
  function writeState(
    root: string,
    canonical: string,
    mirrorTarget: string,
    mode: "symlink" | "copy",
  ): void {
    writeFileSync(
      join(root, ".skdd-sync.json"),
      JSON.stringify({
        version: 2,
        canonical,
        mirrors: [{ target: mirrorTarget, mode, createdAt: "2026-01-01T00:00:00.000Z" }],
      }),
    );
  }

  runUnix("wrong-target symlink (recorded symlink, points elsewhere) → driftKind: safe", () => {
    mkdirSync(join(tmp, "skills"), { recursive: true });
    mkdirSync(join(tmp, "other-dir"), { recursive: true });
    mkdirSync(join(tmp, ".claude"), { recursive: true });
    // Symlink → ../other-dir (wrong target)
    symlinkSync("../other-dir", join(tmp, ".claude/skills"), "dir");
    writeState(tmp, "skills", ".claude/skills", "symlink");

    const rows = buildMirrorRows(tmp);
    const row = rows.find((r) => r.harness === "claude");
    expect(row?.status).toBe("drift");
    expect(row?.driftKind).toBe("safe");
  });

  runUnix("recorded copy mode but actual symlink exists → driftKind: safe", () => {
    mkdirSync(join(tmp, "skills"), { recursive: true });
    mkdirSync(join(tmp, ".claude"), { recursive: true });
    // Symlink exists, but state says it should be a copy
    symlinkSync("../skills", join(tmp, ".claude/skills"), "dir");
    writeState(tmp, "skills", ".claude/skills", "copy");

    const rows = buildMirrorRows(tmp);
    const row = rows.find((r) => r.harness === "claude");
    expect(row?.status).toBe("drift");
    expect(row?.driftKind).toBe("safe");
  });

  it("recorded symlink mode but real directory exists (unmanaged) → driftKind: unsafe", () => {
    mkdirSync(join(tmp, "skills"), { recursive: true });
    // Real directory, not a symlink — unmanaged user data
    mkdirSync(join(tmp, ".claude/skills"), { recursive: true });
    writeState(tmp, "skills", ".claude/skills", "symlink");

    const rows = buildMirrorRows(tmp);
    const row = rows.find((r) => r.harness === "claude");
    expect(row?.status).toBe("drift");
    expect(row?.driftKind).toBe("unsafe");
  });

  it("ok mirror has no driftKind", () => {
    // We can't create a real ok symlink in a unit test without Unix, but we can
    // test that a non-drift row has no driftKind by checking the missing case.
    const rows = buildMirrorRows(tmp); // no state → all unlinked
    for (const row of rows) {
      expect(row.driftKind).toBeUndefined();
    }
  });

  it("missing mirror has no driftKind", () => {
    mkdirSync(join(tmp, "skills"), { recursive: true });
    writeState(tmp, "skills", ".claude/skills", "symlink");

    const rows = buildMirrorRows(tmp);
    const row = rows.find((r) => r.harness === "claude");
    expect(row?.status).toBe("missing");
    expect(row?.driftKind).toBeUndefined();
  });
});

// ── f-m17-hub-copy-drift: copy mirror stale-content detection ────────────────

describe("buildMirrorRows — copy mirror stale-content detection (f-m17-hub-copy-drift)", () => {
  /** Write a minimal .skdd-sync.json recording a copy-mode mirror. */
  function writeCopyState(root: string, canonical: string, mirrorTarget: string): void {
    writeFileSync(
      join(root, ".skdd-sync.json"),
      JSON.stringify({
        version: 2,
        canonical,
        mirrors: [{ target: mirrorTarget, mode: "copy", createdAt: "2026-01-01T00:00:00.000Z" }],
      }),
    );
  }

  it("copy mirror whose contents match canonical → ok", () => {
    // Canonical skills dir with one skill file
    mkdirSync(join(tmp, "skills/my-skill"), { recursive: true });
    writeFileSync(join(tmp, "skills/my-skill/SKILL.md"), "# My Skill\n", "utf8");

    // Copy dir with identical content
    mkdirSync(join(tmp, ".claude/skills/my-skill"), { recursive: true });
    writeFileSync(join(tmp, ".claude/skills/my-skill/SKILL.md"), "# My Skill\n", "utf8");

    writeCopyState(tmp, "skills", ".claude/skills");

    const rows = buildMirrorRows(tmp);
    const row = rows.find((r) => r.harness === "claude");

    expect(row?.status).toBe("ok");
    expect(row?.driftKind).toBeUndefined();
  });

  it("copy mirror stale — canonical has an extra file → drift (safe)", () => {
    // Canonical skills dir with two skill files
    mkdirSync(join(tmp, "skills/my-skill"), { recursive: true });
    writeFileSync(join(tmp, "skills/my-skill/SKILL.md"), "# My Skill\n", "utf8");
    writeFileSync(join(tmp, "skills/my-skill/extra.md"), "extra content\n", "utf8");

    // Copy dir only has the first file (stale — missing extra.md)
    mkdirSync(join(tmp, ".claude/skills/my-skill"), { recursive: true });
    writeFileSync(join(tmp, ".claude/skills/my-skill/SKILL.md"), "# My Skill\n", "utf8");

    writeCopyState(tmp, "skills", ".claude/skills");

    const rows = buildMirrorRows(tmp);
    const row = rows.find((r) => r.harness === "claude");

    expect(row?.status).toBe("drift");
    expect(row?.driftKind).toBe("safe");
  });

  it("copy mirror stale — canonical file has updated content → drift (safe)", () => {
    mkdirSync(join(tmp, "skills/my-skill"), { recursive: true });
    writeFileSync(join(tmp, "skills/my-skill/SKILL.md"), "# Updated Skill\n", "utf8");

    mkdirSync(join(tmp, ".claude/skills/my-skill"), { recursive: true });
    writeFileSync(join(tmp, ".claude/skills/my-skill/SKILL.md"), "# Old Skill\n", "utf8");

    writeCopyState(tmp, "skills", ".claude/skills");

    const rows = buildMirrorRows(tmp);
    const row = rows.find((r) => r.harness === "claude");

    expect(row?.status).toBe("drift");
    expect(row?.driftKind).toBe("safe");
  });

  runUnix("symlink mirror still reports ok when pointing at canonical → unchanged behavior", () => {
    mkdirSync(join(tmp, "skills"), { recursive: true });
    mkdirSync(join(tmp, ".claude"), { recursive: true });
    // Correct symlink → ../skills
    symlinkSync("../skills", join(tmp, ".claude/skills"), "dir");

    writeFileSync(
      join(tmp, ".skdd-sync.json"),
      JSON.stringify({
        version: 2,
        canonical: "skills",
        mirrors: [
          { target: ".claude/skills", mode: "symlink", createdAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    );

    const rows = buildMirrorRows(tmp);
    const row = rows.find((r) => r.harness === "claude");

    expect(row?.status).toBe("ok");
    expect(row?.driftKind).toBeUndefined();
  });
});

// ── f-m17-hub-mcp-intent-read: intent-before-read + skip-warning fix ─────────

describe("buildMcpRows — intent checked before reading host config (f-m17-hub-mcp-intent-read)", () => {
  it("malformed irrelevant host (no intended + no managed) → excluded, read() NOT called", () => {
    // Server is disabled on an omitting-host (isIntendedForHost=false).
    // The host config is malformed (read() returns ok:false).
    // Before the fix, the hub would call read(), see ok:false, and mark drift.
    // After the fix, read() must NOT be called — the host is irrelevant.
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "disabled-srv": { command: "echo", disabled: true },
      },
    };
    writeConfig(tmp, config);

    let readCalled = false;
    const malformedAdapter: McpRowAdapter = {
      omitsDisabled: true,
      available: () => true,
      read: (): HostReadResult => {
        readCalled = true;
        return { ok: false, reason: "malformed host config" };
      },
      plan: (_c, _m) => okPlan(),
    };

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": malformedAdapter },
      loadManaged: () => [], // no managed names — nothing to clean up
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].hosts["claude-code"]).toBe("excluded");
    expect(readCalled).toBe(false);
  });

  it("disabled-on-omitting + no managed → excluded without reading host config", () => {
    // Disabled server on an omitting-host (claude-code): adapter omits it.
    // No managed entry → nothing to clean up → show excluded immediately.
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "disabled-srv": { command: "echo", disabled: true },
      },
    };
    writeConfig(tmp, config);

    let readCalled = false;
    const adapter = makeAdapter({
      serverNames: [],
      planFn: (_c, _m) => okPlan(),
      omitsDisabled: true,
    });
    // Wrap read() to detect if it is called
    const wrappedAdapter: McpRowAdapter = {
      ...adapter,
      read: (): HostReadResult => {
        readCalled = true;
        return adapter.read();
      },
    };

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": wrappedAdapter },
      loadManaged: () => [],
    });

    expect(rows[0].hosts["claude-code"]).toBe("excluded");
    expect(readCalled).toBe(false);
  });

  it("unsupported remote on stdio-only host WITH a same-name local entry → excluded, not conflict", () => {
    // Remote server in canonical config. Claude-desktop is stdio-only
    // (acceptsRemote=false) → server is not intended for this host.
    // User has a local same-name entry (isPresent=true) but it is NOT managed.
    // The adapter emits a skip warning mentioning the server name.
    // Before the fix: warning check would mark as drift/conflict.
    // After the fix: isIntendedForHost=false → excluded, not conflict.
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "remote-srv": { url: "https://mcp.example.com", type: "http" },
      },
    };
    writeConfig(tmp, config);

    const adapter = makeAdapter({
      serverNames: ["remote-srv"], // same-name local entry exists in host
      planFn: (_c, _m) => ({
        ok: true as const,
        changes: [],
        filePath: "/fake",
        finalDoc: {},
        warnings: [`skipping "remote-srv": unsupported server type for this host`],
      }),
      omitsDisabled: true,
      acceptsRemote: false, // stdio-only host (e.g. claude-desktop)
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-desktop": adapter },
      loadManaged: () => [], // not managed by skdd
    });

    expect(rows[0].hosts["claude-desktop"]).toBe("excluded");
  });

  it("genuine unmanaged same-name collision on supported host → still drift/conflict", () => {
    // Server IS intended for this host (stdio, not disabled, omitsDisabled=true).
    // Plan emits a warning about the server name (unmanaged entry blocks sync).
    // isPresent=true, isManaged=false.
    // This should still be reported as drift — a real conflict the user must resolve.
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "conflict-srv": { command: "cmd" },
      },
    };
    writeConfig(tmp, config);

    const adapter = makeAdapter({
      serverNames: ["conflict-srv"], // present in host (unmanaged)
      planFn: (_c, _m) => ({
        ok: true as const,
        changes: [], // plan emits no add (blocked by collision)
        filePath: "/fake",
        finalDoc: {},
        warnings: [`unmanaged entry "conflict-srv" already exists; skipping`],
      }),
      omitsDisabled: true,
    });

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-code": adapter },
      loadManaged: () => [], // not managed by skdd
    });

    expect(rows[0].hosts["claude-code"]).toBe("drift");
  });

  it("non-intended server with managed cleanup pending still reads host config", () => {
    // Server is remote on a stdio-only host (not intended).
    // BUT it IS in the managed list (was previously synced, now host changed).
    // We must still read to check for pending removal — no early exit.
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "remote-srv": { url: "https://mcp.example.com", type: "http" },
      },
    };
    writeConfig(tmp, config);

    let readCalled = false;
    const adapter = makeAdapter({
      serverNames: ["remote-srv"],
      planFn: (_c, _m) => okPlan([{ op: "remove", name: "remote-srv" }]),
      omitsDisabled: true,
      acceptsRemote: false,
    });
    const wrappedAdapter: McpRowAdapter = {
      ...adapter,
      read: (): HostReadResult => {
        readCalled = true;
        return adapter.read();
      },
    };

    const rows = buildMcpRows(tmp, {
      adapters: { "claude-desktop": wrappedAdapter },
      loadManaged: () => ["remote-srv"], // managed — pending removal
    });

    // Managed + plan has removal → drift (pending removal)
    expect(rows[0].hosts["claude-desktop"]).toBe("drift");
    expect(readCalled).toBe(true); // read() WAS called — managed cleanup pending
  });
});
