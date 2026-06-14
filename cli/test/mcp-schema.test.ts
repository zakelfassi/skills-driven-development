import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CanonicalMcpConfig,
  expandEnvPlaceholders,
  loadMcpConfig,
  loadMcpConfigResult,
  saveMcpConfig,
  validateMcpConfig,
} from "../src/lib/mcp/schema.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skdd-mcp-schema-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ── roundtrip ────────────────────────────────────────────────────────────────

describe("loadMcpConfig / saveMcpConfig roundtrip", () => {
  it("saves and reloads a stdio server", () => {
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        myserver: { command: "npx", args: ["-y", "mcp-pkg"], env: { KEY: "val" } },
      },
    };
    saveMcpConfig(tmp, config);
    const loaded = loadMcpConfig(tmp);
    expect(loaded).toMatchObject(config);
  });

  it("saves and reloads a remote server", () => {
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        remote1: { url: "https://mcp.example.com/mcp", type: "http" },
      },
    };
    saveMcpConfig(tmp, config);
    const loaded = loadMcpConfig(tmp);
    expect(loaded).toMatchObject(config);
  });

  it("returns null when no mcp.json exists", () => {
    expect(loadMcpConfig(tmp)).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    writeFileSync(join(tmp, "mcp.json"), "{ not json }");
    expect(loadMcpConfig(tmp)).toBeNull();
  });

  it("roundtrips hosts allowlist and disabled flag", () => {
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        s1: { command: "cmd", hosts: ["claude-code", "droid"], disabled: true },
      },
    };
    saveMcpConfig(tmp, config);
    const loaded = loadMcpConfig(tmp);
    expect(loaded?.servers["s1"]?.hosts).toEqual(["claude-code", "droid"]);
    expect(loaded?.servers["s1"]?.disabled).toBe(true);
  });

  it("roundtrips multiple servers preserving insertion order", () => {
    const config: CanonicalMcpConfig = {
      version: 1,
      servers: {
        alpha: { command: "alpha-cmd" },
        beta: { url: "https://beta.example.com", type: "sse" },
        gamma: { command: "gamma-cmd", args: ["--flag"] },
      },
    };
    saveMcpConfig(tmp, config);
    const loaded = loadMcpConfig(tmp);
    expect(Object.keys(loaded?.servers ?? {})).toEqual(["alpha", "beta", "gamma"]);
  });
});

// ── validateMcpConfig ────────────────────────────────────────────────────────

describe("validateMcpConfig", () => {
  it("accepts a valid stdio server config", () => {
    const raw = { version: 1, servers: { s: { command: "cmd", args: ["a"] } } };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(true);
  });

  it("accepts a valid remote server config", () => {
    const raw = { version: 1, servers: { s: { url: "https://example.com", type: "http" } } };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(true);
  });

  it("accepts an empty servers map", () => {
    const raw = { version: 1, servers: {} };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(true);
  });

  it("rejects when server has both command and url", () => {
    const raw = {
      version: 1,
      servers: { bad: { command: "cmd", url: "https://x.com" } },
    };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.server === "bad")).toBe(true);
  });

  it("rejects when server has neither command nor url", () => {
    const raw = { version: 1, servers: { bad: { env: { X: "1" } } } };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.server === "bad")).toBe(true);
  });

  it("rejects wrong version", () => {
    const raw = { version: 2, servers: {} };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(validateMcpConfig("string").ok).toBe(false);
    expect(validateMcpConfig(null).ok).toBe(false);
    expect(validateMcpConfig(42).ok).toBe(false);
  });

  it("rejects servers that is not an object", () => {
    const raw = { version: 1, servers: "not-an-object" };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
  });

  it("collects errors from multiple invalid servers", () => {
    const raw = {
      version: 1,
      servers: {
        bad1: { command: "c", url: "https://x.com" },
        bad2: { env: { X: "y" } },
        good: { command: "ok" },
      },
    };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.server === "bad1")).toBe(true);
      expect(result.errors.some((e) => e.server === "bad2")).toBe(true);
      expect(result.errors.some((e) => e.server === "good")).toBe(false);
    }
  });
});

// ── field type validation ─────────────────────────────────────────────────────

