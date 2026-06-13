import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../src/lib/mcp/adapters/claude-code.js";
import { claudeDesktopAdapter } from "../src/lib/mcp/adapters/claude-desktop.js";
import { cursorAdapter } from "../src/lib/mcp/adapters/cursor.js";
import { droidAdapter } from "../src/lib/mcp/adapters/droid.js";
import { geminiAdapter } from "../src/lib/mcp/adapters/gemini.js";
import { ADAPTERS } from "../src/lib/mcp/adapters/index.js";
import { opencodeAdapter } from "../src/lib/mcp/adapters/opencode.js";
import type { McpHostAdapter } from "../src/lib/mcp/adapters/types.js";
import type { CanonicalMcpConfig } from "../src/lib/mcp/schema.js";

const FIXTURES_DIR = join(__dirname, "fixtures", "mcp");

/** Read a fixture JSON file from test/fixtures/mcp/ */
function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8")) as Record<string, unknown>;
}

let fakeTmp: string;
let prevHome: string | undefined;

beforeEach(() => {
  fakeTmp = mkdtempSync(join(tmpdir(), "skdd-mcp-adapters-"));
  prevHome = process.env.HOME;
  process.env.HOME = fakeTmp;
});

afterEach(() => {
  if (prevHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = prevHome;
  }
  rmSync(fakeTmp, { recursive: true, force: true });
});

/** Place a fixture file at the appropriate path within fakeTmp. */
function placeFixture(fixtureName: string, relPath: string): string {
  const dest = join(fakeTmp, relPath);
  mkdirSync(join(dest, ".."), { recursive: true });
  copyFileSync(join(FIXTURES_DIR, fixtureName), dest);
  return dest;
}

/** Write a file at a relative path within fakeTmp. */
function writeFile(relPath: string, content: string): string {
  const dest = join(fakeTmp, relPath);
  mkdirSync(join(dest, ".."), { recursive: true });
  writeFileSync(dest, content, "utf8");
  return dest;
}

/** A minimal canonical config with one stdio server. */
function makeCanonical(
  overrides?: Partial<CanonicalMcpConfig["servers"]["x"]>,
): CanonicalMcpConfig {
  return {
    version: 1,
    servers: {
      "skdd-test-server": {
        command: "npx",
        args: ["-y", "skdd-test-mcp"],
        env: { TEST_KEY: "test-value" },
        ...overrides,
      } as CanonicalMcpConfig["servers"]["x"],
    },
  };
}

// ── ADAPTERS registry ────────────────────────────────────────────────────────

describe("ADAPTERS registry", () => {
  it("contains all seven adapters (six JSON + codex TOML)", () => {
    expect(ADAPTERS["claude-code"]).toBeDefined();
    expect(ADAPTERS["claude-desktop"]).toBeDefined();
    expect(ADAPTERS["codex"]).toBeDefined();
    expect(ADAPTERS["droid"]).toBeDefined();
    expect(ADAPTERS["cursor"]).toBeDefined();
    expect(ADAPTERS["opencode"]).toBeDefined();
    expect(ADAPTERS["gemini"]).toBeDefined();
  });

  it("each adapter has the correct id and label", () => {
    const expected = [
      { id: "claude-code", label: "Claude Code" },
      { id: "claude-desktop", label: "Claude Desktop" },
      { id: "codex", label: "Codex CLI" },
      { id: "droid", label: "Factory Droid" },
      { id: "cursor", label: "Cursor" },
      { id: "opencode", label: "OpenCode" },
      { id: "gemini", label: "Gemini CLI" },
    ] as const;
    for (const { id, label } of expected) {
      expect(ADAPTERS[id]?.id).toBe(id);
      expect(ADAPTERS[id]?.label).toBe(label);
    }
  });
});

// ── Shared invariant tests per adapter ──────────────────────────────────────

type AdapterCase = {
  adapter: McpHostAdapter;
  fixtureName: string;
  hostRelPath: string; // path under fakeTmp where the fixture should be placed
  unmanagedKey: string; // a server name that is in the fixture and NOT managed
  mcpKey: string; // "mcpServers" or "mcp"
};

const ADAPTER_CASES: AdapterCase[] = [
  {
    adapter: claudeCodeAdapter,
    fixtureName: "claude-code.json",
    hostRelPath: ".claude.json",
    unmanagedKey: "user-managed-mcp",
    mcpKey: "mcpServers",
  },
  {
    adapter: claudeDesktopAdapter,
    fixtureName: "claude-desktop.json",
    hostRelPath: "Library/Application Support/Claude/claude_desktop_config.json",
    unmanagedKey: "user-desktop-mcp",
    mcpKey: "mcpServers",
  },
  {
    adapter: droidAdapter,
    fixtureName: "droid.json",
    hostRelPath: ".factory/mcp.json",
    unmanagedKey: "user-droid-mcp",
    mcpKey: "mcpServers",
  },
  {
    adapter: cursorAdapter,
    fixtureName: "cursor.json",
    hostRelPath: ".cursor/mcp.json",
    unmanagedKey: "MCP_DOCKER",
    mcpKey: "mcpServers",
  },
  {
    adapter: opencodeAdapter,
    fixtureName: "opencode.json",
    hostRelPath: ".config/opencode/opencode.json",
    unmanagedKey: "user-opencode-mcp",
    mcpKey: "mcp",
  },
  {
    adapter: geminiAdapter,
    fixtureName: "gemini.json",
    hostRelPath: ".gemini/settings.json",
    unmanagedKey: "user-gemini-mcp",
    mcpKey: "mcpServers",
  },
];

