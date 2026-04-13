# SchemaStore.org submission — `.colony.json`

This document is the draft pull request body for submitting SkDD's `.colony.json` JSON Schema to [SchemaStore.org](https://www.schemastore.org/json/), the catalog VS Code and JetBrains IDEs consult for automatic IntelliSense on well-known config files.

Once merged, every `.colony.json` file across every SkDD-adopting project gets live validation and autocomplete — no extension install required.

## Why it matters

- **Discovery**: SkDD becomes the spec curator for "colony manifests," positioning `.colony.json` as a first-class citizen alongside `package.json`, `tsconfig.json`, `.eslintrc`, etc.
- **Adoption friction drops**: contributors writing or reviewing a colony file get inline errors for missing fields, wrong enum values, or invalid version strings without having to remember schema semantics.
- **Low ongoing cost**: SchemaStore fetches the schema from a stable URL we already maintain. Schema bumps just update the URL once, not each client.

## Prerequisites (check before opening the PR)

- [ ] The schema at `docs/spec/colony-v1.json` is published at a **stable, versioned raw URL** (GitHub raw is acceptable but we should link a tagged ref, not `main`, so a breaking edit can't silently regress every IDE in the world).
- [ ] The schema validates an example `.colony.json` cleanly — run `npx ajv validate -s docs/spec/colony-v1.json -d .colony.json` locally.
- [ ] No trailing whitespace or mixed indentation in the schema file (SchemaStore's CI runs prettier).
- [ ] The `$id` in the schema matches the submitted URL.

## Target repository

[SchemaStore/schemastore](https://github.com/SchemaStore/schemastore)

The file to edit is `src/api/json/catalog.json` — adding a single object to the `schemas` array.

## Catalog entry to add

```json
{
  "name": "SkDD Colony Manifest",
  "description": "Manifest for a Skills-Driven Development (SkDD) colony — a discoverable collection of Agent Skills (agentskills.io/v1) with a canonical skills directory, harness mirrors, CLI pointer, and optional plugin wrappers.",
  "fileMatch": [".colony.json"],
  "url": "https://raw.githubusercontent.com/zakelfassi/skills-driven-development/v0.3.0/docs/spec/colony-v1.json"
}
```

> Replace the URL with a tagged raw URL once v0.3.0 (or whichever release ships the schema) is tagged. Before tagging, we can use `main` for local dev but **must** switch to a tag for the PR.

## Draft PR title

```
Add SkDD Colony Manifest (.colony.json)
```

## Draft PR body

```markdown
## What this adds

A catalog entry for `.colony.json`, the manifest file used by [Skills-Driven Development](https://github.com/zakelfassi/skills-driven-development) (SkDD). A colony manifest declares the canonical skills directory, harness mirrors, CLI pointer, and optional plugin wrappers for a set of Agent Skills that follow the [agentskills.io/v1](https://agentskills.io/specification.md) spec.

## Why

`.colony.json` is the entry point marketplaces (SkillsMP, Skills.sh, ClawHub, LobeHub) and custom indexers use to discover and index a SkDD colony. Authors currently have no IntelliSense while editing it — this PR closes that gap for every VS Code and JetBrains user globally.

## Schema URL stability

The schema is published under the [skills-driven-development](https://github.com/zakelfassi/skills-driven-development) repo at `docs/spec/colony-v1.json`. The submitted URL targets a tagged release (`v0.3.0`), so edits to `main` can't silently regress existing clients. Major schema changes will ship as `colony-v2.json` at a new URL and be added as a separate catalog entry.

## Example files

Valid: <https://github.com/zakelfassi/skills-driven-development/blob/v0.3.0/.colony.json>

## Validation

- `ajv validate -s docs/spec/colony-v1.json -d .colony.json` on the seed repo → passes
- The schema is draft-07 (matches SchemaStore conventions)
- All required fields have `description` + appropriate constraints

## Checklist

- [x] `fileMatch` is unambiguous (`.colony.json` is SkDD-specific; no known collisions)
- [x] `url` points at a tagged release, not `main` or a branch
- [x] Schema is draft-07 and validates its own example
- [x] `name` and `description` fit the SchemaStore style (short, non-redundant)
```

## Next steps after SchemaStore PR is merged

1. **Verify end-to-end**: open a `.colony.json` in a fresh VS Code window → autocomplete appears for `spec`, `canonicalSkillsDir`, `harnessMirrors`, etc.
2. **Add a badge to the SkDD README**: "Validated by SchemaStore" → links to the catalog entry.
3. **Document in `docs/configuration.md`**: "Your editor should give you IntelliSense on `.colony.json` automatically — no extension required."
4. **Propose the same flow upstream**: once `.colony.json` lands, nominate the Agent Skills `SKILL.md` frontmatter for a similar treatment. SchemaStore currently has no entry for `SKILL.md` frontmatter; SkDD can shepherd that one too.

## Non-goals for this submission

- **Don't submit both colony-v1 and colony-v2**. One schema at a time. Future major versions go through the same process under a new URL.
- **Don't embed SkDD-specific extensions in the canonical schema**. Lifecycle metadata (`forged-by`, `usage-count`, etc.) stays under the `metadata` passthrough so the schema stays spec-aligned; SkDD's extension profile is a separate concern (P4.4 in the plan).
- **Don't block CI on SchemaStore state**. Our validation is authoritative via `skdd validate`; SchemaStore is an ergonomic layer on top, not a gate.
