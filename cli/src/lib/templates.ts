/**
 * Inline templates used by `skdd init` and `skdd forge`.
 * Kept as string constants so the built CLI has no runtime file dependencies.
 */

export interface SkillSkeletonInput {
  name: string;
  description: string;
  forgedBy?: string;
  forgedFrom?: string;
  forgedReason?: string;
}

export function renderSkillSkeleton(input: SkillSkeletonInput): string {
  const { name, description, forgedBy, forgedFrom, forgedReason } = input;
  const metadataLines: string[] = [];
  if (forgedBy) metadataLines.push(`  forged-by: ${forgedBy}`);
  if (forgedFrom) metadataLines.push(`  forged-from: ${forgedFrom}`);
  if (forgedReason) metadataLines.push(`  forged-reason: "${forgedReason.replace(/"/g, '\\"')}"`);
  metadataLines.push(`  status: active`);

  return `---
name: ${name}
description: ${description}
metadata:
${metadataLines.join("\n")}
---

# ${toTitle(name)}

${description}

## Inputs

- ...

## Steps

1. ...
2. ...
3. ...

## Conventions

- Project-specific patterns that apply

## Edge Cases

- Known gotchas or special handling
`;
}

export const EMPTY_REGISTRY_MD = `# Skills Registry

> Auto-maintained. Agents update this when skills are created, used, or evolved.

## Available Skills

| Skill | Source | Last Used | Uses | Description |
|-------|--------|-----------|------|-------------|
`;

export const SKILLFORGE_STUB = `---
name: skillforge
description: Create or update a reusable agent skill. Use when you notice a repeated pattern, when a workflow should be persisted for future sessions, or when asked to forge/create/scaffold a new skill.
metadata:
  author: zakelfassi
  version: "2.0"
  spec: agentskills.io
---

# SkillForge

Create well-formed, spec-compliant skills from observed patterns. See https://github.com/zakelfassi/skills-driven-development/blob/main/skillforge/SKILL.md for the canonical version — this stub is written by \`skdd init\` to get you unblocked; pull the full version for the complete checklist.

## Quick steps

1. Name the pattern (kebab-case, verb-led).
2. Write \`SKILL.md\` with frontmatter (\`name\`, \`description\`) and a Steps section.
3. Register in \`.skills-registry.md\` at the project root.
4. Commit.
`;

export function renderHarnessInstructionBlock(skillsDir: string, registryPath: string): string {
  return `## Skills

Skills live under \`${skillsDir}/<name>/SKILL.md\`. The registry is at \`${registryPath}\` in the project root.

At session start, read \`${registryPath}\` to discover available skills. Before deriving a solution, check whether an existing skill covers the task and follow it. When you notice a pattern repeat 2-3 times, or when I ask you to "forge a skill for X", invoke the \`skillforge\` skill and follow its steps. Update the registry after forging or using a skill.
`;
}

/**
 * Instruction block for projects using the canonical `skills/` + harness-mirror pattern.
 * Agents should treat `skills/` as the single source of truth; the harness path is a mirror
 * maintained by `skdd link` so the harness's conventional discovery still works.
 */
export function renderCanonicalInstructionBlock(
  canonicalDir: string,
  mirrorDir: string,
  registryPath: string,
  harnessLabel: string,
): string {
  return `## Skills

Skills live at \`${canonicalDir}/<name>/SKILL.md\` (canonical, single source of truth). The registry is at \`${registryPath}\` in the project root.

\`${mirrorDir}\` is a mirror of \`${canonicalDir}/\` maintained by \`skdd link\` so that ${harnessLabel} can find skills at its conventional path. Treat \`${canonicalDir}/\` as the source — edit there, and run \`skdd link\` (or let \`skdd forge\` do it automatically) to refresh the mirror. On Unix the mirror is a symlink; on Windows it's a file copy tracked in \`.skdd-sync.json\`.

At session start, read \`${registryPath}\` to discover available skills. Before deriving a solution, check whether an existing skill covers the task and follow it. When you notice a pattern repeat 2-3 times, or when I ask you to "forge a skill for X", invoke the \`skillforge\` skill and follow its steps. Update the registry after forging or using a skill. **Always write new skills to \`${canonicalDir}/\`**, never to the mirror.
`;
}

function toTitle(name: string): string {
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