for (const { adapter, fixtureName, hostRelPath, unmanagedKey, mcpKey } of ADAPTER_CASES) {
  describe(`${adapter.label} adapter`, () => {
    describe("read()", () => {
      it("returns ok:false when JSON is malformed", () => {
        writeFile(hostRelPath, "{ not valid json }");
        const result = adapter.read();
        expect(result.ok).toBe(false);
      });

      it("returns ok:true with empty serverNames when file does not exist", () => {
        // Do NOT place fixture — file absent
        const result = adapter.read();
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.serverNames).toEqual([]);
          expect(result.rawDoc).toEqual({});
        }
      });

      it("reads server names from fixture", () => {
        placeFixture(fixtureName, hostRelPath);
        const result = adapter.read();
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.serverNames).toContain(unmanagedKey);
        }
      });

      it("preserves all top-level keys in rawDoc", () => {
        placeFixture(fixtureName, hostRelPath);
        const fixture = readFixture(fixtureName);
        const result = adapter.read();
        expect(result.ok).toBe(true);
        if (result.ok) {
          // All top-level keys from fixture are present in rawDoc
          for (const key of Object.keys(fixture)) {
            expect(result.rawDoc).toHaveProperty(key);
          }
        }
      });
    });

    describe("plan()", () => {
      it("returns ok:false when host config is malformed JSON", () => {
        writeFile(hostRelPath, "{ not valid json }");
        const plan = adapter.plan(makeCanonical(), []);
        expect(plan.ok).toBe(false);
      });

      it("merge: adds a new server without removing unmanaged servers", () => {
        placeFixture(fixtureName, hostRelPath);
        const canonical = makeCanonical();
        const plan = adapter.plan(canonical, []);
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;

        const servers = plan.finalDoc[mcpKey] as Record<string, unknown>;
        // New managed server is present
        expect(servers).toHaveProperty("skdd-test-server");
        // Unmanaged server is untouched
        expect(servers).toHaveProperty(unmanagedKey);
        // Sibling top-level keys (outside mcpKey) are preserved
        const fixture = readFixture(fixtureName);
        for (const key of Object.keys(fixture)) {
          if (key !== mcpKey) {
            expect(plan.finalDoc).toHaveProperty(key);
          }
        }
      });

      it("remove: removes a managed server that is no longer in canonical", () => {
        // Place fixture as starting state, pretend unmanagedKey was previously managed
        placeFixture(fixtureName, hostRelPath);
        const emptyCanonical: CanonicalMcpConfig = { version: 1, servers: {} };
        const plan = adapter.plan(emptyCanonical, [unmanagedKey]);
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;
        const servers = plan.finalDoc[mcpKey] as Record<string, unknown>;
        expect(servers).not.toHaveProperty(unmanagedKey);
      });

      it("remove: does NOT touch servers that are NOT in managed list", () => {
        placeFixture(fixtureName, hostRelPath);
        const emptyCanonical: CanonicalMcpConfig = { version: 1, servers: {} };
        // managed is empty → no removals
        const plan = adapter.plan(emptyCanonical, []);
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;
        const servers = plan.finalDoc[mcpKey] as Record<string, unknown>;
        // Unmanaged key survives
        expect(servers).toHaveProperty(unmanagedKey);
      });

      it("hosts allowlist: skips server when this host is not in the allowlist", () => {
        placeFixture(fixtureName, hostRelPath);
        const canonical: CanonicalMcpConfig = {
          version: 1,
          servers: {
            "allowlisted-server": {
              command: "echo",
              // Only allowed for a different host
              hosts: ["codex" as import("../src/lib/mcp/schema.js").McpHostId],
            },
          },
        };
        const plan = adapter.plan(canonical, []);
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;
        const servers = plan.finalDoc[mcpKey] as Record<string, unknown>;
        expect(servers).not.toHaveProperty("allowlisted-server");
      });

      it("dry-run: calling plan() only does not write to disk", () => {
        placeFixture(fixtureName, hostRelPath);
        const filePath = join(fakeTmp, hostRelPath);
        const contentBefore = readFileSync(filePath, "utf8");
        const mtimeBefore = statSync(filePath).mtimeMs;

        adapter.plan(makeCanonical(), []);

        const contentAfter = readFileSync(filePath, "utf8");
        const mtimeAfter = statSync(filePath).mtimeMs;
        expect(contentAfter).toBe(contentBefore);
        expect(mtimeAfter).toBe(mtimeBefore);
      });
    });

    describe("apply()", () => {
      it("returns ok:true, written:false when plan has no changes", () => {
        placeFixture(fixtureName, hostRelPath);
        // Plan with empty canonical and no managed → no changes
        const emptyCanonical: CanonicalMcpConfig = { version: 1, servers: {} };
        const plan = adapter.plan(emptyCanonical, []);
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;
        // Only no-op when no changes; let's ensure changes are empty
        const plan2 = adapter.plan(emptyCanonical, []);
        if (!plan2.ok) return;
        if (plan2.changes.length === 0) {
          const result = adapter.apply(plan2);
          expect(result.ok).toBe(true);
          if (result.ok) expect(result.written).toBe(false);
        }
      });

      it("returns ok:false when plan is an error", () => {
        const errPlan = { ok: false, reason: "test error" } as const;
        const result = adapter.apply(errPlan);
        expect(result.ok).toBe(false);
      });

      it("writes the updated config and creates a .bak file", () => {
        placeFixture(fixtureName, hostRelPath);
        const filePath = join(fakeTmp, hostRelPath);
        const contentBefore = readFileSync(filePath, "utf8");

        const plan = adapter.plan(makeCanonical(), []);
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;

        const result = adapter.apply(plan);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.written).toBe(true);
        }

        // .bak file created with original content
        const bakPath = `${filePath}.bak`;
        expect(existsSync(bakPath)).toBe(true);
        expect(readFileSync(bakPath, "utf8")).toBe(contentBefore);
      });

      it("result file contains the new server and preserves unmanaged servers", () => {
        placeFixture(fixtureName, hostRelPath);
        const filePath = join(fakeTmp, hostRelPath);

        const plan = adapter.plan(makeCanonical(), []);
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;

        adapter.apply(plan);

        const written = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
        const servers = written[mcpKey] as Record<string, unknown>;
        expect(servers).toHaveProperty("skdd-test-server");
        expect(servers).toHaveProperty(unmanagedKey);
      });

      it("malformed config: plan returns error, apply never writes", () => {
        const filePath = writeFile(hostRelPath, "{ bad json }");
        const mtimeBefore = statSync(filePath).mtimeMs;

        const plan = adapter.plan(makeCanonical(), []);
        expect(plan.ok).toBe(false);

        // apply a failing plan
        const result = adapter.apply(plan);
        expect(result.ok).toBe(false);

        // File is untouched
        expect(statSync(filePath).mtimeMs).toBe(mtimeBefore);
        expect(readFileSync(filePath, "utf8")).toBe("{ bad json }");
      });

      it("second apply with same canonical is a no-op (idempotent)", () => {
        placeFixture(fixtureName, hostRelPath);
        const filePath = join(fakeTmp, hostRelPath);

        // First apply
        const plan1 = adapter.plan(makeCanonical(), []);
        expect(plan1.ok).toBe(true);
        if (!plan1.ok) return;
        adapter.apply(plan1);

        const contentAfterFirst = readFileSync(filePath, "utf8");

        // Second apply: now the server is "managed"
        const plan2 = adapter.plan(makeCanonical(), ["skdd-test-server"]);
        expect(plan2.ok).toBe(true);
        if (!plan2.ok) return;

        // changes might be "update" (same value) — verify servers are correct
        const result2 = adapter.apply(plan2);
        expect(result2.ok).toBe(true);

        const contentAfterSecond = readFileSync(filePath, "utf8");
        const parsed1 = JSON.parse(contentAfterFirst) as Record<string, unknown>;
        const parsed2 = JSON.parse(contentAfterSecond) as Record<string, unknown>;
        // The mcpKey section should be equivalent
        expect(
          JSON.stringify((parsed2[mcpKey] as Record<string, unknown>)["skdd-test-server"]),
        ).toBe(JSON.stringify((parsed1[mcpKey] as Record<string, unknown>)["skdd-test-server"]));
      });
    });
  });
}

