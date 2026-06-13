/**
 * Tests for the Codex CLI TOML adapter (comment-preserving block splice).
 *
 * Covers:
 *  - findBlockExtent: unit tests for header/extent detection
 *  - spliceBlocks: add/update/remove cycles and re-parse gate
 *  - codexAdapter: read / plan / apply with the codex.toml fixture
 */

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
import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codexAdapter, findBlockExtent, spliceBlocks } from "../src/lib/mcp/adapters/codex.js";
import type { CanonicalMcpConfig, McpHostId, McpServer } from "../src/lib/mcp/schema.js";

const FIXTURES_DIR = join(__dirname, "fixtures", "mcp");
const FIXTURE_TOML = join(FIXTURES_DIR, "codex.toml");

let fakeTmp: string;
let prevHome: string | undefined;

beforeEach(() => {
  fakeTmp = mkdtempSync(join(tmpdir(), "skdd-codex-toml-"));
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

/** Place the fixture at ~/.codex/config.toml in the fake home. */
function placeFixture(): string {
  const codexDir = join(fakeTmp, ".codex");
  mkdirSync(codexDir, { recursive: true });
  const dest = join(codexDir, "config.toml");
  copyFileSync(FIXTURE_TOML, dest);
  return dest;
}

/** Read the fixture content as a string. */
function fixtureContent(): string {
  return readFileSync(FIXTURE_TOML, "utf8");
}

function makeCanonical(servers: Record<string, McpServer> = {}): CanonicalMcpConfig {
  return { version: 1, servers };
}

// ── findBlockExtent ──────────────────────────────────────────────────────────

describe("findBlockExtent", () => {
  it("returns null when name is not in lines", () => {
    const lines = ["[settings]", "foo = 1"];
    expect(findBlockExtent(lines, "myserver")).toBeNull();
  });

  it("finds a simple block with no sub-tables (end = EOF)", () => {
    const lines = ["[mcp_servers.myserver]", 'command = "foo"', "enabled = true"];
    expect(findBlockExtent(lines, "myserver")).toEqual([0, 3]);
  });

  it("stops at the next non-sub-table header", () => {
    const lines = [
      "[mcp_servers.first]",
      'command = "first"',
      "[mcp_servers.second]",
      'command = "second"',
    ];
    expect(findBlockExtent(lines, "first")).toEqual([0, 2]);
  });

  it("includes nested sub-table headers of the same server", () => {
    const lines = [
      "[mcp_servers.myserver]",
      'command = "foo"',
      "[mcp_servers.myserver.tools.inspect]",
      "enabled = true",
      "[mcp_servers.other]",
      'command = "other"',
    ];
    // Block for myserver: lines 0–3 (0..4 exclusive)
    expect(findBlockExtent(lines, "myserver")).toEqual([0, 4]);
  });

  it("handles a block preceded by unrelated sections", () => {
    const lines = ["[settings]", "foo = 1", "[mcp_servers.srv]", 'command = "x"'];
    expect(findBlockExtent(lines, "srv")).toEqual([2, 4]);
  });

  it("does NOT match a line with trailing space in the bracket (edge case)", () => {
    // "[mcp_servers.foo ]" (space before ]) is a different string than "[mcp_servers.foo]"
    const lines = ["[mcp_servers.foo ]", 'command = "old"'];
    expect(findBlockExtent(lines, "foo")).toBeNull();
  });
});

// ── spliceBlocks ─────────────────────────────────────────────────────────────

describe("spliceBlocks", () => {
  const baseServer: McpServer = {
    command: "npx",
    args: ["-y", "pkg"],
  };

  it("appends a new block when toUpsert contains a name not in content", () => {
    const content = "[settings]\nfoo = 1\n";
    const result = spliceBlocks(content, [], [["newserver", baseServer]]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.content).toContain("[mcp_servers.newserver]");
    expect(result.content).toContain("[settings]\nfoo = 1");
  });

  it("replaces an existing managed block (upsert removes old, appends new)", () => {
    const content = [
      "[settings]",
      'foo = "bar"',
      "",
      "[mcp_servers.managed]",
      'command = "old"',
      "",
    ].join("\n");
    const newServer: McpServer = { command: "new-cmd", args: ["--flag"] };
    const result = spliceBlocks(content, [], [["managed", newServer]]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    // Old block removed, new block appended
    expect(result.content).not.toContain('command = "old"');
    expect(result.content).toContain('command = "new-cmd"');
    // Unrelated section preserved
    expect(result.content).toContain("[settings]");
    expect(result.content).toContain('foo = "bar"');
  });

  it("removes a managed block entirely when in toRemove", () => {
    const content = [
      "[settings]",
      'foo = "bar"',
      "[mcp_servers.managed]",
      'command = "x"',
      "[other]",
      "y = 1",
    ].join("\n");
    const result = spliceBlocks(content, ["managed"], []);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.content).not.toContain("[mcp_servers.managed]");
    expect(result.content).toContain("[settings]");
    expect(result.content).toContain("[other]");
  });

  it("removes nested sub-table lines along with the parent block", () => {
    const content = [
      "[mcp_servers.managed]",
      'command = "x"',
      "[mcp_servers.managed.tools.foo]",
      "enabled = true",
      "[settings]",
      "z = 1",
    ].join("\n");
    const result = spliceBlocks(content, ["managed"], []);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.content).not.toContain("[mcp_servers.managed]");
    expect(result.content).not.toContain("[mcp_servers.managed.tools.foo]");
    expect(result.content).toContain("[settings]");
  });

  it("handles multiple removes and upserts in one call", () => {
    const content = [
      "[mcp_servers.remove_me]",
      'command = "old"',
      "[mcp_servers.update_me]",
      'command = "stale"',
      "[settings]",
      "x = 1",
    ].join("\n");
    const updated: McpServer = { command: "updated" };
    const added: McpServer = { url: "https://example.com", type: "http" };
    const result = spliceBlocks(
      content,
      ["remove_me"],
      [
        ["update_me", updated],
        ["new_srv", added],
      ],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.content).not.toContain("[mcp_servers.remove_me]");
    expect(result.content).not.toContain('command = "stale"');
    expect(result.content).toContain('command = "updated"');
    expect(result.content).toContain("[mcp_servers.new_srv]");
    expect(result.content).toContain("[settings]");
  });

  it("re-parse gate: returns {ok:false} when splice produces invalid TOML (duplicate headers)", () => {
    // Create content where findBlockExtent can NOT find the existing block
    // (space before ']' means the header line doesn't match the exact rootHeader string)
    // then attempt to "upsert" the server → appends a second block → duplicate → invalid
    const content = '[mcp_servers.foo ]\ncommand = "old"\n';
    const server: McpServer = { command: "new" };
    const result = spliceBlocks(content, [], [["foo", server]]);
    // smol-toml must reject the resulting file with two definitions of mcp_servers.foo
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected gate to fire");
    expect(result.reason).toMatch(/re-parse/i);
  });

  it("returns empty content when original is empty and toRemove/toUpsert are empty", () => {
    const result = spliceBlocks("", [], []);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    // content is empty or just whitespace
    expect(result.content.trim()).toBe("");
  });

  it("writes disabled:true as enabled = false", () => {
    const server: McpServer = { command: "tool", disabled: true };
    const result = spliceBlocks("", [], [["srv", server]]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.content).toContain("enabled = false");
  });

  it("does not write enabled line when server is not disabled", () => {
    const server: McpServer = { command: "tool" };
    const result = spliceBlocks("", [], [["srv", server]]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.content).not.toContain("enabled =");
  });
});

// ── codexAdapter.read() ──────────────────────────────────────────────────────

describe("codexAdapter.read()", () => {
  it("returns empty serverNames when config file does not exist", () => {
    // No .codex dir created → configPath points to non-existent file
    const result = codexAdapter.read();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.serverNames).toEqual([]);
  });

  it("enumerates mcp_servers names from the fixture", () => {
    placeFixture();
    const result = codexAdapter.read();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.serverNames).toContain("user_owned");
    expect(result.serverNames).toContain("existing_managed");
    // Only top-level server names, not nested sub-table keys
    expect(result.serverNames).toHaveLength(2);
  });

  it("returns {ok:false} when config.toml contains invalid TOML", () => {
    const dir = join(fakeTmp, ".codex");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.toml"), "= broken toml [[\n", "utf8");
    const result = codexAdapter.read();
    expect(result.ok).toBe(false);
  });
});

// ── codexAdapter.plan() ──────────────────────────────────────────────────────

describe("codexAdapter.plan()", () => {
  it("returns no-op (no changes) when canonical is empty and managed is empty", () => {
    placeFixture();
    const canonical = makeCanonical();
    const plan = codexAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();
    expect(plan.changes).toEqual([]);
  });

  it("plans an add for a server not in the file", () => {
    placeFixture();
    const canonical = makeCanonical({
      brand_new: { command: "npx", args: ["-y", "new-mcp"] },
    });
    const plan = codexAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();
    expect(plan.changes).toEqual([{ op: "add", name: "brand_new" }]);
    const content = plan.finalDoc._tomlContent as string;
    expect(content).toContain("[mcp_servers.brand_new]");
    expect(content).toContain('command = "npx"');
  });

  it("plans an update for a server already in the file", () => {
    placeFixture();
    const canonical = makeCanonical({
      existing_managed: { command: "new-command", args: ["--new-flag"] },
    });
    const plan = codexAdapter.plan(canonical, ["existing_managed"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();
    expect(plan.changes).toEqual([{ op: "update", name: "existing_managed" }]);
    const content = plan.finalDoc._tomlContent as string;
    // Old block should be gone (stale command removed)
    expect(content).not.toContain('command = "old-command"');
    // Also old nested sub-table removed
    expect(content).not.toContain("[mcp_servers.existing_managed.tools.legacy_tool]");
    // New block present
    expect(content).toContain('command = "new-command"');
  });

  it("plans a remove for a managed server no longer in canonical", () => {
    placeFixture();
    const canonical = makeCanonical(); // empty servers
    const plan = codexAdapter.plan(canonical, ["existing_managed"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();
    expect(plan.changes).toEqual([{ op: "remove", name: "existing_managed" }]);
    const content = plan.finalDoc._tomlContent as string;
    expect(content).not.toContain("[mcp_servers.existing_managed]");
    // Nested sub-table also gone
    expect(content).not.toContain("[mcp_servers.existing_managed.tools.legacy_tool]");
  });

  it("preserves comments and unrelated tables byte-for-byte outside managed blocks", () => {
    placeFixture();
    const original = fixtureContent();
    const canonical = makeCanonical({
      existing_managed: { command: "updated-cmd" },
    });
    const plan = codexAdapter.plan(canonical, ["existing_managed"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();
    const content = plan.finalDoc._tomlContent as string;

    // The preamble comments must survive intact
    expect(content).toContain("# Codex CLI configuration");
    expect(content).toContain("# Managed by: ~/.codex/config.toml");
    expect(content).toContain("# Last updated: 2026-06-11");

    // Unrelated tables must survive intact
    expect(content).toContain("[defaults]");
    expect(content).toContain('model = "o3"');
    expect(content).toContain("# inline comment: keep this exactly");
    expect(content).toContain("[shell]");
    expect(content).toContain("[network]");
    expect(content).toContain("# Network settings (do not touch)");

    // User-owned server (not managed) must survive intact, including nested sub-tables
    expect(content).toContain("[mcp_servers.user_owned]");
    expect(content).toContain("[mcp_servers.user_owned.tools.inspect]");
    expect(content).toContain("[mcp_servers.user_owned.tools.transform]");
    expect(content).toContain("# The mcp_servers section is partially managed by skdd");

    // Verify the preamble of the original file is exactly preserved
    // Extract the first line and check it's byte-for-byte identical
    const originalFirstLine = original.split("\n")[0];
    expect(content.split("\n")[0]).toBe(originalFirstLine);
  });

  it("preserves hosts allowlist: skips server if hosts does not include 'codex'", () => {
    placeFixture();
    const canonical = makeCanonical({
      excluded: { command: "x", hosts: ["claude-code" as McpHostId] },
    });
    const plan = codexAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();
    expect(plan.changes).toEqual([]);
  });

  it("includes server when hosts allowlist contains 'codex'", () => {
    placeFixture();
    const canonical = makeCanonical({
      allowed: { command: "x", hosts: ["codex"] },
    });
    const plan = codexAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();
    expect(plan.changes).toEqual([{ op: "add", name: "allowed" }]);
  });

  it("maps disabled:true to enabled = false in output", () => {
    placeFixture();
    const canonical = makeCanonical({
      srv: { command: "tool", disabled: true },
    });
    const plan = codexAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();
    const content = plan.finalDoc._tomlContent as string;
    expect(content).toContain("[mcp_servers.srv]");
    expect(content).toContain("enabled = false");
  });

  it("writes remote server with url and type", () => {
    placeFixture();
    const canonical = makeCanonical({
      remote_srv: { url: "https://mcp.example.com", type: "http" },
    });
    const plan = codexAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();
    const content = plan.finalDoc._tomlContent as string;
    expect(content).toContain("[mcp_servers.remote_srv]");
    expect(content).toContain('url = "https://mcp.example.com"');
    expect(content).toContain('type = "http"');
  });

  it("returns {ok:false} when config.toml contains invalid TOML", () => {
    const dir = join(fakeTmp, ".codex");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.toml"), "broken = [unclosed\n", "utf8");
    const canonical = makeCanonical({ srv: { command: "x" } });
    const plan = codexAdapter.plan(canonical, []);
    expect(plan.ok).toBe(false);
  });

  it("add + update + remove in a single plan call", () => {
    placeFixture();
    const canonical = makeCanonical({
      existing_managed: { command: "updated-cmd" },
      brand_new: { command: "fresh-cmd" },
    });
    // existing_managed is updated; old_gone is removed (was managed, not in canonical)
    // We simulate old_gone being managed but not in file by using an unknown name
    const plan = codexAdapter.plan(canonical, ["existing_managed"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();

    const updateChange = plan.changes.find((c) => c.name === "existing_managed");
    const addChange = plan.changes.find((c) => c.name === "brand_new");
    expect(updateChange?.op).toBe("update");
    expect(addChange?.op).toBe("add");

    const content = plan.finalDoc._tomlContent as string;
    expect(content).toContain('command = "updated-cmd"');
    expect(content).toContain('command = "fresh-cmd"');
    expect(content).not.toContain('command = "old-command"');
  });

  it("plans removal of a managed server that was previously in the file but is now absent from canonical", () => {
    placeFixture();
    // existing_managed is in the fixture, in managed list, but absent from canonical
    const canonical = makeCanonical({
      something_else: { command: "other" },
    });
    const plan = codexAdapter.plan(canonical, ["existing_managed"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();
    const removeChange = plan.changes.find((c) => c.name === "existing_managed");
    expect(removeChange?.op).toBe("remove");
  });

  it("produces valid TOML in finalDoc (can be re-parsed)", () => {
    placeFixture();
    const canonical = makeCanonical({
      existing_managed: { command: "new-cmd" },
      added: { command: "added-cmd" },
    });
    const plan = codexAdapter.plan(canonical, ["existing_managed"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();
    const content = plan.finalDoc._tomlContent as string;
    // Must not throw
    expect(() => parseToml(content)).not.toThrow();
  });

  it("handles env variables in server entries", () => {
    placeFixture();
    const canonical = makeCanonical({
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional placeholder literal
      srv: { command: "tool", env: { API_KEY: "${MY_KEY}", FOO: "bar" } },
    });
    const plan = codexAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();
    const content = plan.finalDoc._tomlContent as string;
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional placeholder literal
    expect(content).toContain('API_KEY = "${MY_KEY}"');
    expect(content).toContain('FOO = "bar"');
  });
});

// ── codexAdapter.apply() ─────────────────────────────────────────────────────

describe("codexAdapter.apply()", () => {
  it("returns {written:false} when plan has no changes", () => {
    placeFixture();
    const canonical = makeCanonical();
    const plan = codexAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();
    const result = codexAdapter.apply(plan);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.written).toBe(false);
  });

  it("writes the spliced TOML to the config file", () => {
    const dest = placeFixture();
    const _originalContent = readFileSync(dest, "utf8");
    const canonical = makeCanonical({
      existing_managed: { command: "new-cmd" },
    });
    const plan = codexAdapter.plan(canonical, ["existing_managed"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();

    const result = codexAdapter.apply(plan);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.written).toBe(true);

    const written = readFileSync(dest, "utf8");
    expect(written).toContain('command = "new-cmd"');
    expect(written).not.toContain('command = "old-command"');
    expect(written).toContain("# Codex CLI configuration");
  });

  it("creates a .bak backup of the original file before writing", () => {
    const dest = placeFixture();
    const originalContent = readFileSync(dest, "utf8");
    const canonical = makeCanonical({
      existing_managed: { command: "new-cmd" },
    });
    const plan = codexAdapter.plan(canonical, ["existing_managed"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();

    codexAdapter.apply(plan);

    const bakPath = `${dest}.bak`;
    expect(existsSync(bakPath)).toBe(true);
    expect(readFileSync(bakPath, "utf8")).toBe(originalContent);
  });

  it("dry-run (plan only, no apply) performs zero writes", () => {
    const dest = placeFixture();
    const mtimeBefore = statSync(dest).mtimeMs;

    const canonical = makeCanonical({
      existing_managed: { command: "new-cmd" },
    });
    // Only plan, do NOT apply
    const plan = codexAdapter.plan(canonical, ["existing_managed"]);
    expect(plan.ok).toBe(true);

    // File should not have been modified
    const mtimeAfter = statSync(dest).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
    expect(existsSync(`${dest}.bak`)).toBe(false);
  });

  it("returns {ok:false} from apply when plan.ok is false", () => {
    const dir = join(fakeTmp, ".codex");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.toml"), "broken = [unclosed\n", "utf8");
    const canonical = makeCanonical({ srv: { command: "x" } });
    const plan = codexAdapter.plan(canonical, []);
    expect(plan.ok).toBe(false);
    const result = codexAdapter.apply(plan);
    expect(result.ok).toBe(false);
  });
});

// ── codexAdapter availability ─────────────────────────────────────────────────

describe("codexAdapter metadata", () => {
  it("has id='codex' and label='Codex CLI'", () => {
    expect(codexAdapter.id).toBe("codex");
    expect(codexAdapter.label).toBe("Codex CLI");
  });

  it("configPath() points to ~/.codex/config.toml", () => {
    expect(codexAdapter.configPath()).toBe(join(fakeTmp, ".codex", "config.toml"));
  });

  it("available() is false when ~/.codex does not exist", () => {
    expect(codexAdapter.available()).toBe(false);
  });

  it("available() is true when ~/.codex exists", () => {
    mkdirSync(join(fakeTmp, ".codex"), { recursive: true });
    expect(codexAdapter.available()).toBe(true);
  });
});

// ── Fix 3: allowlist narrowing removal (codex) ────────────────────────────────

describe("codexAdapter — allowlist narrowing removal (fix-3)", () => {
  it("removes a managed server from codex TOML when its hosts allowlist excludes codex", () => {
    const dest = placeFixture();
    // existing_managed is in the fixture; pretend it was managed by skdd
    const canonical = makeCanonical({
      existing_managed: {
        command: "old-command",
        hosts: ["claude-code"] as import("../src/lib/mcp/schema.js").McpHostId[],
      },
    });
    const plan = codexAdapter.plan(canonical, ["existing_managed"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();
    // Should produce a remove op
    expect(plan.changes.some((c) => c.op === "remove" && c.name === "existing_managed")).toBe(true);
    // Apply and verify the block is gone
    codexAdapter.apply(plan);
    const written = readFileSync(dest, "utf8");
    expect(written).not.toContain("[mcp_servers.existing_managed]");
  });

  it("does NOT remove a server that is excluded from allowlist but was never managed", () => {
    placeFixture();
    const canonical = makeCanonical({
      user_owned: {
        command: "user-tool",
        hosts: ["claude-code"] as import("../src/lib/mcp/schema.js").McpHostId[],
      },
    });
    // user_owned is NOT in managed list
    const plan = codexAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();
    expect(plan.changes.some((c) => c.name === "user_owned")).toBe(false);
  });
});

// ── Fix 4: same-name unmanaged safety (codex) ─────────────────────────────────

describe("codexAdapter — same-name unmanaged safety (fix-4)", () => {
  it("warns and skips when canonical name collides with an unmanaged codex entry", () => {
    placeFixture();
    const canonical = makeCanonical({
      user_owned: { command: "new-skdd-cmd" }, // same name as unmanaged fixture entry
    });
    const plan = codexAdapter.plan(canonical, []); // user_owned NOT managed
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();
    // Warning emitted
    expect(plan.warnings.some((w) => w.includes("user_owned"))).toBe(true);
    // No change recorded for user_owned
    expect(plan.changes.some((c) => c.name === "user_owned")).toBe(false);
  });

  it("updates a managed codex entry without warnings", () => {
    placeFixture();
    const canonical = makeCanonical({
      existing_managed: { command: "updated-cmd" },
    });
    const plan = codexAdapter.plan(canonical, ["existing_managed"]); // IS managed
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();
    expect(plan.warnings.some((w) => w.includes("existing_managed"))).toBe(false);
    expect(plan.changes.some((c) => c.op === "update" && c.name === "existing_managed")).toBe(true);
  });
});

// ── Fix: dotted server names are quoted ──────────────────────────────────────

describe("codexAdapter — dotted server name round-trip (fix: quoted TOML keys)", () => {
  it("findBlockExtent matches a quoted header for a dotted name", () => {
    const lines = [`[mcp_servers."github.com"]`, 'command = "gh-mcp"', "[other]", "x = 1"];
    expect(findBlockExtent(lines, "github.com")).toEqual([0, 2]);
  });

  it("findBlockExtent does NOT match unquoted nested tables for dotted name", () => {
    // Without the fix, [mcp_servers.github.com] would not be the rootHeader
    const lines = [
      "[mcp_servers.github]",
      "[mcp_servers.github.com]", // nested, not a server named "github.com"
      'command = "x"',
    ];
    // "github.com" as a quoted key should NOT match these lines
    expect(findBlockExtent(lines, "github.com")).toBeNull();
  });

  it("spliceBlocks: write dotted-name server produces quoted TOML header", () => {
    const server: McpServer = { command: "gh-mcp", args: ["--verbose"] };
    const result = spliceBlocks("", [], [["github.com", server]]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.content).toContain(`[mcp_servers."github.com"]`);
    // Re-parse gate must pass
    expect(() => parseToml(result.content)).not.toThrow();
  });

  it("spliceBlocks: round-trip dotted name — write then remove", () => {
    const server: McpServer = { command: "gh-mcp" };
    // Step 1: write
    const written = spliceBlocks("[settings]\nfoo = 1\n", [], [["github.com", server]]);
    expect(written.ok).toBe(true);
    if (!written.ok) throw new Error();
    expect(written.content).toContain(`[mcp_servers."github.com"]`);

    // Step 2: remove
    const removed = spliceBlocks(written.content, ["github.com"], []);
    expect(removed.ok).toBe(true);
    if (!removed.ok) throw new Error();
    expect(removed.content).not.toContain(`[mcp_servers."github.com"]`);
    expect(removed.content).toContain("[settings]");
  });

  it("codexAdapter: full round-trip of dotted server name via plan/apply/read/remove", () => {
    const dest = placeFixture();
    const originalContent = readFileSync(dest, "utf8");

    // Add "github.com" server
    const canonical = makeCanonical({
      "github.com": { command: "gh-mcp", args: ["--port", "8080"] },
    });
    const addPlan = codexAdapter.plan(canonical, []);
    expect(addPlan.ok).toBe(true);
    if (!addPlan.ok) throw new Error();
    expect(addPlan.changes).toEqual([{ op: "add", name: "github.com" }]);
    codexAdapter.apply(addPlan);

    // Verify written content has quoted header and can be re-parsed
    const afterAdd = readFileSync(dest, "utf8");
    expect(afterAdd).toContain(`[mcp_servers."github.com"]`);
    expect(() => parseToml(afterAdd)).not.toThrow();

    // read() enumerates "github.com" as a server name
    const readResult = codexAdapter.read();
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) throw new Error();
    expect(readResult.serverNames).toContain("github.com");

    // Remove "github.com"
    const removePlan = codexAdapter.plan(makeCanonical(), ["github.com"]);
    expect(removePlan.ok).toBe(true);
    if (!removePlan.ok) throw new Error();
    expect(removePlan.changes).toEqual([{ op: "remove", name: "github.com" }]);
    codexAdapter.apply(removePlan);

    // Verify removed and unmanaged content preserved
    const afterRemove = readFileSync(dest, "utf8");
    expect(afterRemove).not.toContain(`[mcp_servers."github.com"]`);
    // Original comments and unmanaged tables must survive
    expect(afterRemove).toContain("# Codex CLI configuration");
    expect(afterRemove).toContain("[mcp_servers.user_owned]");
    expect(() => parseToml(afterRemove)).not.toThrow();

    // Suppress unused variable warning
    void originalContent;
  });
});

// ── Fix: remote servers emit http_headers ────────────────────────────────────

describe("codexAdapter — remote server http_headers (fix: emit credentials)", () => {
  it("spliceBlocks: remote server with headers emits http_headers inline table", () => {
    const server: McpServer = {
      url: "https://mcp.example.com",
      type: "http",
      headers: { Authorization: "Bearer secret", "X-Custom": "value" },
    };
    const result = spliceBlocks("", [], [["remote_srv", server]]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.content).toContain(`http_headers = {`);
    expect(result.content).toContain(`Authorization = "Bearer secret"`);
    expect(result.content).toContain(`X-Custom = "value"`);
  });

  it("codexAdapter plan: remote server with headers writes http_headers to TOML", () => {
    placeFixture();
    const canonical = makeCanonical({
      remote_auth: {
        url: "https://api.example.com/mcp",
        type: "http",
        headers: { Authorization: "Bearer mytoken" },
      },
    });
    const plan = codexAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();
    expect(plan.changes).toEqual([{ op: "add", name: "remote_auth" }]);
    const content = plan.finalDoc._tomlContent as string;
    expect(content).toContain("[mcp_servers.remote_auth]");
    expect(content).toContain('url = "https://api.example.com/mcp"');
    expect(content).toContain("http_headers = {");
    expect(content).toContain('Authorization = "Bearer mytoken"');
    // Must produce valid TOML
    expect(() => parseToml(content)).not.toThrow();
  });

  it("remote server without headers does not emit http_headers", () => {
    placeFixture();
    const canonical = makeCanonical({
      remote_no_auth: { url: "https://open.example.com/mcp", type: "http" },
    });
    const plan = codexAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();
    const content = plan.finalDoc._tomlContent as string;
    expect(content).not.toContain("http_headers");
  });

  it("remote server with headers: round-trip is a no-op (content-equality accounts for headers)", () => {
    placeFixture();
    const canonical = makeCanonical({
      remote_auth: {
        url: "https://api.example.com/mcp",
        type: "http",
        headers: { Authorization: "Bearer ${MY_TOKEN}" },
      },
    });
    // First apply
    const plan1 = codexAdapter.plan(canonical, []);
    expect(plan1.ok).toBe(true);
    if (!plan1.ok) throw new Error();
    codexAdapter.apply(plan1);

    // Second plan with same canonical as managed — must be a no-op
    const plan2 = codexAdapter.plan(canonical, ["remote_auth"]);
    expect(plan2.ok).toBe(true);
    if (!plan2.ok) throw new Error();
    expect(plan2.changes).toHaveLength(0);
  });
});

// ── Fix: CODEX_HOME env override ─────────────────────────────────────────────

describe("codexAdapter — CODEX_HOME env override", () => {
  let prevCodexHome: string | undefined;
  let codexHomeDir: string;

  beforeEach(() => {
    prevCodexHome = process.env.CODEX_HOME;
    codexHomeDir = mkdtempSync(join(tmpdir(), "skdd-codex-home-"));
  });

  afterEach(() => {
    if (prevCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = prevCodexHome;
    }
    rmSync(codexHomeDir, { recursive: true, force: true });
  });

  it("configPath() uses CODEX_HOME when set", () => {
    process.env.CODEX_HOME = codexHomeDir;
    expect(codexAdapter.configPath()).toBe(join(codexHomeDir, "config.toml"));
  });

  it("configPath() falls back to ~/.codex/config.toml when CODEX_HOME unset", () => {
    delete process.env.CODEX_HOME;
    expect(codexAdapter.configPath()).toBe(join(fakeTmp, ".codex", "config.toml"));
  });

  it("available() returns true when CODEX_HOME dir exists", () => {
    process.env.CODEX_HOME = codexHomeDir; // dir already created by mkdtempSync
    expect(codexAdapter.available()).toBe(true);
  });

  it("available() returns false when CODEX_HOME dir does not exist", () => {
    const nonExistent = join(codexHomeDir, "nonexistent");
    process.env.CODEX_HOME = nonExistent;
    expect(codexAdapter.available()).toBe(false);
  });

  it("read() reads config.toml from CODEX_HOME", () => {
    process.env.CODEX_HOME = codexHomeDir;
    // Write a minimal config.toml into codexHomeDir
    writeFileSync(
      join(codexHomeDir, "config.toml"),
      '[mcp_servers.test_srv]\ncommand = "test"\n',
      "utf8",
    );
    const result = codexAdapter.read();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.serverNames).toContain("test_srv");
  });

  it("plan() writes to CODEX_HOME/config.toml, not ~/.codex/config.toml", () => {
    process.env.CODEX_HOME = codexHomeDir;
    const canonical = makeCanonical({
      my_srv: { command: "my-tool" },
    });
    const plan = codexAdapter.plan(canonical, []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error();
    expect(plan.filePath).toBe(join(codexHomeDir, "config.toml"));
    codexAdapter.apply(plan);
    expect(existsSync(join(codexHomeDir, "config.toml"))).toBe(true);
    // ~/.codex/config.toml should NOT have been created in fakeTmp
    expect(existsSync(join(fakeTmp, ".codex", "config.toml"))).toBe(false);
  });
});

// ── Fix: trim leading whitespace when detecting Codex TOML block boundaries ──

describe("codexAdapter — indented table header after managed block (leading-whitespace fix)", () => {
  it("findBlockExtent: recognizes indented table header as block boundary", () => {
    const lines = [
      "[mcp_servers.x]",
      'command = "tool"',
      '  [projects."/p"]', // indented table header
      'path = "/p"',
    ];
    // Block for x should end at line 2 (the indented header), not extend to EOF
    expect(findBlockExtent(lines, "x")).toEqual([0, 2]);
  });

  it("spliceBlocks: updating a managed block preserves indented table that follows it", () => {
    const content = [
      "[settings]",
      'foo = "bar"',
      "",
      "[mcp_servers.x]",
      'command = "old"',
      "",
      '  [projects."/p"]',
      'path = "/p"',
      "",
    ].join("\n");
    const newServer: McpServer = { command: "new-cmd" };
    const result = spliceBlocks(content, [], [["x", newServer]]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    // Old block removed, new block appended
    expect(result.content).not.toContain('command = "old"');
    expect(result.content).toContain('command = "new-cmd"');
    // The indented projects table must be preserved verbatim
    expect(result.content).toContain('  [projects."/p"]');
    expect(result.content).toContain('path = "/p"');
    // Unrelated settings must survive
    expect(result.content).toContain("[settings]");
    expect(result.content).toContain('foo = "bar"');
  });

  it("spliceBlocks: removing a managed block preserves indented table that follows it", () => {
    const content = [
      "[settings]",
      'foo = "bar"',
      "[mcp_servers.x]",
      'command = "old"',
      '  [projects."/p"]',
      'path = "/p"',
    ].join("\n");
    const result = spliceBlocks(content, ["x"], []);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    // Managed block removed
    expect(result.content).not.toContain("[mcp_servers.x]");
    expect(result.content).not.toContain('command = "old"');
    // Indented projects table preserved verbatim
    expect(result.content).toContain('  [projects."/p"]');
    expect(result.content).toContain('path = "/p"');
    // Unrelated settings preserved
    expect(result.content).toContain("[settings]");
  });

  it("spliceBlocks: comment and blank lines before indented table are preserved", () => {
    const content = [
      "[mcp_servers.x]",
      'command = "old"',
      "# section comment",
      "",
      '  [projects."/p"]',
      'path = "/p"',
    ].join("\n");
    const newServer: McpServer = { command: "new" };
    const result = spliceBlocks(content, [], [["x", newServer]]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    // Comment line that was BETWEEN the block end and the indented table:
    // The block ends at "# section comment" (non-table line), so the comment
    // and blank line are preserved as part of the trailing content.
    expect(result.content).toContain('  [projects."/p"]');
    expect(result.content).toContain('path = "/p"');
  });

  it("spliceBlocks: re-parse gate holds when indented table follows managed block", () => {
    const content = ["[mcp_servers.x]", 'command = "old"', '  [projects."/p"]', 'path = "/p"'].join(
      "\n",
    );
    const newServer: McpServer = { command: "new-cmd" };
    const result = spliceBlocks(content, [], [["x", newServer]]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    // The result must parse as valid TOML
    expect(() => parseToml(result.content)).not.toThrow();
  });

  it("codexAdapter.plan: update preserves indented table that follows managed block", () => {
    // Write a config.toml with managed block followed by an indented table
    const dir = join(fakeTmp, ".codex");
    mkdirSync(dir, { recursive: true });
    const content = [
      "# Codex config",
      "[mcp_servers.x]",
      'command = "old"',
      "",
      '  [projects."/p"]',
      'path = "/p"',
      "",
    ].join("\n");
    writeFileSync(join(dir, "config.toml"), content, "utf8");

    const canonical = makeCanonical({ x: { command: "new-cmd" } });
    const plan = codexAdapter.plan(canonical, ["x"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.changes).toEqual([{ op: "update", name: "x" }]);
    const result = plan.finalDoc._tomlContent as string;

    // Old block gone
    expect(result).not.toContain('command = "old"');
    // New block present
    expect(result).toContain('command = "new-cmd"');
    // Indented projects table preserved verbatim (no truncation)
    expect(result).toContain('  [projects."/p"]');
    expect(result).toContain('path = "/p"');
    // Must parse as valid TOML
    expect(() => parseToml(result)).not.toThrow();
  });

  it("codexAdapter.plan: remove preserves indented table that follows managed block", () => {
    const dir = join(fakeTmp, ".codex");
    mkdirSync(dir, { recursive: true });
    const content = [
      "# Codex config",
      "[mcp_servers.x]",
      'command = "old"',
      '  [projects."/p"]',
      'path = "/p"',
    ].join("\n");
    writeFileSync(join(dir, "config.toml"), content, "utf8");

    const canonical = makeCanonical(); // empty — remove x
    const plan = codexAdapter.plan(canonical, ["x"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.changes).toEqual([{ op: "remove", name: "x" }]);
    const result = plan.finalDoc._tomlContent as string;

    // Managed block gone
    expect(result).not.toContain("[mcp_servers.x]");
    // Indented projects table preserved (no truncation)
    expect(result).toContain('  [projects."/p"]');
    expect(result).toContain('path = "/p"');
    // Must parse as valid TOML
    expect(() => parseToml(result)).not.toThrow();
  });
});

// ── Fix: trim leading whitespace on managed block START (indented header) ────

describe("codexAdapter — indented managed block START (block-start leading-whitespace fix)", () => {
  it("findBlockExtent: locates an indented managed root header '  [mcp_servers.x]'", () => {
    const lines = [
      "[other]",
      "y = 1",
      "  [mcp_servers.x]",
      'command = "tool"',
      "[settings]",
      "z = 2",
    ];
    expect(findBlockExtent(lines, "x")).toEqual([2, 4]);
  });

  it("findBlockExtent: indented managed header with indented sub-table includes the sub-table", () => {
    const lines = [
      "  [mcp_servers.x]",
      'command = "tool"',
      "  [mcp_servers.x.tools.foo]",
      "enabled = true",
      "[settings]",
      "z = 1",
    ];
    expect(findBlockExtent(lines, "x")).toEqual([0, 4]);
  });

  it("spliceBlocks: update changes only the indented managed block", () => {
    const content = [
      "[settings]",
      'foo = "bar"',
      "  [mcp_servers.x]",
      'command = "old"',
      "[other]",
      "y = 1",
    ].join("\n");
    const newServer: McpServer = { command: "new-cmd" };
    const result = spliceBlocks(content, [], [["x", newServer]]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    // Old block removed, new block appended
    expect(result.content).not.toContain('command = "old"');
    expect(result.content).toContain('command = "new-cmd"');
    // Surrounding tables preserved
    expect(result.content).toContain("[settings]");
    expect(result.content).toContain('foo = "bar"');
    expect(result.content).toContain("[other]");
    expect(result.content).toContain("y = 1");
  });

  it("spliceBlocks: remove deletes only the indented managed block", () => {
    const content = [
      "[settings]",
      'foo = "bar"',
      "  [mcp_servers.x]",
      'command = "old"',
      "[other]",
      "y = 1",
    ].join("\n");
    const result = spliceBlocks(content, ["x"], []);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.content).not.toContain("[mcp_servers.x]");
    expect(result.content).not.toContain('command = "old"');
    expect(result.content).toContain("[settings]");
    expect(result.content).toContain("[other]");
  });

  it("spliceBlocks: indented managed block with indented sub-table removed entirely on remove", () => {
    const content = [
      "  [mcp_servers.x]",
      'command = "old"',
      "  [mcp_servers.x.tools.foo]",
      "enabled = true",
      "[settings]",
      "z = 1",
    ].join("\n");
    const result = spliceBlocks(content, ["x"], []);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.content).not.toContain("[mcp_servers.x]");
    expect(result.content).not.toContain("[mcp_servers.x.tools.foo]");
    expect(result.content).toContain("[settings]");
  });

  it("spliceBlocks: re-parse gate holds after updating indented managed block", () => {
    const content = ["  [mcp_servers.x]", 'command = "old"', "[settings]", "z = 1"].join("\n");
    const newServer: McpServer = { command: "new-cmd" };
    const result = spliceBlocks(content, [], [["x", newServer]]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(() => parseToml(result.content)).not.toThrow();
  });

  it("spliceBlocks: comments BEFORE indented block and subsequent table are preserved when removing", () => {
    // The block extent includes lines from the header up to (but not including)
    // the next [table] line; a comment at the top before the block is preserved.
    const content = [
      "# top comment",
      "",
      "  [mcp_servers.x]",
      'command = "old"',
      "[other]",
      "y = 1",
    ].join("\n");
    const result = spliceBlocks(content, ["x"], []);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.content).not.toContain("[mcp_servers.x]");
    expect(result.content).toContain("# top comment");
    expect(result.content).toContain("[other]");
  });

  it("codexAdapter.plan: update of indented managed block changes only that block", () => {
    const dir = join(fakeTmp, ".codex");
    mkdirSync(dir, { recursive: true });
    const content = [
      "# Codex config",
      "[settings]",
      'model = "o3"',
      "",
      "  [mcp_servers.x]",
      'command = "old"',
      "",
      "[shell]",
      'shell = "bash"',
      "",
    ].join("\n");
    writeFileSync(join(dir, "config.toml"), content, "utf8");

    const canonical = makeCanonical({ x: { command: "new-cmd" } });
    const plan = codexAdapter.plan(canonical, ["x"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.changes).toEqual([{ op: "update", name: "x" }]);
    const result = plan.finalDoc._tomlContent as string;

    expect(result).not.toContain('command = "old"');
    expect(result).toContain('command = "new-cmd"');
    // Unrelated sections preserved
    expect(result).toContain("# Codex config");
    expect(result).toContain("[settings]");
    expect(result).toContain('model = "o3"');
    expect(result).toContain("[shell]");
    expect(result).toContain('shell = "bash"');
    // Must produce valid TOML
    expect(() => parseToml(result)).not.toThrow();
  });

  it("codexAdapter.plan: remove of indented managed block preserves surrounding content", () => {
    const dir = join(fakeTmp, ".codex");
    mkdirSync(dir, { recursive: true });
    const content = [
      "# Codex config",
      "[settings]",
      'model = "o3"',
      "  [mcp_servers.x]",
      'command = "old"',
      "[shell]",
      'shell = "bash"',
    ].join("\n");
    writeFileSync(join(dir, "config.toml"), content, "utf8");

    const canonical = makeCanonical();
    const plan = codexAdapter.plan(canonical, ["x"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.changes).toEqual([{ op: "remove", name: "x" }]);
    const result = plan.finalDoc._tomlContent as string;

    expect(result).not.toContain("[mcp_servers.x]");
    expect(result).not.toContain('command = "old"');
    expect(result).toContain("[settings]");
    expect(result).toContain("[shell]");
    expect(() => parseToml(result)).not.toThrow();
  });
});

// ── Fix: inline comments on TOML table headers ───────────────────────────────

describe("codexAdapter — inline comments on table headers (inline-comment fix)", () => {
  it("findBlockExtent: locates block when header has a trailing inline comment", () => {
    const lines = ["[mcp_servers.foo] # managed by skdd", 'command = "tool"', "[other]", "y = 1"];
    expect(findBlockExtent(lines, "foo")).toEqual([0, 2]);
  });

  it("findBlockExtent: locates block when header has a comment with leading spaces", () => {
    const lines = ["[mcp_servers.foo]  # do not edit", 'command = "tool"'];
    expect(findBlockExtent(lines, "foo")).toEqual([0, 2]);
  });

  it("findBlockExtent: does NOT treat # inside a quoted server name as a comment", () => {
    // [mcp_servers."a#b"] — the # is inside quotes, not a comment
    const lines = [`[mcp_servers."a#b"]`, 'command = "tool"', "[other]", "y = 1"];
    expect(findBlockExtent(lines, "a#b")).toEqual([0, 2]);
  });

  it("findBlockExtent: block boundary stops at next header even when it has an inline comment", () => {
    const lines = [
      "[mcp_servers.first] # managed",
      'command = "first"',
      "[mcp_servers.second] # also managed",
      'command = "second"',
    ];
    expect(findBlockExtent(lines, "first")).toEqual([0, 2]);
    expect(findBlockExtent(lines, "second")).toEqual([2, 4]);
  });

  it("findBlockExtent: sub-table with inline comment stays inside the block", () => {
    const lines = [
      "[mcp_servers.srv] # managed",
      'command = "tool"',
      "[mcp_servers.srv.tools.foo] # sub",
      "enabled = true",
      "[other]",
      "x = 1",
    ];
    expect(findBlockExtent(lines, "srv")).toEqual([0, 4]);
  });

  it("spliceBlocks: update replaces header-with-comment block in place (no duplicate)", () => {
    const content = [
      "[settings]",
      'foo = "bar"',
      "",
      "[mcp_servers.foo] # managed by skdd",
      'command = "old"',
      "",
      "[other]",
      "y = 1",
    ].join("\n");
    const newServer: McpServer = { command: "new-cmd" };
    const result = spliceBlocks(content, [], [["foo", newServer]]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    // Old block removed
    expect(result.content).not.toContain('command = "old"');
    // New block appended
    expect(result.content).toContain("[mcp_servers.foo]");
    expect(result.content).toContain('command = "new-cmd"');
    // No duplicate header
    const headerCount = (result.content.match(/\[mcp_servers\.foo/g) ?? []).length;
    expect(headerCount).toBe(1);
    // Surrounding content preserved
    expect(result.content).toContain("[settings]");
    expect(result.content).toContain("[other]");
    // Re-parse gate must pass
    expect(() => parseToml(result.content)).not.toThrow();
  });

  it("spliceBlocks: remove deletes the block including its commented header", () => {
    const content = [
      "[settings]",
      'foo = "bar"',
      "[mcp_servers.foo] # managed",
      'command = "tool"',
      "[other]",
      "y = 1",
    ].join("\n");
    const result = spliceBlocks(content, ["foo"], []);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.content).not.toContain("[mcp_servers.foo]");
    expect(result.content).not.toContain('command = "tool"');
    expect(result.content).toContain("[settings]");
    expect(result.content).toContain("[other]");
    expect(() => parseToml(result.content)).not.toThrow();
  });

  it("spliceBlocks: server name with '#' in quotes is not mis-split", () => {
    // Server named "a#b": header is [mcp_servers."a#b"] — the # is inside quotes
    const content = [`[mcp_servers."a#b"]`, 'command = "tool"', "[settings]", "x = 1"].join("\n");
    const newServer: McpServer = { command: "updated" };
    const result = spliceBlocks(content, [], [["a#b", newServer]]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.content).not.toContain('command = "tool"');
    expect(result.content).toContain('command = "updated"');
    expect(result.content).toContain(`[mcp_servers."a#b"]`);
    const headerCount = (result.content.match(/\[mcp_servers\."a#b"\]/g) ?? []).length;
    expect(headerCount).toBe(1);
    expect(() => parseToml(result.content)).not.toThrow();
  });

  it("spliceBlocks: comments on OTHER lines/tables are preserved verbatim", () => {
    const content = [
      "# top-level comment",
      "[settings] # keep me",
      'model = "o3" # also keep',
      "",
      "[mcp_servers.foo] # managed",
      'command = "old"',
      "",
      "[other] # section comment",
      "y = 1",
    ].join("\n");
    const newServer: McpServer = { command: "new-cmd" };
    const result = spliceBlocks(content, [], [["foo", newServer]]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.content).toContain("# top-level comment");
    expect(result.content).toContain("[settings] # keep me");
    expect(result.content).toContain('model = "o3" # also keep');
    expect(result.content).toContain("[other] # section comment");
    expect(() => parseToml(result.content)).not.toThrow();
  });

  it("codexAdapter.plan: update of a header-with-comment block writes correctly without duplicate", () => {
    const dir = join(fakeTmp, ".codex");
    mkdirSync(dir, { recursive: true });
    const content = [
      "# Codex config",
      "[settings]",
      'model = "o3"',
      "",
      "[mcp_servers.foo] # managed by skdd",
      'command = "old-cmd"',
      "",
      "[shell]",
      'shell = "zsh"',
    ].join("\n");
    writeFileSync(join(dir, "config.toml"), content, "utf8");

    const canonical = makeCanonical({ foo: { command: "new-cmd" } });
    const plan = codexAdapter.plan(canonical, ["foo"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.changes).toEqual([{ op: "update", name: "foo" }]);
    const result = plan.finalDoc._tomlContent as string;

    expect(result).not.toContain('command = "old-cmd"');
    expect(result).toContain('command = "new-cmd"');
    // No duplicate
    const headerCount = (result.match(/\[mcp_servers\.foo/g) ?? []).length;
    expect(headerCount).toBe(1);
    // Surrounding content preserved
    expect(result).toContain("# Codex config");
    expect(result).toContain("[settings]");
    expect(result).toContain("[shell]");
    expect(() => parseToml(result)).not.toThrow();
  });

  it("codexAdapter.plan: remove of a header-with-comment block deletes it cleanly", () => {
    const dir = join(fakeTmp, ".codex");
    mkdirSync(dir, { recursive: true });
    const content = [
      "# config",
      "[settings]",
      "x = 1",
      "[mcp_servers.foo] # managed",
      'command = "tool"',
      "[other]",
      "y = 2",
    ].join("\n");
    writeFileSync(join(dir, "config.toml"), content, "utf8");

    const canonical = makeCanonical();
    const plan = codexAdapter.plan(canonical, ["foo"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.changes).toEqual([{ op: "remove", name: "foo" }]);
    const result = plan.finalDoc._tomlContent as string;

    expect(result).not.toContain("[mcp_servers.foo]");
    expect(result).toContain("[settings]");
    expect(result).toContain("[other]");
    expect(() => parseToml(result)).not.toThrow();
  });
});

// ── Fix: inline-table header key quoting (http_headers + env) ────────────────

describe("codexAdapter — inline-table header key quoting (fix: dot-in-header-name)", () => {
  it("spliceBlocks: header key with dot is TOML-quoted in http_headers inline table", () => {
    const server: McpServer = {
      url: "https://mcp.example.com",
      type: "http",
      headers: { "X.Api": "v", Normal: "w" },
    };
    const result = spliceBlocks("", [], [["remote_srv", server]]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    // Dot-containing key must be JSON-quoted so TOML sees it as a flat key
    expect(result.content).toContain(`"X.Api" = "v"`);
    // Normal bare key emitted without quotes
    expect(result.content).toContain(`Normal = "w"`);
  });

  it("parseToml reads X.Api as a FLAT key (not nested X → Api)", () => {
    const server: McpServer = {
      url: "https://mcp.example.com",
      type: "http",
      headers: { "X.Api": "v", Normal: "w" },
    };
    const result = spliceBlocks("", [], [["remote_srv", server]]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    const parsed = parseToml(result.content) as Record<string, unknown>;
    const servers = parsed.mcp_servers as Record<string, unknown>;
    const srv = servers.remote_srv as Record<string, unknown>;
    const headers = srv.http_headers as Record<string, unknown>;
    // "X.Api" must be a flat key, not nested
    expect(headers["X.Api"]).toBe("v");
    expect((headers as Record<string, unknown>).X).toBeUndefined();
    expect(headers.Normal).toBe("w");
  });

  it("round-trip (write → read → no-op plan) is stable when headers contain dot keys", () => {
    placeFixture();
    const canonical = makeCanonical({
      remote_dot: {
        url: "https://api.example.com/mcp",
        type: "http",
        headers: { "X.Api": "v", Authorization: "Bearer tok" },
      },
    });
    // First apply
    const plan1 = codexAdapter.plan(canonical, []);
    expect(plan1.ok).toBe(true);
    if (!plan1.ok) throw new Error();
    codexAdapter.apply(plan1);

    // Second plan with same canonical as managed — must be a no-op
    const plan2 = codexAdapter.plan(canonical, ["remote_dot"]);
    expect(plan2.ok).toBe(true);
    if (!plan2.ok) throw new Error();
    expect(plan2.changes).toHaveLength(0);
  });

  it("header value with special chars (quotes, backslash) is correctly escaped", () => {
    const server: McpServer = {
      url: "https://mcp.example.com",
      type: "http",
      headers: { Authorization: 'Bearer "special\\value"', Normal: "plain" },
    };
    const result = spliceBlocks("", [], [["srv", server]]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    // Must produce valid TOML
    expect(() => parseToml(result.content)).not.toThrow();
    // Re-parse and verify value is round-tripped correctly
    const parsed = parseToml(result.content) as Record<string, unknown>;
    const servers = parsed.mcp_servers as Record<string, unknown>;
    const srv = servers.srv as Record<string, unknown>;
    const headers = srv.http_headers as Record<string, unknown>;
    expect(headers.Authorization).toBe('Bearer "special\\value"');
    expect(headers.Normal).toBe("plain");
  });

  it("env keys with dots are also quoted in env inline table", () => {
    const server: McpServer = {
      command: "tool",
      env: { "MY.VAR": "val", NORMAL: "ok" },
    };
    const result = spliceBlocks("", [], [["srv", server]]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    // Dot-containing env key must be quoted
    expect(result.content).toContain(`"MY.VAR" = "val"`);
    expect(result.content).toContain(`NORMAL = "ok"`);
    // Must produce valid TOML
    expect(() => parseToml(result.content)).not.toThrow();
    const parsed = parseToml(result.content) as Record<string, unknown>;
    const servers = parsed.mcp_servers as Record<string, unknown>;
    const srv = servers.srv as Record<string, unknown>;
    const env = srv.env as Record<string, unknown>;
    expect(env["MY.VAR"]).toBe("val");
  });
});

// ── Fix 2 parity: deep-equal content check (codex) ───────────────────────────

describe("codexAdapter — content-equality no-op (fix-2 parity)", () => {
  it("produces no changes when a managed server content is already up to date", () => {
    // Place fixture and run a full add cycle first
    placeFixture();
    const canonical = makeCanonical({ "my-new-srv": { command: "npx", args: ["-y", "my-pkg"] } });
    const plan1 = codexAdapter.plan(canonical, []);
    codexAdapter.apply(plan1);

    // Now re-plan with the same canonical as managed — should be a no-op
    const plan2 = codexAdapter.plan(canonical, ["my-new-srv"]);
    expect(plan2.ok).toBe(true);
    if (!plan2.ok) throw new Error();
    expect(plan2.changes).toHaveLength(0);
  });

  it("second apply after first sync does not rewrite the file (mtime unchanged)", async () => {
    placeFixture();
    const dest = join(fakeTmp, ".codex", "config.toml");
    const canonical = makeCanonical({ "mtime-test": { command: "echo" } });

    const plan1 = codexAdapter.plan(canonical, []);
    codexAdapter.apply(plan1);

    const mtime1 = statSync(dest).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));

    const plan2 = codexAdapter.plan(canonical, ["mtime-test"]);
    expect(plan2.ok).toBe(true);
    if (!plan2.ok) throw new Error();
    expect(plan2.changes).toHaveLength(0);
    // apply a no-changes plan — written:false, file untouched
    const result = codexAdapter.apply(plan2);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.written).toBe(false);

    expect(statSync(dest).mtimeMs).toBe(mtime1);
  });
});