describe("validateMcpConfig field type validation", () => {
  // stdio: command type
  it("rejects command that is not a string", () => {
    const raw = { version: 1, servers: { s: { command: 123 } } };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.server === "s" && /command/.test(e.message))).toBe(true);
  });

  it("rejects command that is an object", () => {
    const raw = { version: 1, servers: { s: { command: { bin: "npx" } } } };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
  });

  // stdio: args type
  it("rejects args that is not an array", () => {
    const raw = { version: 1, servers: { s: { command: "cmd", args: "not-an-array" } } };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.server === "s" && /args/.test(e.message))).toBe(true);
  });

  it("rejects args that contains a non-string element", () => {
    const raw = { version: 1, servers: { s: { command: "cmd", args: ["ok", 42] } } };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.server === "s" && /args/.test(e.message))).toBe(true);
  });

  it("accepts args as an empty array", () => {
    const raw = { version: 1, servers: { s: { command: "cmd", args: [] } } };
    expect(validateMcpConfig(raw).ok).toBe(true);
  });

  // stdio: env type
  it("rejects env that is not an object", () => {
    const raw = { version: 1, servers: { s: { command: "cmd", env: "not-an-object" } } };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.server === "s" && /env/.test(e.message))).toBe(true);
  });

  it("rejects env that is an array", () => {
    const raw = { version: 1, servers: { s: { command: "cmd", env: ["KEY=val"] } } };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
  });

  it("rejects env where a value is not a string", () => {
    const raw = { version: 1, servers: { s: { command: "cmd", env: { KEY: 123 } } } };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.server === "s" && /env/.test(e.message))).toBe(true);
  });

  it("accepts env as an empty object", () => {
    const raw = { version: 1, servers: { s: { command: "cmd", env: {} } } };
    expect(validateMcpConfig(raw).ok).toBe(true);
  });

  // remote: url type
  it("rejects url that is not a string", () => {
    const raw = { version: 1, servers: { s: { url: 123 } } };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.server === "s" && /url/.test(e.message))).toBe(true);
  });

  it("rejects url that is an object", () => {
    const raw = { version: 1, servers: { s: { url: { href: "https://x.com" } } } };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
  });

  // remote: type field
  it("rejects type that is not http or sse", () => {
    const raw = { version: 1, servers: { s: { url: "https://x.com", type: "websocket" } } };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.server === "s" && /type/.test(e.message))).toBe(true);
  });

  it("accepts type http", () => {
    const raw = { version: 1, servers: { s: { url: "https://x.com", type: "http" } } };
    expect(validateMcpConfig(raw).ok).toBe(true);
  });

  it("accepts type sse", () => {
    const raw = { version: 1, servers: { s: { url: "https://x.com", type: "sse" } } };
    expect(validateMcpConfig(raw).ok).toBe(true);
  });

  // remote: headers type
  it("rejects headers that is not an object", () => {
    const raw = { version: 1, servers: { s: { url: "https://x.com", headers: "auth" } } };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.server === "s" && /headers/.test(e.message))).toBe(true);
  });

  it("rejects headers where a value is not a string", () => {
    const raw = {
      version: 1,
      servers: { s: { url: "https://x.com", headers: { Authorization: 42 } } },
    };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.server === "s" && /headers/.test(e.message))).toBe(true);
  });

  it("accepts headers as a valid string-value object", () => {
    const raw = {
      version: 1,
      servers: { s: { url: "https://x.com", headers: { Authorization: "Bearer tok" } } },
    };
    expect(validateMcpConfig(raw).ok).toBe(true);
  });

  // shared: hosts type
  it("rejects hosts that is not an array", () => {
    const raw = { version: 1, servers: { s: { command: "cmd", hosts: "claude-code" } } };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.server === "s" && /hosts/.test(e.message))).toBe(true);
  });

  it("rejects hosts that contains a non-string element", () => {
    const raw = { version: 1, servers: { s: { command: "cmd", hosts: ["claude-code", 42] } } };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
  });

  // shared: disabled type
  it("rejects disabled that is not a boolean", () => {
    const raw = { version: 1, servers: { s: { command: "cmd", disabled: "yes" } } };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.server === "s" && /disabled/.test(e.message))).toBe(true);
  });

  it("rejects disabled that is 0 (number)", () => {
    const raw = { version: 1, servers: { s: { command: "cmd", disabled: 0 } } };
    const result = validateMcpConfig(raw);
    expect(result.ok).toBe(false);
  });

  it("accepts disabled as true", () => {
    const raw = { version: 1, servers: { s: { command: "cmd", disabled: true } } };
    expect(validateMcpConfig(raw).ok).toBe(true);
  });

  it("accepts disabled as false", () => {
    const raw = { version: 1, servers: { s: { command: "cmd", disabled: false } } };
    expect(validateMcpConfig(raw).ok).toBe(true);
  });

  // loadMcpConfigResult fails closed on type violations
  it("loadMcpConfig returns null when command is a number", () => {
    const rawJson = JSON.stringify({ version: 1, servers: { bad: { command: 123 } } });
    writeFileSync(join(tmp, "mcp.json"), rawJson);
    expect(loadMcpConfig(tmp)).toBeNull();
  });

  it("loadMcpConfig returns null when url is a number", () => {
    const rawJson = JSON.stringify({ version: 1, servers: { bad: { url: 456 } } });
    writeFileSync(join(tmp, "mcp.json"), rawJson);
    expect(loadMcpConfig(tmp)).toBeNull();
  });

  // well-typed full config still loads
  it("accepts a fully-typed stdio server with all optional fields", () => {
    const raw = {
      version: 1,
      servers: {
        s: {
          command: "npx",
          args: ["-y", "mcp-pkg"],
          env: { API_KEY: "secret" },
          hosts: ["claude-code", "droid"],
          disabled: false,
        },
      },
    };
    expect(validateMcpConfig(raw).ok).toBe(true);
  });

  it("accepts a fully-typed remote server with all optional fields", () => {
    const raw = {
      version: 1,
      servers: {
        s: {
          url: "https://mcp.example.com",
          type: "http",
          headers: { Authorization: "Bearer tok" },
          hosts: ["claude-code"],
          disabled: false,
        },
      },
    };
    expect(validateMcpConfig(raw).ok).toBe(true);
  });
});