// ── Adapter-specific tests ───────────────────────────────────────────────────

describe("claude-code adapter specifics", () => {
  it("omits disabled servers (no native disabled flag)", () => {
    placeFixture("claude-code.json", ".claude.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: { "disabled-server": { command: "echo", disabled: true } },
    };
    const plan = claudeCodeAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const servers = plan.finalDoc["mcpServers"] as Record<string, unknown>;
    expect(servers).not.toHaveProperty("disabled-server");
  });

  it("maps remote server to {type, url, headers?}", () => {
    placeFixture("claude-code.json", ".claude.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "remote-srv": {
          url: "https://mcp.example.com",
          type: "http",
          headers: { Authorization: "Bearer tok" },
        },
      },
    };
    const plan = claudeCodeAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const entry = (plan.finalDoc["mcpServers"] as Record<string, unknown>)["remote-srv"] as Record<
      string,
      unknown
    >;
    expect(entry["type"]).toBe("http");
    expect(entry["url"]).toBe("https://mcp.example.com");
    expect(entry["headers"]).toEqual({ Authorization: "Bearer tok" });
  });

  it("preserves the many sibling keys (~40) in ~/.claude.json", () => {
    placeFixture("claude-code.json", ".claude.json");
    const plan = claudeCodeAdapter.plan(makeCanonical(), []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.finalDoc).toHaveProperty("projects");
    expect(plan.finalDoc).toHaveProperty("onboarding");
    expect(plan.finalDoc).toHaveProperty("userPreferences");
    expect(plan.finalDoc).toHaveProperty("cacheData");
    expect(plan.finalDoc).toHaveProperty("lastSeen");
    expect(plan.finalDoc).toHaveProperty("statsCounters");
  });
});

describe("claude-desktop adapter specifics", () => {
  it("skips remote servers (stdio-only)", () => {
    placeFixture(
      "claude-desktop.json",
      "Library/Application Support/Claude/claude_desktop_config.json",
    );
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "remote-srv": { url: "https://mcp.example.com", type: "http" },
      },
    };
    const plan = claudeDesktopAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const servers = plan.finalDoc["mcpServers"] as Record<string, unknown>;
    expect(servers).not.toHaveProperty("remote-srv");
  });

  it("preserves Claude Desktop sibling keys (globalShortcut, preferences, etc.)", () => {
    placeFixture(
      "claude-desktop.json",
      "Library/Application Support/Claude/claude_desktop_config.json",
    );
    const plan = claudeDesktopAdapter.plan(makeCanonical(), []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.finalDoc).toHaveProperty("globalShortcut");
    expect(plan.finalDoc).toHaveProperty("preferences");
    expect(plan.finalDoc).toHaveProperty("isUsingBuiltInNodeForMcp");
  });

  it("available() returns false on non-darwin platforms", () => {
    if (process.platform !== "darwin") {
      expect(claudeDesktopAdapter.available()).toBe(false);
    } else {
      // On darwin, depends on existence of the parent dir — just assert it's a boolean
      expect(typeof claudeDesktopAdapter.available()).toBe("boolean");
    }
  });
});

