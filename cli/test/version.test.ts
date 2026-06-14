/**
 * Drift tripwire: ensures version is read from package.json at build time,
 * not hardcoded in source.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

describe("version build-time define", () => {
  it("index.ts contains no hardcoded semver literal (except 0.0.0-dev fallback)", () => {
    const src = readFileSync(resolve(ROOT, "src/index.ts"), "utf8");
    // Strip the allowed fallback string before checking
    const withoutFallback = src.replace(/["']0\.0\.0-dev["']/g, "");
    expect(withoutFallback).not.toMatch(/"[\d]+\.[\d]+\.[\d]+"/);
  });

  it("index.ts uses __SKDD_VERSION__ define with typeof guard fallback", () => {
    const src = readFileSync(resolve(ROOT, "src/index.ts"), "utf8");
    expect(src).toMatch(/__SKDD_VERSION__/);
    expect(src).toMatch(/typeof __SKDD_VERSION__ !== ["']undefined["']/);
    expect(src).toMatch(/0\.0\.0-dev/);
  });

  it("tsup.config.ts defines __SKDD_VERSION__ from package.json", () => {
    const config = readFileSync(resolve(ROOT, "tsup.config.ts"), "utf8");
    expect(config).toMatch(/__SKDD_VERSION__/);
    expect(config).toMatch(/pkg\.version/);
    expect(config).toMatch(/readFileSync/);
    expect(config).toMatch(/package\.json/);
  });

  it("built CLI --version output matches cli/package.json version dynamically", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    const distIndex = resolve(ROOT, "dist/index.js");
    // Build so dist reflects the current package.json version
    execSync("pnpm build", { cwd: ROOT, stdio: "pipe" });
    const output = execSync(`node ${JSON.stringify(distIndex)} --version`, {
      encoding: "utf8",
    }).trim();
    expect(output).toBe(pkg.version);
  });
});