// ── expandEnvPlaceholders ────────────────────────────────────────────────────

describe("expandEnvPlaceholders", () => {
  it("expands a set variable from explicit env map", () => {
    const result = expandEnvPlaceholders("${MY_KEY}", { MY_KEY: "secret-value" });
    expect(result.value).toBe("secret-value");
    expect(result.unresolved).toEqual([]);
  });

  it("expands multiple variables in one string", () => {
    const result = expandEnvPlaceholders("${A}:${B}", { A: "hello", B: "world" });
    expect(result.value).toBe("hello:world");
    expect(result.unresolved).toEqual([]);
  });

  it("tracks unresolved variable names when var is absent from map", () => {
    const result = expandEnvPlaceholders("${UNSET_VAR}", {});
    expect(result.unresolved).toContain("UNSET_VAR");
  });

  it("leaves placeholder unchanged when var is unset", () => {
    const result = expandEnvPlaceholders("${UNSET_VAR}", {});
    expect(result.value).toBe("${UNSET_VAR}");
  });

  it("uses process.env when no explicit env map is provided", () => {
    process.env.__SKDD_TEST_EXPAND_VAR__ = "from-process-env";
    try {
      const result = expandEnvPlaceholders("${__SKDD_TEST_EXPAND_VAR__}");
      expect(result.value).toBe("from-process-env");
      expect(result.unresolved).toEqual([]);
    } finally {
      delete process.env.__SKDD_TEST_EXPAND_VAR__;
    }
  });

  it("falls back to process.env when explicit map does not have the var", () => {
    process.env.__SKDD_FALLBACK_VAR__ = "fallback";
    try {
      const result = expandEnvPlaceholders("${__SKDD_FALLBACK_VAR__}", {});
      expect(result.value).toBe("fallback");
      expect(result.unresolved).toEqual([]);
    } finally {
      delete process.env.__SKDD_FALLBACK_VAR__;
    }
  });

  it("returns plain string unchanged when no placeholders present", () => {
    const result = expandEnvPlaceholders("no-placeholders-here", { X: "y" });
    expect(result.value).toBe("no-placeholders-here");
    expect(result.unresolved).toEqual([]);
  });

  it("handles a mix of resolved and unresolved placeholders", () => {
    const result = expandEnvPlaceholders("${SET}/${UNSET}", { SET: "ok" });
    expect(result.value).toBe("ok/${UNSET}");
    expect(result.unresolved).toEqual(["UNSET"]);
  });

  it("does not expand the same placeholder twice into the same unresolved list entry", () => {
    const result = expandEnvPlaceholders("${X}+${X}", {});
    // Both occurrences unresolved → two entries (one per occurrence)
    expect(result.unresolved).toHaveLength(2);
    expect(result.unresolved.every((v) => v === "X")).toBe(true);
  });
});