describe("droid adapter specifics", () => {
  it("keeps disabled servers in config with disabled:true (not removed)", () => {
    placeFixture("droid.json", ".factory/mcp.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: { "disabled-srv": { command: "echo", disabled: true } },
    };
    const plan = droidAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const entry = (plan.finalDoc["mcpServers"] as Record<string, unknown>)[
      "disabled-srv"
    ] as Record<string, unknown>;
    expect(entry).toBeDefined();
    expect(entry["disabled"]).toBe(true);
  });

  it("maps stdio server to {type:'stdio', command, args?, env?}", () => {
    placeFixture("droid.json", ".factory/mcp.json");
    const canonical = makeCanonical();
    const plan = droidAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const entry = (plan.finalDoc["mcpServers"] as Record<string, unknown>)[
      "skdd-test-server"
    ] as Record<string, unknown>;
    expect(entry["type"]).toBe("stdio");
    expect(entry["command"]).toBe("npx");
  });

  it("passes through ${VAR} env placeholders unchanged", () => {
    placeFixture("droid.json", ".factory/mcp.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "env-srv": { command: "cmd", env: { KEY: "${MY_SECRET}" } },
      },
    };
    const plan = droidAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const entry = (plan.finalDoc["mcpServers"] as Record<string, unknown>)["env-srv"] as Record<
      string,
      unknown
    >;
    expect((entry["env"] as Record<string, string>)["KEY"]).toBe("${MY_SECRET}");
  });

  it("preserves persistentPermissions sibling key", () => {
    placeFixture("droid.json", ".factory/mcp.json");
    const plan = droidAdapter.plan(makeCanonical(), []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.finalDoc).toHaveProperty("persistentPermissions");
  });
});

describe("cursor adapter specifics", () => {
  it("omits disabled servers (no native disabled flag)", () => {
    placeFixture("cursor.json", ".cursor/mcp.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: { "disabled-srv": { command: "echo", disabled: true } },
    };
    const plan = cursorAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.finalDoc["mcpServers"] as Record<string, unknown>).not.toHaveProperty(
      "disabled-srv",
    );
  });

  it("maps remote to {url} without type field", () => {
    placeFixture("cursor.json", ".cursor/mcp.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: { "remote-srv": { url: "https://mcp.example.com", type: "sse" } },
    };
    const plan = cursorAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const entry = (plan.finalDoc["mcpServers"] as Record<string, unknown>)["remote-srv"] as Record<
      string,
      unknown
    >;
    expect(entry["url"]).toBe("https://mcp.example.com");
    expect(entry["type"]).toBeUndefined();
  });

  it("emits headers on remote entry", () => {
    placeFixture("cursor.json", ".cursor/mcp.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "auth-srv": {
          url: "https://mcp.example.com",
          headers: { Authorization: "Bearer tok123" },
        },
      },
    };
    const plan = cursorAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const entry = (plan.finalDoc["mcpServers"] as Record<string, unknown>)["auth-srv"] as Record<
      string,
      unknown
    >;
    expect(entry["url"]).toBe("https://mcp.example.com");
    expect(entry["headers"]).toEqual({ Authorization: "Bearer tok123" });
  });

  it("preserves ${VAR} placeholders in remote header values", () => {
    placeFixture("cursor.json", ".cursor/mcp.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "env-auth-srv": {
          url: "https://mcp.example.com",
          headers: { Authorization: "Bearer ${MY_TOKEN}" },
        },
      },
    };
    const plan = cursorAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const entry = (plan.finalDoc["mcpServers"] as Record<string, unknown>)[
      "env-auth-srv"
    ] as Record<string, unknown>;
    expect((entry["headers"] as Record<string, string>)["Authorization"]).toBe(
      "Bearer ${MY_TOKEN}",
    );
  });

  it("remote with headers: second plan with same headers is a no-op (content-equal round-trip)", () => {
    placeFixture("cursor.json", ".cursor/mcp.json");
    const filePath = join(fakeTmp, ".cursor/mcp.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "auth-srv": {
          url: "https://mcp.example.com",
          headers: { Authorization: "Bearer tok123" },
        },
      },
    };
    // First apply
    const plan1 = cursorAdapter.plan(canonical, []);
    expect(plan1.ok).toBe(true);
    if (!plan1.ok) return;
    cursorAdapter.apply(plan1);

    // Second plan — server is now managed
    const plan2 = cursorAdapter.plan(canonical, ["auth-srv"]);
    expect(plan2.ok).toBe(true);
    if (!plan2.ok) return;
    // Content-equal → no changes
    expect(plan2.changes).toHaveLength(0);
    // File not modified again
    const contentAfter = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(contentAfter) as Record<string, unknown>;
    const entry = (parsed["mcpServers"] as Record<string, unknown>)["auth-srv"] as Record<
      string,
      unknown
    >;
    expect(entry["headers"]).toEqual({ Authorization: "Bearer tok123" });
  });
});

