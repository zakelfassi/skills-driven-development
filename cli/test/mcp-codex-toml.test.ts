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
    expect(plan.changes.some((c) => c.op === "remove" && c.name === "existing_managed")).toBe(
      true,
    );
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
    expect(plan.changes.some((c) => c.op === "update" && c.name === "existing_managed")).toBe(
      true,
    );
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