// ── duplicate key detection in loadMcpConfig ─────────────────────────────────

describe("loadMcpConfig duplicate server name detection", () => {
  it("returns null when servers object has a duplicate server name", () => {
    const rawJson =
      '{"version":1,"servers":{"my-server":{"command":"cmd1"},"my-server":{"command":"cmd2"}}}';
    writeFileSync(join(tmp, "mcp.json"), rawJson);
    expect(loadMcpConfig(tmp)).toBeNull();
  });

  it("returns null for duplicate name even when nested values differ", () => {
    const rawJson = `{
  "version": 1,
  "servers": {
    "alpha": { "command": "cmd-a" },
    "beta":  { "url": "https://beta.example.com" },
    "alpha": { "command": "cmd-a-override" }
  }
}`;
    writeFileSync(join(tmp, "mcp.json"), rawJson);
    expect(loadMcpConfig(tmp)).toBeNull();
  });

  it("accepts a file with unique server names (no false positive)", () => {
    const rawJson = `{
  "version": 1,
  "servers": {
    "server-a": { "command": "cmd1" },
    "server-b": { "command": "cmd2" }
  }
}`;
    writeFileSync(join(tmp, "mcp.json"), rawJson);
    expect(loadMcpConfig(tmp)).not.toBeNull();
  });

  it("does not flag nested duplicate keys inside a server's own value", () => {
    // Duplicate key inside env is a JSON quirk but not a duplicate server name
    const rawJson = `{
  "version": 1,
  "servers": {
    "my-server": { "command": "cmd", "env": { "X": "1", "X": "2" } }
  }
}`;
    writeFileSync(join(tmp, "mcp.json"), rawJson);
    // No duplicate server names at the top level of servers → should load fine
    expect(loadMcpConfig(tmp)).not.toBeNull();
  });

  it("detects duplicate when one key uses unicode escapes that decode to the same name", () => {
    // \u006d\u0079 decodes to "my" — same as the literal key "my"
    const rawJson =
      '{"version":1,"servers":{"\\u006d\\u0079":{"command":"cmd1"},"my":{"command":"cmd2"}}}';
    writeFileSync(join(tmp, "mcp.json"), rawJson);
    expect(loadMcpConfig(tmp)).toBeNull();
  });

  it("detects duplicate when both keys are unicode-escaped forms of the same name", () => {
    // Both \u0061 entries decode to "a"
    const rawJson =
      '{"version":1,"servers":{"\\u0061":{"command":"cmd1"},"\\u0061":{"command":"cmd2"}}}';
    writeFileSync(join(tmp, "mcp.json"), rawJson);
    expect(loadMcpConfig(tmp)).toBeNull();
  });

  it("no false positive for distinct unicode-escaped keys that decode differently", () => {
    // \u0041 → "A", \u0042 → "B" — different after decode → not a duplicate
    const rawJson =
      '{"version":1,"servers":{"\\u0041":{"command":"cmd1"},"\\u0042":{"command":"cmd2"}}}';
    writeFileSync(join(tmp, "mcp.json"), rawJson);
    expect(loadMcpConfig(tmp)).not.toBeNull();
  });

  it("fails closed when a nested 'servers' object appears earlier but real top-level servers has duplicates", () => {
    // A nested "servers" key inside another value appears BEFORE the canonical top-level
    // "servers" map. The duplicate-scan must ignore the nested one and catch the real
    // duplicate at the top level.
    const rawJson = JSON.stringify({
      version: 1,
      metadata: {
        servers: { "nested-unique": { command: "x" } },
      },
      servers: { "real-server": { command: "cmd1" } },
    }).replace(
      // Inject a second "real-server" key to create a top-level duplicate that
      // JSON.parse would silently collapse.
      '"real-server":{"command":"cmd1"}}',
      '"real-server":{"command":"cmd1"},"real-server":{"command":"cmd2"}}',
    );
    writeFileSync(join(tmp, "mcp.json"), rawJson);
    const result = loadMcpConfigResult(tmp);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.reason).toMatch(/real-server/);
    }
  });

  it("rejects a file with two top-level 'servers' keys (duplicate top-level key)", () => {
    // JSON.parse keeps the LAST servers object; a file with two top-level
    // "servers" keys is structurally invalid and must fail closed.
    const rawJson =
      '{"version":1,"servers":{"server-a":{"command":"cmd1"}},"servers":{"server-b":{"command":"cmd2"}}}';
    writeFileSync(join(tmp, "mcp.json"), rawJson);
    const result = loadMcpConfigResult(tmp);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.reason).toMatch(/[Dd]uplicate.*servers/);
    }
  });

  it("rejects duplicate server names inside the SECOND (effective) servers object", () => {
    // Two top-level "servers" keys; the second (effective) one contains a
    // duplicate server name. The old scanner stopped at the FIRST servers object
    // and would have silently passed. The new scanner must catch this.
    const rawJson =
      '{"version":1,"servers":{"unique":{"command":"cmd1"}},"servers":{"duped":{"command":"cmd2"},"duped":{"command":"cmd3"}}}';
    writeFileSync(join(tmp, "mcp.json"), rawJson);
    const result = loadMcpConfigResult(tmp);
    expect(result.status).toBe("invalid");
  });

  it("single top-level servers with unique names is still valid (no regression)", () => {
    const rawJson = JSON.stringify({
      version: 1,
      servers: {
        "server-a": { command: "cmd1" },
        "server-b": { command: "cmd2" },
      },
    });
    writeFileSync(join(tmp, "mcp.json"), rawJson);
    const result = loadMcpConfigResult(tmp);
    expect(result.status).toBe("ok");
  });

  it("no false positive when a nested 'servers' object appears earlier and top-level server names are unique", () => {
    // Nested "servers" inside another value must NOT trigger a false duplicate error
    // when the real top-level servers map has unique names.
    const rawJson = `{
  "version": 1,
  "metadata": {
    "servers": {
      "alpha": { "command": "nested-cmd" },
      "alpha": { "command": "nested-cmd-dup" }
    }
  },
  "servers": {
    "server-a": { "command": "cmd1" },
    "server-b": { "command": "cmd2" }
  }
}`;
    writeFileSync(join(tmp, "mcp.json"), rawJson);
    const result = loadMcpConfigResult(tmp);
    // The nested "alpha" duplicate is inside metadata.servers — must not cause a failure
    expect(result.status).toBe("ok");
  });
});

