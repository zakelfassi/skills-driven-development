/**
 * Agent Skills specification constants.
 * Canonical source: https://agentskills.io/specification.md
 * Vendored snapshot: docs/spec/agent-skills-v1.md (at the repo root of skills-driven-development)
 */

export const SPEC_VERSION = "agentskills.io/v1" as const;

// Name field constraints
export const NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const NAME_MIN_LENGTH = 1;
export const NAME_MAX_LENGTH = 64;

// Description field constraints
export const DESCRIPTION_MIN_LENGTH = 1;
export const DESCRIPTION_MAX_LENGTH = 1024;

// Compatibility field constraint (optional field)
export const COMPATIBILITY_MAX_LENGTH = 500;

// SkDD recommendation — not in the spec, but enforced by `skdd validate --strict`
export const SKDD_MAX_SKILL_LINES = 200;

// Spec-required frontmatter fields
export const REQUIRED_FRONTMATTER = ["name", "description"] as const;

// Spec-optional (known) frontmatter fields
export const OPTIONAL_FRONTMATTER = [
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
] as const;

// Known SkDD-extension metadata keys (all live under `metadata`, still spec-legal)
export const SKDD_METADATA_KEYS = [
  "forged-by",
  "forged-from",
  "forged-reason",
  "fork-of",
  "usage-count",
  "last-used",
  "status",
  "archived-reason",
  "superseded-by",
  "requires",
  "author",
  "version",
  "spec",
] as const;

// Optional subdirectories a skill may contain
export const OPTIONAL_SUBDIRS = ["scripts", "references", "assets"] as const;

// Valid `status` values for the SkDD lifecycle profile
export const STATUS_VALUES = ["active", "archived", "deprecated", "draft"] as const;
export type SkillStatus = (typeof STATUS_VALUES)[number];
