import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CanonicalMcpConfig,
  expandEnvPlaceholders,
  loadMcpConfig,
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
