import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDrops } from "../src/commands/drops.js";

const MINI_COMMONS = join(__dirname, "fixtures", "mini-commons");

let logs: string[] = [];
let origLog: typeof console.log;
let origWarn: typeof console.warn;
let origError: typeof console.error;

beforeEach(() => {
  logs = [];
  origLog = console.log;
  origWarn = console.warn;
  origError = console.error;
  const push = (...args: unknown[]) => {
    logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  console.log = push as typeof console.log;
  console.warn = push as typeof console.warn;
  console.error = push as typeof console.error;
});

afterEach(() => {
  console.log = origLog;
  console.warn = origWarn;
  console.error = origError;
});

describe("runDrops", () => {
  it("lists drops from a local commons as a table", async () => {
    const code = await runDrops({ from: MINI_COMMONS });
    expect(code).toBe(0);
    const out = logs.join("\n");
    expect(out).toContain("2026-01-test");
    expect(out).toContain("January 2026 Test");
    expect(out).toContain("https://example.com/mini-commons-story");
  });

  it("emits JSON with --format json", async () => {
    const code = await runDrops({ from: MINI_COMMONS, format: "json" });
    expect(code).toBe(0);
    const payload = JSON.parse(logs.find((l) => l.trim().startsWith("{"))!);
    expect(payload.drops).toHaveLength(1);
    expect(payload.drops[0].id).toBe("2026-01-test");
    expect(payload.drops[0].skills).toHaveLength(2);
  });

  it("errors on a directory without drops.json", async () => {
    const notCommons = mkdtempSync(join(tmpdir(), "skdd-notcommons-"));
    try {
      const code = await runDrops({ from: notCommons });
      expect(code).toBe(1);
      expect(logs.join("\n")).toContain("drops.json");
    } finally {
      rmSync(notCommons, { recursive: true, force: true });
    }
  });
});
