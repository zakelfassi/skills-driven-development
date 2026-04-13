import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type Harness =
  | "claude"
  | "codex"
  | "cursor"
  | "copilot"
  | "gemini"
  | "opencode"
  | "goose"
  | "amp";

export interface HarnessProfile {
  id: Harness;
  label: string;
  skillsDir: string; // relative to project root
  instructionFile: string; // relative to project root
  instructionHint: string; // what to tell users to add
}

export const HARNESSES: Record<Harness, HarnessProfile> = {
  claude: {
    id: "claude",
    label: "Claude Code",
    skillsDir: ".claude/skills",
    instructionFile: "CLAUDE.md",
    instructionHint: "Add a `## Skills` section pointing at `.skills-registry.md`",
  },
  codex: {
    id: "codex",
    label: "OpenAI Codex",
    skillsDir: ".codex/skills",
    instructionFile: "AGENTS.md",
    instructionHint: "Add a `## Skills` section pointing at `.skills-registry.md`",
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    skillsDir: ".cursor/skills",
    instructionFile: ".cursor/rules/skills.mdc",
    instructionHint: "Add a rules file with alwaysApply: true",
  },
  copilot: {
    id: "copilot",
    label: "GitHub Copilot",
    skillsDir: ".github/skills",
    instructionFile: ".github/copilot-instructions.md",
    instructionHint: "Add a `## Skills` section pointing at `.skills-registry.md`",
  },
  gemini: {
    id: "gemini",
    label: "Gemini CLI",
    skillsDir: ".gemini/skills",
    instructionFile: "AGENTS.md",
    instructionHint: "Add a `## Skills` section pointing at `.skills-registry.md`",
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    skillsDir: ".opencode/skills",
    instructionFile: "AGENTS.md",
    instructionHint: "Add a `## Skills` section pointing at `.skills-registry.md`",
  },
  goose: {
    id: "goose",
    label: "Goose",
    skillsDir: ".goose/skills",
    instructionFile: "AGENTS.md",
    instructionHint: "Add a `## Skills` section pointing at `.skills-registry.md`",
  },
  amp: {
    id: "amp",
    label: "Amp",
    skillsDir: ".amp/skills",
    instructionFile: "AGENTS.md",
    instructionHint: "Add a `## Skills` section pointing at `.skills-registry.md`",
  },
};

const HARNESS_MARKERS: Array<[Harness, string[]]> = [
  ["claude", [".claude/skills", "CLAUDE.md", ".claude"]],
  ["cursor", [".cursor/skills", ".cursor/rules", ".cursor"]],
  ["copilot", [".github/copilot-instructions.md", ".github/skills"]],
  ["codex", [".codex/skills", ".codex"]],
  ["gemini", [".gemini/skills", ".gemini"]],
  ["opencode", [".opencode/skills", ".opencode"]],
  ["goose", [".goose/skills", ".goose"]],
  ["amp", [".amp/skills", ".amp"]],
];

export function detectHarness(cwd: string): Harness | null {
  const root = resolve(cwd);
  for (const [harness, markers] of HARNESS_MARKERS) {
    if (markers.some((marker) => existsSync(join(root, marker)))) {
      return harness;
    }
  }
  return null;
}

/**
 * Return every harness whose marker files/dirs exist in the project.
 * Used by `skdd link` to mirror the canonical `skills/` directory into
 * each harness-expected location at once.
 */
export function detectAllHarnesses(cwd: string): Harness[] {
  const root = resolve(cwd);
  const found: Harness[] = [];
  for (const [harness, markers] of HARNESS_MARKERS) {
    if (markers.some((marker) => existsSync(join(root, marker)))) {
      found.push(harness);
    }
  }
  return found;
}

export function resolveHarness(cwd: string, explicit: Harness | "auto" | undefined): HarnessProfile {
  if (explicit && explicit !== "auto") {
    return HARNESSES[explicit];
  }
  const detected = detectHarness(cwd);
  if (detected) return HARNESSES[detected];
  // Default to Claude Code if nothing detected
  return HARNESSES.claude;
}