// ── saveMcpConfig validates before writing ────────────────────────────────────

describe("saveMcpConfig rejects invalid configs", () => {
  it("throws when a server has both command and url", () => {
    const badConfig = {
      version: 1 as const,
      servers: {
        bad: { command: "cmd", url: "https://example.com" } as never,
      },
    };
    expect(() => saveMcpConfig(tmp, badConfig)).toThrow();
    expect(existsSync(join(tmp, "mcp.json"))).toBe(false);
  });

  it("throws when a server has neither command nor url", () => {
    const badConfig = {
      version: 1 as const,
      servers: {
        bad: { env: { X: "1" } } as never,
      },
    };
    expect(() => saveMcpConfig(tmp, badConfig)).toThrow();
    expect(existsSync(join(tmp, "mcp.json"))).toBe(false);
  });

  it("does not overwrite an existing file when config is invalid", () => {
    // Write a valid file first
    const validConfig: CanonicalMcpConfig = {
      version: 1,
      servers: { good: { command: "cmd" } },
    };
    saveMcpConfig(tmp, validConfig);
    const originalContent = readFileSync(join(tmp, "mcp.json"), "utf8");

    const badConfig = {
      version: 1 as const,
      servers: { bad: { command: "c", url: "https://x.com" } as never },
    };
    expect(() => saveMcpConfig(tmp, badConfig)).toThrow();
    // File unchanged
    expect(readFileSync(join(tmp, "mcp.json"), "utf8")).toBe(originalContent);
  });
});
