import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { select } from "@inquirer/prompts";
import {
  assertWithin,
  type DropsManifest,
  fetchCommons,
  parseSource,
  provenanceLabel,
  readDropsManifest,
  resolveSelector,
} from "../lib/commons.js";
import { ensureGlobalColony, skddHome } from "../lib/global.js";
import { upsertLockEntry } from "../lib/lock.js";
import { logger } from "../lib/logger.js";
import { addRegistryEntry } from "../lib/registry.js";
import { parseSkill } from "../lib/skill.js";
import { NAME_MAX_LENGTH, NAME_REGEX } from "../lib/spec.js";
import { runLink } from "./link.js";
import { validateSkill } from "./validate.js";

export interface AddOptions {
  cwd?: string;
  global?: boolean;
  rename?: string;
  dryRun?: boolean;
  json?: boolean;
  /** Skip the interactive drop picker (CI / agent-driven use). */
  nonInteractive?: boolean;
}

interface InstalledSkill {
  name: string;
  sourceName: string; // upstream name (differs from `name` when --rename is used)
  path: string;
  provenance: string;
  description: string;
}

export async function runAdd(
  sourceArg: string,
  selector: string | undefined,
  opts: AddOptions = {},
): Promise<number> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const colonyRoot = opts.global ? skddHome() : cwd;
  if (opts.global) ensureGlobalColony();
  const canonicalDir = opts.global
    ? join(skddHome(), "skills")
    : join(cwd, detectCanonical(cwd) ?? "skills");

  if (opts.rename) {
    const err = validateRename(opts.rename);
    if (err) {
      logger.error(err);
      return 1;
    }
  }

  // ── fetch the commons ──────────────────────────────────────────────────────
  let fetched: ReturnType<typeof fetchCommons>;
  try {
    fetched = fetchCommons(parseSource(sourceArg, cwd));
  } catch (err) {
    logger.error((err as Error).message);
    return 1;
  }

  try {
    let manifest: DropsManifest;
    try {
      manifest = readDropsManifest(fetched.dir);
    } catch (err) {
      logger.error((err as Error).message);
      return 1;
    }

    // ── resolve the selection ────────────────────────────────────────────────
    let effectiveSelector = selector;
    if (!effectiveSelector) {
      if (opts.nonInteractive || opts.json || !process.stdin.isTTY) {
        logger.error(
          `No selector given. Available drops: ${manifest.drops.map((d) => d.id).join(", ") || "(none)"}`,
        );
        logger.dim(`Usage: skdd add ${sourceArg} <drop-id>[/<skill>]`);
        return 1;
      }
      effectiveSelector = await select({
        message: "Pick a drop to install:",
        choices: manifest.drops.map((d) => ({
          name: `${d.id} — ${d.title} (${d.skills.length} skills)`,
          value: d.id,
        })),
      });
    }

    let selection: ReturnType<typeof resolveSelector>;
    try {
      selection = resolveSelector(manifest, effectiveSelector);
    } catch (err) {
      logger.error((err as Error).message);
      return 1;
    }

    if (opts.rename && selection.skills.length !== 1) {
      logger.error(
        `--rename applies to a single skill; the selection '${effectiveSelector}' contains ${selection.skills.length}.`,
      );
      return 1;
    }

    // ── validate every selected skill (refuse on any strict failure) ─────────
    // Manifest ids/names are grammar-checked in readDropsManifest (untrusted
    // input → no slashes/dots), and these asserts are the defense-in-depth
    // layer: no source or destination path may leave its expected root.
    const dropDir = join(fetched.dir, "packs", selection.drop.id);
    assertWithin(dropDir, join(fetched.dir, "packs"), `drop '${selection.drop.id}'`);
    let validationFailed = false;
    const parsedSkills: Array<{ sourceName: string; dir: string; description: string }> = [];
    for (const skillName of selection.skills) {
      assertWithin(join(dropDir, skillName), dropDir, `skill '${skillName}'`);
      const skillMd = join(dropDir, skillName, "SKILL.md");
      if (!existsSync(skillMd)) {
        logger.error(`${selection.drop.id}/${skillName}: SKILL.md missing in the source repo.`);
        validationFailed = true;
        continue;
      }
      try {
        const parsed = parseSkill(skillMd);
        const errors = validateSkill(parsed, { strict: true }).filter(
          (i) => i.severity === "error",
        );
        if (errors.length > 0) {
          logger.error(`${selection.drop.id}/${skillName}: fails skdd validate --strict:`);
          for (const e of errors) logger.dim(`    ${e.field ? `[${e.field}] ` : ""}${e.message}`);
          validationFailed = true;
          continue;
        }
        parsedSkills.push({
          sourceName: skillName,
          dir: join(dropDir, skillName),
          description: String(parsed.frontmatter.description ?? ""),
        });
      } catch (err) {
        logger.error(`${selection.drop.id}/${skillName}: ${(err as Error).message}`);
        validationFailed = true;
      }
    }
    if (validationFailed) {
      logger.error("Refusing to install: one or more skills failed validation.");
      return 1;
    }

    // ── collision check against the target colony ────────────────────────────
    const collisions: string[] = [];
    for (const s of parsedSkills) {
      const targetName = opts.rename ?? s.sourceName;
      if (existsSync(join(canonicalDir, targetName))) {
        collisions.push(targetName);
      }
    }
    if (collisions.length > 0) {
      for (const name of collisions) {
        logger.error(
          `Collision: '${name}' already exists in ${relative(cwd, canonicalDir) || canonicalDir}.`,
        );
      }
      logger.dim(
        collisions.length === 1 && parsedSkills.length === 1
          ? `Re-run with --rename <new-name> to install it under a different name.`
          : `Remove or rename the existing skills, or add skills one at a time with --rename.`,
      );
      return 1;
    }

    // ── dry run: report the plan and stop ────────────────────────────────────
    const planned: InstalledSkill[] = parsedSkills.map((s) => {
      const name = opts.rename ?? s.sourceName;
      return {
        name,
        sourceName: s.sourceName,
        path: join(relative(colonyRoot, canonicalDir) || canonicalDir, name, "SKILL.md"),
        provenance: provenanceLabel(fetched.source, fetched.sha, selection.drop.id),
        description: s.description,
      };
    });

    if (opts.dryRun) {
      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              dryRun: true,
              source: fetched.source.label,
              sha: fetched.sha,
              drop: selection.drop.id,
              skills: planned,
            },
            null,
            2,
          ),
        );
      } else {
        logger.heading(`skdd add — dry run`);
        logger.dim(
          `source: ${fetched.source.label}${fetched.sha ? ` @ ${fetched.sha.slice(0, 7)}` : ""}`,
        );
        logger.dim(`drop:   ${selection.drop.id} — ${selection.drop.title}`);
        console.log("");
        for (const p of planned) {
          logger.info(
            `  would install ${p.sourceName}${p.name !== p.sourceName ? ` as ${p.name}` : ""} → ${p.path}`,
          );
        }
        logger.dim("\nNo files written (--dry-run).");
      }
      return 0;
    }

    // ── install: copy, rename, register, lock ───────────────────────────────
    for (let i = 0; i < parsedSkills.length; i++) {
      const s = parsedSkills[i]!;
      const p = planned[i]!;
      const dest = join(canonicalDir, p.name);
      assertWithin(dest, canonicalDir, `install target '${p.name}'`);
      cpSync(s.dir, dest, { recursive: true });
      if (p.name !== s.sourceName) {
        rewriteSkillName(join(dest, "SKILL.md"), p.name);
      }
      addRegistryEntry(colonyRoot, {
        name: p.name,
        source: p.provenance,
        path: p.path,
        lastUsed: new Date().toISOString().slice(0, 10),
        uses: 0,
        description: p.description,
        status: "active",
      });
      upsertLockEntry(colonyRoot, p.name, {
        source: fetched.source.label,
        drop: selection.drop.id,
        sha: fetched.sha,
        addedAt: new Date().toISOString(),
      });
      if (!opts.json) logger.success(`installed ${p.name} (${p.provenance})`);
    }

    // ── refresh mirrors through the existing SAFE link path (never forced) ───
    const linkCode = opts.global
      ? await runLink({ global: true, quiet: true })
      : await runLink({ cwd, quiet: true });

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            source: fetched.source.label,
            sha: fetched.sha,
            drop: selection.drop.id,
            installed: planned,
            mirrors: linkCode === 0 ? "refreshed" : "blocked",
          },
          null,
          2,
        ),
      );
    }

    if (linkCode !== 0) {
      logger.warn(
        `Skills are installed in the canonical dir, but at least one harness mirror was NOT refreshed\n` +
          `  (a populated directory sits at the mirror path — skdd never replaces it silently).\n` +
          `  Review the paths above, then run '${opts.global ? "skdd link -g" : "skdd link"}' (add --force only if you're sure).`,
      );
      return 1;
    }

    if (!opts.json) {
      logger.success(
        `${planned.length} skill(s) added from ${fetched.source.label} — mirrors refreshed.`,
      );
    }
    return 0;
  } finally {
    fetched.cleanup();
  }
}

function detectCanonical(root: string): string | null {
  const p = join(root, ".colony.json");
  if (!existsSync(p)) return null;
  try {
    const manifest = JSON.parse(readFileSync(p, "utf8")) as { canonicalSkillsDir?: string };
    if (typeof manifest.canonicalSkillsDir === "string" && manifest.canonicalSkillsDir.length > 0) {
      return manifest.canonicalSkillsDir;
    }
  } catch {
    // malformed .colony.json is doctor's concern, not add's
  }
  return null;
}

function validateRename(name: string): string | null {
  if (name.length > NAME_MAX_LENGTH) return `--rename must be ≤${NAME_MAX_LENGTH} characters`;
  if (!NAME_REGEX.test(name)) return `--rename must be lowercase kebab-case (${NAME_REGEX})`;
  return null;
}

/** Rewrite the frontmatter `name:` line so it matches the renamed directory. */
function rewriteSkillName(skillMdPath: string, newName: string): void {
  const raw = readFileSync(skillMdPath, "utf8");
  const updated = raw.replace(/^name:\s*.+$/m, `name: ${newName}`);
  writeFileSync(skillMdPath, updated);
}