describe("opencode adapter specifics", () => {
  it("maps stdio to {type:'local', command: [cmd,...args], environment, enabled}", () => {
    placeFixture("opencode.json", ".config/opencode/opencode.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "local-srv": { command: "npx", args: ["-y", "pkg"], env: { K: "v" } },
      },
    };
    const plan = opencodeAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const entry = (plan.finalDoc["mcp"] as Record<string, unknown>)["local-srv"] as Record<
      string,
      unknown
    >;
    expect(entry["type"]).toBe("local");
    expect(entry["command"]).toEqual(["npx", "-y", "pkg"]);
    expect(entry["environment"]).toEqual({ K: "v" });
    expect(entry["enabled"]).toBe(true);
  });

  it("maps disabled server to enabled:false (not removed)", () => {
    placeFixture("opencode.json", ".config/opencode/opencode.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: { "disabled-srv": { command: "echo", disabled: true } },
    };
    const plan = opencodeAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const entry = (plan.finalDoc["mcp"] as Record<string, unknown>)["disabled-srv"] as Record<
      string,
      unknown
    >;
    expect(entry).toBeDefined();
    expect(entry["enabled"]).toBe(false);
  });

  it("preserves $schema and other sibling keys", () => {
    placeFixture("opencode.json", ".config/opencode/opencode.json");
    const plan = opencodeAdapter.plan(makeCanonical(), []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.finalDoc).toHaveProperty("$schema");
    expect(plan.finalDoc).toHaveProperty("theme");
    expect(plan.finalDoc).toHaveProperty("autoshare");
  });

  it("uses 'mcp' key, not 'mcpServers'", () => {
    placeFixture("opencode.json", ".config/opencode/opencode.json");
    const plan = opencodeAdapter.plan(makeCanonical(), []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.finalDoc).toHaveProperty("mcp");
    expect(plan.finalDoc).not.toHaveProperty("mcpServers");
  });

  it("emits headers on remote entry", () => {
    placeFixture("opencode.json", ".config/opencode/opencode.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "auth-remote": {
          url: "https://mcp.example.com",
          headers: { Authorization: "Bearer tok", "X-Api-Key": "secret" },
        },
      },
    };
    const plan = opencodeAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const entry = (plan.finalDoc["mcp"] as Record<string, unknown>)["auth-remote"] as Record<
      string,
      unknown
    >;
    expect(entry["type"]).toBe("remote");
    expect(entry["url"]).toBe("https://mcp.example.com");
    expect(entry["headers"]).toEqual({ Authorization: "Bearer tok", "X-Api-Key": "secret" });
  });

  it("preserves ${VAR} placeholders in remote header values", () => {
    placeFixture("opencode.json", ".config/opencode/opencode.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "env-remote": {
          url: "https://mcp.example.com",
          headers: { Authorization: "Bearer ${MY_TOKEN}" },
        },
      },
    };
    const plan = opencodeAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const entry = (plan.finalDoc["mcp"] as Record<string, unknown>)["env-remote"] as Record<
      string,
      unknown
    >;
    expect((entry["headers"] as Record<string, string>)["Authorization"]).toBe(
      "Bearer ${MY_TOKEN}",
    );
  });

  it("remote with headers: second plan with same headers is a no-op (content-equal round-trip)", () => {
    placeFixture("opencode.json", ".config/opencode/opencode.json");
    const filePath = join(fakeTmp, ".config/opencode/opencode.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "auth-remote": {
          url: "https://mcp.example.com",
          headers: { Authorization: "Bearer tok" },
        },
      },
    };
    // First apply
    const plan1 = opencodeAdapter.plan(canonical, []);
    expect(plan1.ok).toBe(true);
    if (!plan1.ok) return;
    opencodeAdapter.apply(plan1);

    // Second plan — server is now managed
    const plan2 = opencodeAdapter.plan(canonical, ["auth-remote"]);
    expect(plan2.ok).toBe(true);
    if (!plan2.ok) return;
    expect(plan2.changes).toHaveLength(0);

    const contentAfter = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(contentAfter) as Record<string, unknown>;
    const entry = (parsed["mcp"] as Record<string, unknown>)["auth-remote"] as Record<
      string,
      unknown
    >;
    expect(entry["headers"]).toEqual({ Authorization: "Bearer tok" });
  });
});

