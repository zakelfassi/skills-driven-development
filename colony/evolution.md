# Skill Evolution

> How skills improve through use — and when to let them die.

## The Evolution Cycle

```
Forge → Use → Encounter edge case → Update → Use → Encounter edge case → ...
```

Skills should never be "finished." They're living documents that improve every time an agent uses them and discovers something the skill didn't cover.

## Types of Evolution

### 1. Edge case addition
The most common evolution. An agent uses a skill and hits a case it doesn't handle:

```diff
## Edge Cases
+ - **Soft delete:** `DELETE` sets `deleted_at` timestamp, doesn't remove the row
```

### 2. Step refinement
A step is too vague or produces inconsistent results. The agent sharpens it:

```diff
## Steps
- 3. Create the test file
+ 3. Create the test file with at minimum: renders without crashing, handles empty props, snapshot test
```

### 3. Script improvement
A script fails on an edge case. The agent fixes the script and notes the change:

```diff
# scripts/scaffold.sh
+ # Handle branch names with slashes (sanitize to dashes)
+ BRANCH=$(echo "$BRANCH" | sed 's/\//-/g')
```

### 4. Skill splitting
A skill grows too large (>200 lines). Split into focused sub-skills:

```
api-endpoint/           →  api-endpoint/        (core CRUD)
                            api-endpoint-auth/   (auth middleware patterns)
                            api-endpoint-upload/  (file upload handling)
```

### 5. Skill deprecation
A skill becomes obsolete (framework change, convention shift):

```yaml
---
name: css-module-setup
description: "[DEPRECATED: migrated to Tailwind] Set up CSS modules for components."
---
```

Move to an `archived/` section in the registry.

## Evolution Signals

| Signal | Action |
|--------|--------|
| Agent uses skill successfully | Increment `usage-count`, update `last-used` |
| Agent uses skill but adds a workaround | Update skill with the workaround |
| Agent skips skill and does it differently | Review: is the skill outdated? |
| Skill unused for 90+ days | Consider archiving |
| Skill over 200 lines | Consider splitting |
| Two skills overlap significantly | Merge or differentiate |

## Tracking Evolution

The `.skills-registry.md` tracks basic usage. For deeper tracking, skills can maintain a changelog in their directory:

```
.skills/api-endpoint/
├── SKILL.md
├── CHANGELOG.md     # Optional: evolution history
└── scripts/
```

```markdown
# Changelog — api-endpoint

## 2026-02-26
- Added soft-delete edge case

## 2026-02-22
- Added file upload handling (multipart/form-data)

## 2026-02-18
- Initial forge (by codex-agent)
```

This is optional but valuable for understanding how a skill matured.

## The Decay Rule

Skills that haven't been used in 90 days and have fewer than 5 lifetime uses are candidates for archiving. This keeps the colony lean and relevant.

An archived skill isn't deleted — it's moved to the `## Archived` section in the registry. If someone needs it again, it can be revived.

## Archiving

A skill is archived, not deleted, when it falls under the decay rule, when it's superseded by a successor, or when the convention it encoded no longer applies. Archiving is cheap to undo and preserves the history that the skill once existed.

**How to archive a skill:**

1. Set `metadata.status: archived` and add `metadata.archived-reason: "<short reason>"` to the skill's frontmatter.
2. Move the row out of the registry's `## Available Skills` table into a `## Archived` table with columns `Skill | Archived | Reason`.
3. Leave the SKILL.md file in place. Do not delete the directory — other skills or colonies may still reference it by name for history.
4. If a successor exists, add `metadata.superseded-by: <new-skill-name>` so agents can redirect.

**How to revive a skill:**

1. Clear `metadata.status` (or set it to `active`).
2. Move the row back into `## Available Skills`.
3. If conventions changed, review the skill before first use and evolve it in place.

**Registry shape for archived entries:**

```markdown
## Archived

| Skill | Archived | Reason |
|-------|----------|--------|
| css-module-setup | 2026-02-22 | Migrated to Tailwind; skill no longer applies |
```

Keep the archive table ordered by most-recently-archived so recent retirements are easy to scan.
