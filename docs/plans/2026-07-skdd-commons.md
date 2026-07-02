# SkDD Commons — Build Plan (July 2026)

> **This document is an executable goal.** A fresh agent session in this repo should be able to read this file top to bottom, ingest the referenced context, and drive the work to completion without re-deriving strategy. Decisions marked **DECIDED** are settled — do not relitigate them; decisions marked **ASK ZAK** are genuinely his to make.
>
> Status: **phases 1–4 executed 2026-07-01** — launch pending the manual steps in §9 · Author: claude-fable-5, 2026-07-01 · Owner: @zakelfassi

---

## 0. Mission

Build **SkDD Commons**: a community repository of agent skills that *evolve in public*, bootstrapped with the July 2026 Frontier drop (six skills forged by Claude Fable 5 on its first day back from the export-control shutdown), wired into the `skdd` CLI with `add`/`push` verbs, and enforced-where-it-matters via opt-in hooks in the Claude Code plugin.

**The thesis (why this isn't skill-list #40):** every existing community skill collection ships static files. SkDD skills carry lifecycle metadata — `forged-by`, `forged-from`, `forged-reason`, `usage-count`, `last-used` — and an evolution model: an agent hits an edge case in the wild, appends it, ships the diff upstream. A skill that says "evolved 14 times across 9 codebases" carries a trust signal no static list can fake. The Commons' pitch is **skills that evolve in public**, distributed as curated, dated **drops**. The retention mechanism is the evolution loop, not the collection.

**Definition of done (whole plan):** a stranger can run `pnpm dlx @zakelfassi/skdd add zakelfassi/skdd-commons 2026-07-frontier` in their project and get six validated skills with provenance; edit one, run `skdd push what-would-you-cut`, and land a PR on the Commons; and a Claude Code user with the skdd plugin can opt into two hooks that enforce `finish-the-loop` and `freeze-the-session`. All of it tested, documented, and released.

---

## 1. Context to ingest first

Read these before writing any code:

| File | Why |
|------|-----|
| `README.md`, `ROADMAP.md` | project shape, tranche system, **explicit non-goals** (§2 below) |
| `packs/README.md`, `packs/fable-festival/` | the six bootstrap skills + the pack concept as currently drafted (untracked; created 2026-07-01) |
| `skillforge/SKILL.md` | the skill-authoring contract |
| `cli/src/index.ts` | all CLI commands + option conventions |
| `cli/src/commands/import.ts`, `link.ts`, `forge.ts` | patterns for colony IO, registry updates, mirror refresh |
| `cli/src/lib/fs-link.ts`, `sync-state.ts` (if present) | canonical→mirror mechanics, `.skdd-sync.json` |
| `cli/test/*.test.ts` | test style (vitest, fixtures dir) — every new command needs equivalent coverage |
| `docs/spec/colony-v1.json` | `.colony.json` manifest schema |
| `plugins/skdd-claude/` | the Claude Code plugin that will carry the hooks |
| `docs/configuration.md` | user-facing config conventions |

External reference for hook mechanics: the installed codex plugin at `~/.claude/plugins/cache/openai-codex/codex/*/hooks/hooks.json` + its `scripts/*.mjs` — the layout and opt-in-gate pattern to copy.

Origin story for the drop's README: the Fable Festival article, mirrored at `~/Code/zakelfassi.com-v3/content/posts/2026/2026-07-01-fable-festival-until-its-dark-again.mdx` (live URL: `https://zakelfassi.com/blog/2026/2026-07-01-fable-festival-until-its-dark-again`).

**Repo conventions (non-negotiable):** pnpm only; vitest for tests; biome for lint/format (`pnpm lint`, `pnpm format`); conventional commits (`feat:`/`fix:`/`docs:`/`chore:` — release-please builds the changelog from them, never hand-edit `CHANGELOG.md`); Node ≥20; no new runtime dependencies without a reason written in the PR body.

---

## 2. Standing constraints — respect the non-goals

From `ROADMAP.md`, still binding:

- **No hosted registry or server-side skill index.** Git *is* the registry. The Commons is a repo, drops are directories, the manifest is a JSON file in the repo. Nothing server-side.
- **No review gate on forging.** The Commons' PR review gates *importing untrusted third-party instructions* — a different trust boundary. Say this explicitly in the Commons README so the philosophy reads as consistent.
- **No skill-executing runtime, no semantic search, no governance theater.**

**Operational guardrail (learned 2026-07-01, do not repeat):** global harness mirror dirs (`~/.claude/skills`, `~/.codex/skills`, etc.) are often *populated regular directories* containing skills that are not in any colony. `skdd link --force` would replace them with symlinks and effectively delete those skills. Any code path that touches mirrors must keep the existing non-force-by-default behavior, and `skdd add` must reuse the existing safe link logic (copy-into-populated-dir fallback), never force-symlink.

---

## 3. Decisions

**DECIDED — Repo name:** `skdd-commons`, under `github.com/zakelfassi`. Tagline: *"Skills that evolve in public."*

**DECIDED — The drop is the unit of release.** Drop id format: `YYYY-MM-<theme>`, so the bootstrap drop is **`2026-07-frontier`**, display title **"July 2026 Frontier — the Fable Festival drop."** Dated ids sort chronologically, make "targeted releases and drops" a filesystem-level concept, and give each drop a story. Individual skills keep their own names; a skill's `metadata.pack` is its drop id.

**DECIDED — Bootstrap content:** the six fable-festival skills migrate to the Commons as `packs/2026-07-frontier/`, with `metadata.pack` updated to `2026-07-frontier` and all `forged-*` provenance preserved. The main SkDD repo keeps `packs/README.md` as the *concept* doc plus a featured index linking to the Commons; the skills themselves live in one place only (the Commons). Delete `packs/fable-festival/` from the main repo at the end of Phase 1 (it is untracked — nothing to revert in git history).

**DECIDED — Security posture:** community skills are a prompt-injection surface. CI lints every SKILL.md for dangerous instruction patterns; hits don't auto-reject, they *block merge until a maintainer applies a `security-reviewed` label*. Deny-pattern starter set: piping downloads to shells (`curl|wget … | sh/bash/zsh`), base64-decode-then-execute, writes to `~/.ssh`/shell rc files/crontabs, raw-IP or non-HTTPS URLs, credential-file reads (`.env`, keychains, `~/.aws`), and instruction-override phrases ("ignore previous instructions" and kin). Keep the list in one versioned file so PRs can extend it.

**DECIDED — Hooks scope (v1):** exactly two, both **off by default**, shipped in `plugins/skdd-claude`:
1. `finish-the-loop` → **Stop** gate (bounce unverified-claim reports once).
2. `freeze-the-session` → **SessionEnd + PreCompact** reminder (surface unfrozen session learnings before context dies).
`attack-the-plan` as a plan-approval gate is explicitly deferred (nag risk); `reframe-to-problem`, `what-would-you-cut`, `staff-the-swarm` stay skills-only (detection would need an LLM call per user prompt — wrong trade).

**DECIDED — `skdd push` strips machine-local state:** `usage-count` resets to `"0"` and `last-used` is dropped on push; `forged-*` provenance travels. Usage stats are colony-local truth, not global truth.

**ASK ZAK (before Phase 1 lands):**
- GitHub repo visibility timing — create public immediately, or private until the drop README + CI are in place? (Recommend: private, flip public with the launch commit.)
- License for the Commons — MIT like the main repo, or CC0 for maximal skill reuse? (Recommend: MIT for consistency.)
- npm publishing of drops (`@skdd/drop-2026-07-frontier`) — defer entirely? (Recommend: defer; git transport is enough for v1.)

---

## 4. Phase 1 — The Commons repo

**Goal:** `github.com/zakelfassi/skdd-commons` exists, validated, bootstrapped with the `2026-07-frontier` drop, CI green.

### 4.1 Layout

```
skdd-commons/
├── README.md              # thesis, drop index, install, evolution loop, security posture
├── LICENSE
├── CONTRIBUTING.md        # how to push a skill, how to evolve one, metadata requirements
├── SECURITY.md            # the injection-surface argument + lint policy + reporting
├── CODEOWNERS             # @zakelfassi owns packs/** initially
├── drops.json             # machine-readable drop manifest (CLI consumes this)
├── packs/
│   └── 2026-07-frontier/
│       ├── README.md      # drop story: the article, the shutdown, the six practices
│       ├── reframe-to-problem/SKILL.md
│       ├── attack-the-plan/SKILL.md
│       ├── what-would-you-cut/SKILL.md
│       ├── finish-the-loop/SKILL.md
│       ├── staff-the-swarm/SKILL.md
│       └── freeze-the-session/SKILL.md
├── .github/
│   ├── workflows/ci.yml           # validate + safety-lint + manifest-check
│   ├── PULL_REQUEST_TEMPLATE/
│   │   ├── new-skill.md           # requires: forged-reason, when-to-use, drop target
│   │   └── evolve-skill.md        # requires: the edge case encountered, before/after behavior
│   └── ISSUE_TEMPLATE/…
└── scripts/
    └── safety-lint.mjs            # deny-pattern scan (patterns in scripts/deny-patterns.json)
```

### 4.2 `drops.json` manifest (CLI contract)

```json
{
  "version": 1,
  "drops": [
    {
      "id": "2026-07-frontier",
      "title": "July 2026 Frontier — the Fable Festival drop",
      "date": "2026-07-01",
      "skills": ["reframe-to-problem", "attack-the-plan", "what-would-you-cut",
                 "finish-the-loop", "staff-the-swarm", "freeze-the-session"],
      "story": "https://zakelfassi.com/blog/2026/2026-07-01-fable-festival-until-its-dark-again",
      "forgedBy": "claude-fable-5"
    }
  ]
}
```

CI's manifest-check job asserts `drops.json` and `packs/` agree (every listed skill exists and validates; every pack dir is listed).

### 4.3 CI (`ci.yml`)

Three jobs on every PR: **validate** (`pnpm dlx @zakelfassi/skdd validate packs --strict`), **safety-lint** (`node scripts/safety-lint.mjs packs` — exit 1 on any hit unless the PR carries the `security-reviewed` label; implement the label check in the workflow, not the script), **manifest-check**. Keep total runtime under a minute; contributors should never wait on CI to iterate.

### 4.4 Migration of the six skills

Copy from this repo's `packs/fable-festival/`, then per skill: set `metadata.pack: 2026-07-frontier`, reset `usage-count: "0"`, drop `last-used` (Commons copies are templates, not usage records). The drop README adapts `packs/fable-festival/README.md` but leads with the drop framing: dated, themed, forged-by-a-frontier-model-on-day-one, link to the article. Do **not** modify the copies installed in `~/.skdd/skills/` on this machine — that's Zak's live colony.

### 4.5 Acceptance (Phase 1)

- [x] Repo exists with the full layout; `git clone` + CI green on main
- [x] All six skills pass `skdd validate --strict` in CI
- [x] Safety lint catches a planted bad fixture in a test PR (prove the gate works before trusting it)
- [x] README states the thesis, the security posture, and the no-hosted-registry philosophy in ≤2 screens

---

## 5. Phase 2 — CLI verbs (`add`, `push`, provenance)

**Goal:** the Commons is reachable from the CLI in both directions. This phase lives in `cli/` of this repo and ships as a feature release of `@zakelfassi/skdd`.

### 5.1 `skdd add <source> [selector]`

- **Source forms:** GitHub shorthand `owner/repo`, full git URL, or local path; optional `#ref` (branch/tag/sha).
- **Selector:** a drop id (`2026-07-frontier`), a skill within a drop (`2026-07-frontier/what-would-you-cut`), or omitted → interactive pick from `drops.json` (reuse the ink hub components if cheap, plain `@inquirer/prompts` otherwise).
- **Behavior:** shallow-clone to a temp dir → read `drops.json` → resolve selection → `validate --strict` each skill (refuse on failure) → **collision check** against the target colony (refuse with a clear message; `--rename <new-name>` to resolve) → copy into canonical skills dir (project, or `-g` for global) → registry row per skill with provenance → refresh mirrors via the existing safe link path.
- **Registry provenance:** formalize the Source column as `local` | `global` | `<owner>/<repo>@<shortsha> (<drop-id>)`. Also record the full sha in `.skdd-sync.json` (or a new `.skdd-lock.json` if sync-state doesn't fit) so `skdd doctor` can later detect upstream drift.
- **Flags:** `-g`, `--rename`, `--dry-run`, `--json`.

### 5.2 `skdd push <skill|pack> [--to owner/repo]`

- **Prereq:** `gh` CLI authenticated; default target repo configurable (`~/.skdd/config.toml` key `commons = "zakelfassi/skdd-commons"` — smol-toml is already a dependency). Fail with an actionable message if `gh` is missing.
- **Behavior:** locate skill in colony → strip machine-local metadata (per §3) → fork-or-reuse fork via `gh` → branch `skill/<name>` (new) or `evolve/<name>` (upstream exists) → copy → open PR with body auto-filled from metadata: `forged-reason` becomes "Why this skill", description becomes the summary, and for evolutions include the diff summary. `--dry-run` prints the would-be PR without network writes.
- **New skills need a drop:** `--drop <id>` targets an existing drop; absent, the PR template's "proposed drop" section is left for maintainer triage. Creating drops is a maintainer act, not a push flag.

### 5.3 Discovery surface

- `skdd drops [--from owner/repo]` — list drops from a Commons' `drops.json` (table: id, title, date, skill count, story link). Default `--from` is the configured commons.
- `skdd list` gains the provenance-aware Source column (it mostly has one — verify rendering with long values).
- Hub: add a "Commons" pane listing drops with an install action. **Stretch — only after add/push/drops are tested and shipped.**

### 5.4 Acceptance (Phase 2)

- [x] Unit tests per command in `cli/test/` (fixtures: a mini commons repo checked into `cli/test/fixtures/`) — cover happy path, validation failure, collision, dirty-mirror safety, `--dry-run`
- [x] `add` never force-replaces a populated mirror dir (regression test for the §2 guardrail)
- [x] Round-trip e2e (manual or scripted): `init` a scratch colony → `add` the frontier drop → edit a skill → `push --dry-run` produces a correct PR body
- [x] `pnpm typecheck && pnpm lint && pnpm test` green; conventional-commit history; release-please cuts a minor version *(release-please runs on merge)*

---

## 6. Phase 3 — Hooks in `plugins/skdd-claude`

**Goal:** the two enforcement hooks ship in the existing Claude Code plugin, opt-in, copied structurally from the codex plugin's gate.

### 6.1 Layout

```
plugins/skdd-claude/
├── hooks/hooks.json        # Stop + SessionEnd + PreCompact entries, node scripts, timeouts ≤15s
├── scripts/
│   ├── finish-loop-gate.mjs
│   ├── freeze-reminder.mjs
│   └── lib/state.mjs       # per-session state in $TMPDIR, plus the on/off toggle read
└── commands/skdd-hooks.md  # /skdd:hooks — toggles gates on/off (writes .claude/skdd.local.md)
```

### 6.2 Behavior specs

**`finish-loop-gate.mjs` (Stop):** activate only when (a) toggle is on, (b) `git diff` since session start touches non-test product source, (c) the final assistant message contains unverified-claim language (`should work`, `should now`, `likely fixed`, `probably resolves` …) *without* evidence markers (`verified`, `observed`, `screenshot`, `watched it`, test output). On trigger: emit the Stop-hook block decision with reason "finish-the-loop: report claims success without observed evidence — drive the change and attach what you saw, or state plainly that it is unverified." **Block at most once per session** (state file) — the codex gate's anti-loop pattern; a second Stop always passes.

**`freeze-reminder.mjs` (SessionEnd + PreCompact):** if toggle on and the session looks substantive (heuristic: >N tool-use turns or a nontrivial diff) and the colony registry's mtime predates session start, emit a non-blocking reminder: "freeze-the-session: this session may hold unfrozen learnings — skills, conventions, checklists. Registry untouched since start." PreCompact matters most: freeze before the context dies. No LLM calls in v1 — deterministic heuristics only, and stay silent when unsure (a chatty hook gets disabled forever).

### 6.3 Acceptance (Phase 3)

- [x] Both hooks inert by default; `/skdd:hooks on` activates, `off` deactivates, state survives sessions
- [x] Gate blocks exactly once on a planted "should work" report, passes on evidence-bearing reports, never fires on docs-only diffs
- [x] Scripts have no dependencies beyond node ≥20 built-ins; each exits <2s in the common (inactive) path
- [x] Plugin README documents both hooks, the philosophy line ("a skill is a procedure the model follows when it decides to; a hook is a gate for when it forgets"), and the toggle

---

## 7. Phase 4 — Integration, docs, launch

- **Main repo README:** a "Commons" section — thesis paragraph, `skdd add` one-liner, link to the repo and the current drop. `packs/README.md` becomes concept-doc + featured-drop index (no local skills).
- **Docs site (`site/`):** pages for Commons + drops + push flow; wire into the existing Starlight scaffold if it's live, else plain `docs/*.md` and leave site wiring to the existing roadmap item.
- **ROADMAP.md:** add the Commons tranche as shipped-in-progress; move this plan's phases into the tranche table. Mark deferred items (hub pane, npm drops, attack-the-plan gate, `skdd update` three-way evolution merge) under a new "Commons v2" heading — `skdd update` is the highest-value v2 item because a local/upstream divergence *is a PR waiting to be pushed*.
- **Launch checklist:** flip repo public → tag drop `2026-07-frontier` as a GitHub Release (drops are releases — this is the "targeted drops" mechanism Zak wants) → cross-link from the Fable Festival article's repo mirror if Zak wants a postscript → submit to the marketplace list already in ROADMAP (SkillsMP, skills.sh, ClawHub, LobeHub) → announcement copy drafted for Zak's review, not auto-posted.

---

## 8. Sequencing & working agreements

1. One PR per phase against this repo (`feat(cli): skdd add/push …`, `feat(plugin): enforcement hooks …`, `docs: commons integration`); the Commons repo itself is built directly on its own `main` until public.
2. Phase 1 → 2 → 3 → 4 strictly: the CLI needs the Commons to exist for fixtures; hooks are independent of 2 but land after so the plugin release note can mention `add`.
3. Verify each phase's acceptance boxes before starting the next; check them off *in this file* as you go, and append a dated log line under §9.
4. Anything requiring Zak's GitHub settings UI or credentials (repo creation can use `gh repo create`; secrets, branch protection, marketplace submissions cannot) goes on a "manual steps" list appended to §9 rather than blocking.
5. Do not touch `~/.skdd/` or any `~/.claude/skills` content on this machine except via the tested CLI paths — that's the maintainer's live colony, not a fixture.

---

## 9. Execution log

*(Append dated entries here as phases complete. Manual steps for Zak accumulate here too.)*

- 2026-07-01 — Plan authored (claude-fable-5). Bootstrap skills exist untracked at `packs/fable-festival/`; installed to the global colony the same day.
- 2026-07-01 — **Stop-gate follow-up fix #3** (claude-fable-5, flagged by the Codex stop-time review): the baseline-by-path fix over-corrected — a file already dirty at SessionStart sat in the baseline set, so a further *edit* to it during the session was missed. Now SessionStart hashes every dirty file and `sessionChangedPaths` content-compares: newly-dirty files and edits to pre-dirty files both count, while pre-dirty files left untouched are ignored. Both finish-loop and freeze use it. +1 regression test (session edits a pre-dirty product file → blocks); 933 total green.
- 2026-07-01 — **Adversarial-review comment sweep** (claude-fable-5, addressing the Codex bot's inline PR comments on #8/#9). CLI: add/push honor `.colony.json` canonicalSkillsDir; reject symlinks in a fetched Commons skill tree (matching push); registry cells escape pipes/newlines + parser unescapes (no table-row injection from untrusted descriptions); push strips machine-local metadata in the frontmatter only, validates each skill `--strict` before opening a PR, distinguishes an empty diff from a real commit failure (hints at missing git identity), validates pack ids as git-ref-safe, clears the upstream dir before an evolve copy; `parseSource` splits `#ref` before local detection and local `#ref` checks out from a clean clone; dirty local sources get a `-dirty` provenance marker; malformed `config.toml` surfaces; extracted `lib/colony.ts`. Hooks: finish-loop measures product changes against the SessionStart baseline (ignores pre-dirty files), recognizes suffix-style test names (`*_test.go`), fails open when the anti-loop flag can't persist, reads the toggle by searching upward (subdir support); freeze counts untracked files + commits-since-start, recognizes `.skills-registry.json`, never invents a start time; SessionStart resets per-run state so resumes don't inherit stale flags. +29 tests; 932 total green; lint/typecheck/build clean. Both PR #10 comments (docs sync) were already resolved; the #8 P1 (manifest path traversal) was fixed in the prior security pass.
- 2026-07-01 — **Stop-gate follow-up fix #2** (claude-fable-5, flagged by the Codex stop-time review): the symlink guard lived in the items loop, but pack discovery called `parseSkill` (→ `readFileSync`, follows symlinks) *before* it — so a pack push dereferenced a symlinked skill during scanning. Extracted `skillDirIsSymlinked` and now check at discovery time: direct pushes refuse, pack scans skip+warn, and the items-loop check stays as defense-in-depth. `statSync`→symlink-aware guard added. +1 test (symlinked skill excluded from a pack push, target never read); 902 total green; verified live — a symlinked SKILL.md claiming the pack is skipped and its secret never read.
- 2026-07-01 — **Stop-gate follow-up fix** (claude-fable-5, flagged by the Codex stop-time review): `skdd push` read `SKILL.md` with `readFileSync`, which follows symlinks — a symlinked skill dir or SKILL.md could still exfiltrate arbitrary files (ssh keys, /etc/passwd) into a PR despite the payload allowlist. Push now `lstat`s both and refuses symlinks outright; `collectPublishablePayload` throws defensively. +2 tests (symlinked SKILL.md, symlinked skill dir); 901 total green; verified live — a SKILL.md symlinked at a secret file is refused with no content leaked.
- 2026-07-01 — **Adversarial review fixes** (claude-fable-5, after a Codex adversarial review of the branch diff). Two findings fixed on `feat/commons-cli`: **[high]** `drops.json` is now treated as hostile input — drop ids and skill names are grammar-checked (lowercase kebab-case, no slashes/`..`/absolute paths) at every parse site (`readDropsManifest`, push's local+remote upstream readers), with defense-in-depth `assertWithin` containment asserts on all source/destination paths in `add`; a malicious manifest can no longer write outside `skills/`. **[medium]** `skdd push` no longer copies the whole skill directory — only an allowlisted payload travels (`SKILL.md` + regular files under `scripts/`, `references/`, `assets/`); dotfiles, symlinks, and strays stay home, and `--dry-run` enumerates travels/stays-home per file. +5 adversarial tests (hostile manifests with `../`, absolute paths, unsafe drop ids; payload allowlist incl. symlink/`.env` exclusion); 899 total green; verified live against a hostile fixture and a real `.env` plant.
- 2026-07-01 — **Phase 4 complete** (claude-fable-5, branch `docs/commons-integration`). Main README gained the Commons section (thesis, `skdd add` one-liner, drop link); `docs/commons.md` written and mirrored into the Starlight site with a "Commons" sidebar group; ROADMAP gained the Commons tranche (🚧 shipped, launch pending) + a "Commons v2" deferred list (`skdd update` three-way merge flagged highest-value); announcement copy drafted at `docs/plans/2026-07-commons-announcement.md` (short X version + long blog version, NOT posted). GitHub Release `2026-07-frontier` tagged on the (still-private) Commons — drops are releases; it goes public with the repo.
- 2026-07-01 — **Manual steps for Zak (launch checklist, in order):**
  1. **Merge PR [#8](https://github.com/zakelfassi/skills-driven-development/pull/8)** (Phase 2, CI green), then **[#9](https://github.com/zakelfassi/skills-driven-development/pull/9)** (Phase 3, stacked — retargets to main and runs CI on merge of #8), then **#10** (Phase 4 docs). The agent's classifier rightly refuses self-merging its own PRs. Then merge the release-please PR it opens → publish workflow cuts `@zakelfassi/skdd` 1.1.0 to npm (needs `NPM_TOKEN` secret to be valid).
  2. **Flip `skdd-commons` public**: `gh repo edit zakelfassi/skdd-commons --visibility public` (or Settings UI). The `2026-07-frontier` Release, README, CI, and gate-proof PR #1 history are already in place.
  3. **Verify the stranger flow** once public + npm 1.1.0 is live: `pnpm dlx @zakelfassi/skdd add zakelfassi/skdd-commons 2026-07-frontier` from a machine without your credentials.
  4. **Branch protection on `skdd-commons` main** (Settings → Branches): require the three CI checks; keep the `security-reviewed` label bypass semantics.
  5. **Marketplace submissions** (SkillsMP, skills.sh, ClawHub, LobeHub — the ROADMAP P4 list) — needs your accounts.
  6. **Review + post the announcement** (`docs/plans/2026-07-commons-announcement.md`); optional postscript cross-link from the Fable Festival article repo mirror.
  7. **ASK-ZAK defaults taken** (revisit if you disagree): Commons private-until-launch ✔ · MIT license ✔ · npm drops deferred ✔.
- 2026-07-01 — **Phase 3 complete** (claude-fable-5). Two opt-in hooks shipped in `plugins/skdd-claude` v0.3.0 (branch `feat/plugin-hooks`): `finish-loop-gate.mjs` (Stop; blocks once per session on unverified-claim reports over non-test product diffs, anti-loop state in `$TMPDIR`), `freeze-reminder.mjs` (SessionEnd + PreCompact; non-blocking `systemMessage` when a substantive session ends with the registry untouched), `session-start.mjs` (seeds session-start timestamp), `lib/state.mjs` (state + toggle reads). Toggles live in `.claude/skdd.local.md` via the `/skdd-claude:skdd-hooks` command; both gates OFF by default. 11 end-to-end tests in `cli/test/plugin-hooks.test.ts` spawn the real scripts (block-once, evidence pass, docs-only/test-only silence, registry-mtime logic, <2s inactive path). No deps beyond node built-ins. Deviation from §6.1 noted: a small `session-start.mjs` + SessionStart hook entry was added so "since session start" comparisons are real — same lifecycle pattern as the codex plugin.
- 2026-07-01 — **Phase 2 complete** (claude-fable-5). `skdd add` / `skdd push` / `skdd drops` shipped in `cli/` (branch `feat/commons-cli`). New libs: `commons.ts` (source parsing + shallow clone + drops.json), `lock.ts` (`.skdd-lock.json`, full sha for future drift detection), `config.ts` (`~/.skdd/config.toml`, `commons` key, default `zakelfassi/skdd-commons`). 24 new tests (add/push/drops) + mini-commons fixtures; 894 total green; typecheck + lint green. Design note: new skills pushed without `--drop` land in the Commons' `incoming/` staging dir (added to the Commons + its CI same day) — drops stay maintainer-curated. Push against a **local path** target supports `--dry-run` only (test seam); real PRs need `gh`. Round-trip e2e ran against the real private repo: `init → add zakelfassi/skdd-commons 2026-07-frontier` (6 skills, provenance `@12ba029`) `→ edit → push --dry-run` produced the correct evolve-branch PR body with diff summary; populated-mirror guardrail covered by a regression test.
- 2026-07-01 — **Phase 1 complete** (claude-fable-5). `zakelfassi/skdd-commons` created **private** (ASK-ZAK default taken: private until launch commit), **MIT license** (default taken: consistency with main repo), **npm drops deferred** (default taken: git transport only for v1). Full layout + `2026-07-frontier` drop (six skills, `metadata.pack` updated, `usage-count` reset, `last-used` dropped). CI green on main (run 28552710128: validate --strict / safety-lint / manifest-check, ~22s total). Gate proven on PR #1: safety-lint failed on a planted pipe-to-shell + credential-read fixture (run 28552744808), passed after `security-reviewed` label applied (run 28552805972); PR closed unmerged, branch deleted. `packs/fable-festival/` deleted from this repo; `packs/README.md` now concept doc + featured-drop index.