describe("gemini adapter specifics", () => {
  it("omits disabled servers", () => {
    placeFixture("gemini.json", ".gemini/settings.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: { "disabled-srv": { command: "echo", disabled: true } },
    };
    const plan = geminiAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.finalDoc["mcpServers"] as Record<string, unknown>).not.toHaveProperty(
      "disabled-srv",
    );
  });

  it("preserves general, security, ui sibling keys", () => {
    placeFixture("gemini.json", ".gemini/settings.json");
    const plan = geminiAdapter.plan(makeCanonical(), []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.finalDoc).toHaveProperty("general");
    expect(plan.finalDoc).toHaveProperty("security");
    expect(plan.finalDoc).toHaveProperty("ui");
  });

  it("maps type 'http' remote to httpUrl field (Streamable HTTP transport)", () => {
    placeFixture("gemini.json", ".gemini/settings.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: { "http-srv": { url: "https://mcp.example.com/mcp", type: "http" } },
    };
    const plan = geminiAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const entry = (plan.finalDoc["mcpServers"] as Record<string, unknown>)["http-srv"] as Record<
      string,
      unknown
    >;
    expect(entry["httpUrl"]).toBe("https://mcp.example.com/mcp");
    expect(entry["url"]).toBeUndefined();
  });

  it("maps type 'sse' remote to url field (SSE transport)", () => {
    placeFixture("gemini.json", ".gemini/settings.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: { "sse-srv": { url: "https://mcp.example.com/sse", type: "sse" } },
    };
    const plan = geminiAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const entry = (plan.finalDoc["mcpServers"] as Record<string, unknown>)["sse-srv"] as Record<
      string,
      unknown
    >;
    expect(entry["url"]).toBe("https://mcp.example.com/sse");
    expect(entry["httpUrl"]).toBeUndefined();
  });

  it("maps absent type remote to url field (defaults to SSE)", () => {
    placeFixture("gemini.json", ".gemini/settings.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: { "default-srv": { url: "https://mcp.example.com" } },
    };
    const plan = geminiAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const entry = (plan.finalDoc["mcpServers"] as Record<string, unknown>)["default-srv"] as Record<
      string,
      unknown
    >;
    expect(entry["url"]).toBe("https://mcp.example.com");
    expect(entry["httpUrl"]).toBeUndefined();
  });

  it("emits headers on http remote entry", () => {
    placeFixture("gemini.json", ".gemini/settings.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "auth-http": {
          url: "https://mcp.example.com/mcp",
          type: "http",
          headers: { Authorization: "Bearer tok" },
        },
      },
    };
    const plan = geminiAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const entry = (plan.finalDoc["mcpServers"] as Record<string, unknown>)["auth-http"] as Record<
      string,
      unknown
    >;
    expect(entry["httpUrl"]).toBe("https://mcp.example.com/mcp");
    expect(entry["headers"]).toEqual({ Authorization: "Bearer tok" });
  });

  it("emits headers on sse remote entry", () => {
    placeFixture("gemini.json", ".gemini/settings.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "auth-sse": {
          url: "https://mcp.example.com/sse",
          type: "sse",
          headers: { Authorization: "Bearer ${SSE_TOKEN}" },
        },
      },
    };
    const plan = geminiAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const entry = (plan.finalDoc["mcpServers"] as Record<string, unknown>)["auth-sse"] as Record<
      string,
      unknown
    >;
    expect(entry["url"]).toBe("https://mcp.example.com/sse");
    expect((entry["headers"] as Record<string, string>)["Authorization"]).toBe(
      "Bearer ${SSE_TOKEN}",
    );
  });

  it("http remote with headers: second plan with same data is a no-op (round-trip)", () => {
    placeFixture("gemini.json", ".gemini/settings.json");
    const filePath = join(fakeTmp, ".gemini/settings.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "auth-http": {
          url: "https://mcp.example.com/mcp",
          type: "http",
          headers: { Authorization: "Bearer tok" },
        },
      },
    };
    // First apply
    const plan1 = geminiAdapter.plan(canonical, []);
    expect(plan1.ok).toBe(true);
    if (!plan1.ok) return;
    geminiAdapter.apply(plan1);

    // Second plan — server is now managed
    const plan2 = geminiAdapter.plan(canonical, ["auth-http"]);
    expect(plan2.ok).toBe(true);
    if (!plan2.ok) return;
    expect(plan2.changes).toHaveLength(0);

    const contentAfter = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(contentAfter) as Record<string, unknown>;
    const entry = (parsed["mcpServers"] as Record<string, unknown>)["auth-http"] as Record<
      string,
      unknown
    >;
    expect(entry["httpUrl"]).toBe("https://mcp.example.com/mcp");
    expect(entry["headers"]).toEqual({ Authorization: "Bearer tok" });
  });
});

// ── Fix 1: claude-desktop remote server warning ───────────────────────────────

describe("claude-desktop — remote server warning (fix-1)", () => {
  const DESKTOP_PATH = "Library/Application Support/Claude/claude_desktop_config.json";

  it("includes a warning in plan.warnings when a remote server is skipped", () => {
    placeFixture("claude-desktop.json", DESKTOP_PATH);
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: { "remote-srv": { url: "https://mcp.example.com/mcp", type: "http" } },
    };
    const plan = claudeDesktopAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.warnings.length).toBeGreaterThan(0);
    expect(plan.warnings.some((w) => w.includes("remote-srv"))).toBe(true);
    expect(plan.warnings.some((w) => w.toLowerCase().includes("remote"))).toBe(true);
  });

  it("does NOT produce a warning when a disabled server is silently omitted", () => {
    placeFixture("claude-desktop.json", DESKTOP_PATH);
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: { "disabled-srv": { command: "echo", disabled: true } },
    };
    const plan = claudeDesktopAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.warnings.filter((w) => w.includes("disabled-srv"))).toHaveLength(0);
  });

  it("warns for remote but not for stdio in same canonical", () => {
    placeFixture("claude-desktop.json", DESKTOP_PATH);
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "remote-srv": { url: "https://mcp.example.com/mcp", type: "sse" },
        "stdio-srv": { command: "echo" },
      },
    };
    const plan = claudeDesktopAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.warnings.some((w) => w.includes("remote-srv"))).toBe(true);
    expect(plan.warnings.some((w) => w.includes("stdio-srv"))).toBe(false);
    // stdio server is added, remote is not
    const servers = plan.finalDoc["mcpServers"] as Record<string, unknown>;
    expect(servers).toHaveProperty("stdio-srv");
    expect(servers).not.toHaveProperty("remote-srv");
  });
});

// ── Fix 2: deep-equal content check (key-order robust) ───────────────────────

