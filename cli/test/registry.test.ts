import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseMarkdownRegistry,
  writeMarkdownRegistry,
  parseJsonRegistry,
  writeJsonRegistry,
  addRegistryEntry,
  loadRegistry,
  resolveRegistryPath,
} from "../src/lib/registry.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skdd-registry-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("parseMarkdownRegistry", () => {
  it("parses an empty registry to zero skills", () => {
    const registry = parseMarkdownRegistry(
      "# Skills Registry\n\n## Available Skills\n\n| Skill | Source | Last Used | Uses | Description |\n|-|-|-|-|-|\n",
    );
    expect(registry.skills).toEqual([]);
    expect(registry.archived).toEqual([]);
  });

  it("parses populated skill rows", () => {
    const md = `# Skills Registry

## Available Skills

| Skill | Source | Last Used | Uses | Description |
|-------|--------|-----------|------|-------------|
| api-endpoint | local | 2026-02-28 | 12 | Scaffold REST endpoints |
| deploy-preview | forked:alpha | 2026-02-27 | 8 | Deploy preview branches |
`;
    const registry = parseMarkdownRegistry(md);
    expect(registry.skills).toHaveLength(2);
    expect(registry.skills[0]).toMatchObject({
      name: "api-endpoint",
      source: "local",
      uses: 12,
      description: "Scaffold REST endpoints",
    });
    expect(registry.skills[1]!.source).toBe("forked:alpha");
  });

  it("parses archived section when present", () => {
    const md = `## Available Skills

| Skill | Source | Last Used | Uses | Description |
|-|-|-|-|-|
| active | local | 2026-01-01 | 3 | Active skill |

## Archived

| Skill | Archived | Reason |
|-|-|-|
| old-skill | 2025-12-01 | Superseded |
`;
    const registry = parseMarkdownRegistry(md);
    expect(registry.skills).toHaveLength(1);
    expect(registry.archived).toHaveLength(1);
    expect(registry.archived[0]!.name).toBe("old-skill");
  });
});

describe("writeMarkdownRegistry", () => {
  it("serializes a registry that can round-trip through parse", () => {
    const original = {
      skills: [
        {
          name: "foo",
          source: "local",
          lastUsed: "2026-04-12",
          uses: 5,
          description: "Foo skill",
        },
      ],
      archived: [],
    };
    const md = writeMarkdownRegistry(original);
    const parsed = parseMarkdownRegistry(md);
    expect(parsed.skills).toHaveLength(1);
    expect(parsed.skills[0]).toMatchObject({
      name: "foo",
      source: "local",
      uses: 5,
      description: "Foo skill",
    });
  });
});

describe("JSON registry", () => {
  it("round-trips through parse and write", () => {
    const json = writeJsonRegistry({
      skills: [
        { name: "alpha", source: "local", description: "Alpha", uses: 1, lastUsed: "2026-04-10" },
      ],
      archived: [],
    });
    const parsed = parseJsonRegistry(json);
    expect(parsed.skills).toHaveLength(1);
    expect(parsed.colony).toBeDefined();
    expect(parsed.colony!.name).toBe("colony");
  });
});

describe("addRegistryEntry", () => {
  it("creates a markdown registry when none exists and appends the entry", () => {
    const entry = {
      name: "new-skill",
      source: "local",
      description: "New skill for testing. Use when running validator tests.",
      lastUsed: "2026-04-12",
      uses: 0,
    };
    addRegistryEntry(tmp, entry);

    const mdPath = resolveRegistryPath(tmp, "md");
    expect(existsSync(mdPath)).toBe(true);
    const loaded = loadRegistry(tmp);
    expect(loaded.skills).toHaveLength(1);
    expect(loaded.skills[0]!.name).toBe("new-skill");
  });

  it("deduplicates entries with the same name", () => {
    addRegistryEntry(tmp, {
      name: "dup",
      source: "local",
      description: "First version",
      uses: 1,
    });
    addRegistryEntry(tmp, {
      name: "dup",
      source: "local",
      description: "Second version",
      uses: 2,
    });
    const loaded = loadRegistry(tmp);
    expect(loaded.skills).toHaveLength(1);
    expect(loaded.skills[0]!.description).toBe("Second version");
    expect(loaded.skills[0]!.uses).toBe(2);
  });

  it("also updates the JSON registry when one already exists", () => {
    const jsonPath = resolveRegistryPath(tmp, "json");
    writeFileSync(
      jsonPath,
      writeJsonRegistry({
        skills: [],
        archived: [],
      }),
    );

    addRegistryEntry(tmp, {
      name: "json-sync",
      source: "local",
      description: "Testing JSON sync",
      uses: 0,
    });

    const jsonContent = readFileSync(jsonPath, "utf8");
    const parsed = parseJsonRegistry(jsonContent);
    expect(parsed.skills).toHaveLength(1);
    expect(parsed.skills[0]!.name).toBe("json-sync");
  });
});