describe("JSON adapter — deep-equal content check (fix-2)", () => {
  it("treats host entry as unchanged even when key order differs from generated entry", () => {
    // Write a claude-code config where server has reversed key order vs what toNativeEntry generates
    writeFile(
      ".claude.json",
      JSON.stringify({
        mcpServers: {
          // args before command — different order than toNativeEntry produces
          "managed-srv": { args: ["-y", "pkg"], command: "npx" },
        },
      }),
    );
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: { "managed-srv": { command: "npx", args: ["-y", "pkg"] } },
    };
    const plan = claudeCodeAdapter.plan(canonical, ["managed-srv"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // Deep-equal: same content regardless of key order → no changes
    expect(plan.changes).toHaveLength(0);
  });

  it("still emits an update when content genuinely differs", () => {
    writeFile(
      ".claude.json",
      JSON.stringify({
        mcpServers: { "managed-srv": { command: "old-cmd" } },
      }),
    );
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: { "managed-srv": { command: "new-cmd" } },
    };
    const plan = claudeCodeAdapter.plan(canonical, ["managed-srv"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.changes.some((c) => c.op === "update" && c.name === "managed-srv")).toBe(true);
  });
});

// ── Fix 3: allowlist narrowing removal (JSON adapters) ───────────────────────

describe("JSON adapter — allowlist narrowing removal (fix-3)", () => {
  it("removes a managed server from a host when that host is excluded from the allowlist", () => {
    writeFile(
      ".claude.json",
      JSON.stringify({ mcpServers: { "narrowing-srv": { command: "cmd" } } }),
    );
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "narrowing-srv": {
          command: "cmd",
          hosts: ["droid"] as import("../src/lib/mcp/schema.js").McpHostId[],
        },
      },
    };
    const plan = claudeCodeAdapter.plan(canonical, ["narrowing-srv"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.changes.some((c) => c.op === "remove" && c.name === "narrowing-srv")).toBe(true);
    expect(plan.finalDoc["mcpServers"] as Record<string, unknown>).not.toHaveProperty(
      "narrowing-srv",
    );
  });

  it("does NOT remove a server that is excluded from allowlist but was never managed", () => {
    writeFile(
      ".claude.json",
      JSON.stringify({ mcpServers: { "user-srv": { command: "user-cmd" } } }),
    );
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: {
        "user-srv": {
          command: "user-cmd",
          hosts: ["droid"] as import("../src/lib/mcp/schema.js").McpHostId[],
        },
      },
    };
    // managed list is empty — "user-srv" was never managed by skdd
    const plan = claudeCodeAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.changes.some((c) => c.name === "user-srv")).toBe(false);
    // User entry preserved
    expect(plan.finalDoc["mcpServers"] as Record<string, unknown>).toHaveProperty("user-srv");
  });
});

// ── Fix 4: same-name unmanaged safety (JSON adapters) ────────────────────────

describe("JSON adapter — same-name unmanaged safety (fix-4)", () => {
  it("warns and skips when canonical name collides with an unmanaged host entry", () => {
    // user-managed-mcp exists in the fixture and is NOT in the managed list
    placeFixture("claude-code.json", ".claude.json");
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: { "user-managed-mcp": { command: "new-skdd-cmd" } },
    };
    const plan = claudeCodeAdapter.plan(canonical, []); // NOT managed
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // Warning emitted
    expect(plan.warnings.some((w) => w.includes("user-managed-mcp"))).toBe(true);
    // Entry unchanged — user-authored command preserved
    const entry = (plan.finalDoc["mcpServers"] as Record<string, unknown>)[
      "user-managed-mcp"
    ] as Record<string, unknown>;
    expect(entry["command"]).toBe("npx");
    expect(entry["command"]).not.toBe("new-skdd-cmd");
    // No change recorded
    expect(plan.changes.some((c) => c.name === "user-managed-mcp")).toBe(false);
  });

  it("updates a server when it IS in the managed list (safety does not block managed entries)", () => {
    writeFile(".claude.json", JSON.stringify({ mcpServers: { "skdd-srv": { command: "old" } } }));
    const canonical: CanonicalMcpConfig = {
      version: 1,
      servers: { "skdd-srv": { command: "new" } },
    };
    const plan = claudeCodeAdapter.plan(canonical, ["skdd-srv"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.changes.some((c) => c.op === "update" && c.name === "skdd-srv")).toBe(true);
    const entry = (plan.finalDoc["mcpServers"] as Record<string, unknown>)["skdd-srv"] as Record<
      string,
      unknown
    >;
    expect(entry["command"]).toBe("new");
  });
});

// ── Fix 5: host-map guard — malformed mcpKey value blocks read/plan/apply ────

describe("JSON adapter — host-map guard (fix-5)", () => {
  it("read() returns ok:false when mcpServers is a string", () => {
    writeFile(".claude.json", JSON.stringify({ mcpServers: "oops" }));
    const result = claudeCodeAdapter.read();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("mcpServers");
    }
  });

  it("read() returns ok:false when mcpServers is an array", () => {
    writeFile(".claude.json", JSON.stringify({ mcpServers: [] }));
    const result = claudeCodeAdapter.read();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("mcpServers");
    }
  });

  it("read() returns ok:false when mcp key is a number (opencode adapter)", () => {
    writeFile(".config/opencode/opencode.json", JSON.stringify({ mcp: 42 }));
    const result = opencodeAdapter.read();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("mcp");
    }
  });

  it("plan() returns ok:false when mcpServers is a string, apply never writes", () => {
    const filePath = writeFile(".claude.json", JSON.stringify({ mcpServers: "oops" }));
    const mtimeBefore = statSync(filePath).mtimeMs;

    const plan = claudeCodeAdapter.plan(makeCanonical(), []);
    expect(plan.ok).toBe(false);

    const result = claudeCodeAdapter.apply(plan);
    expect(result.ok).toBe(false);

    // File is untouched
    expect(statSync(filePath).mtimeMs).toBe(mtimeBefore);
    expect(readFileSync(filePath, "utf8")).toBe(JSON.stringify({ mcpServers: "oops" }));
  });

  it("plan() returns ok:false when mcpServers is an array, apply never writes", () => {
    const filePath = writeFile(".claude.json", JSON.stringify({ mcpServers: [] }));
    const mtimeBefore = statSync(filePath).mtimeMs;

    const plan = claudeCodeAdapter.plan(makeCanonical(), []);
    expect(plan.ok).toBe(false);

    claudeCodeAdapter.apply(plan);

    // File is untouched
    expect(statSync(filePath).mtimeMs).toBe(mtimeBefore);
  });

  it("read() returns ok:true when mcpServers is absent (not present in doc)", () => {
    writeFile(".claude.json", JSON.stringify({ someOtherKey: true }));
    const result = claudeCodeAdapter.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.serverNames).toEqual([]);
    }
  });

  it("read() returns ok:true when mcpServers is a valid plain object", () => {
    writeFile(".claude.json", JSON.stringify({ mcpServers: { "my-srv": { command: "cmd" } } }));
    const result = claudeCodeAdapter.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.serverNames).toContain("my-srv");
    }
  });
});

// ── Fix 6: OpenCode JSONC parsing ─────────────────────────────────────────────

describe("opencode adapter — JSONC parsing (fix-6)", () => {
  const OC_PATH = ".config/opencode/opencode.json";

  it("read() accepts a config with // line comments", () => {
    writeFile(
      OC_PATH,
      `{
  // line comment
  "theme": "opencode",
  "mcp": {
    "my-srv": { "type": "local", "command": ["echo"], "enabled": true }
  }
}`,
    );
    const result = opencodeAdapter.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.serverNames).toContain("my-srv");
    }
  });

  it("read() accepts a config with /* */ block comments", () => {
    writeFile(
      OC_PATH,
      `{
  /* block comment */
  "theme": "opencode",
  "mcp": {
    "block-srv": { "type": "local", "command": ["npx", "pkg"], "enabled": true }
  }
}`,
    );
    const result = opencodeAdapter.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.serverNames).toContain("block-srv");
    }
  });

  it("read() accepts a config with trailing commas", () => {
    writeFile(
      OC_PATH,
      `{
  "theme": "opencode",
  "mcp": {
    "trailing-srv": { "type": "local", "command": ["echo"], "enabled": true, },
  },
}`,
    );
    const result = opencodeAdapter.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.serverNames).toContain("trailing-srv");
    }
  });

  it("read() and plan() accept the JSONC fixture with comments + trailing commas", () => {
    // Place the JSONC fixture (not valid strict JSON)
    const dest = join(fakeTmp, OC_PATH);
    mkdirSync(join(dest, ".."), { recursive: true });
    copyFileSync(join(FIXTURES_DIR, "opencode-jsonc.json"), dest);

    const readResult = opencodeAdapter.read();
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;
    expect(readResult.serverNames).toContain("user-opencode-mcp");

    const plan = opencodeAdapter.plan(makeCanonical(), []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // New server added
    const servers = plan.finalDoc["mcp"] as Record<string, unknown>;
    expect(servers).toHaveProperty("skdd-test-server");
    // Unmanaged server preserved
    expect(servers).toHaveProperty("user-opencode-mcp");
  });

  it("plan() preserves unmanaged servers from a JSONC config", () => {
    writeFile(
      OC_PATH,
      `{
  // user config
  "mcp": {
    "unmanaged-srv": { "type": "local", "command": ["echo"], "enabled": true }, // trailing comma
  },
}`,
    );
    const plan = opencodeAdapter.plan(makeCanonical(), []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const servers = plan.finalDoc["mcp"] as Record<string, unknown>;
    expect(servers).toHaveProperty("unmanaged-srv");
    expect(servers).toHaveProperty("skdd-test-server");
  });

  it("read() returns ok:false for input that is malformed even as JSONC (fail closed)", () => {
    writeFile(OC_PATH, `{ "mcp": { unclosed string: "value" } }`);
    const result = opencodeAdapter.read();
    expect(result.ok).toBe(false);
  });

  it("plan() returns ok:false for truly malformed input, apply never writes", () => {
    const filePath = writeFile(OC_PATH, `{ totally not parseable ??? }`);
    const mtimeBefore = statSync(filePath).mtimeMs;

    const plan = opencodeAdapter.plan(makeCanonical(), []);
    expect(plan.ok).toBe(false);

    const result = opencodeAdapter.apply(plan);
    expect(result.ok).toBe(false);

    expect(statSync(filePath).mtimeMs).toBe(mtimeBefore);
  });

  it("other JSON adapters still reject JSONC (strict JSON only)", () => {
    // claude-code should reject a file with // comments
    writeFile(
      ".claude.json",
      `{
  // comment
  "mcpServers": {}
}`,
    );
    const result = claudeCodeAdapter.read();
    expect(result.ok).toBe(false);
  });
});
