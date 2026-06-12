---
name: breaking-change-audit
description: Audit shipctl's public interface before a release — compare flags, exit codes, and output formats against the previous tag to catch accidental breaking changes. Use when preparing a release, when asked to "check for breaking changes", or as a gate before tagging a new version.
metadata:
  forged-by: claude-agent
  forged-from: session-2026-05-01
  forged-reason: "v0.8.0 silently removed --json alias used by 3 downstream scripts; discovered post-publish. Forged this skill to run before every tag."
  usage-count: "5"
  last-used: "2026-05-29"
---

# Breaking-Change Audit

Compare the current public interface against the previous release tag to surface accidental breaking changes before publishing.

## Inputs
- Previous tag (defaults to the most recent git tag: `git describe --tags --abbrev=0`)
- Current version (defaults to HEAD)
- Scope: `flags` | `exit-codes` | `output-format` | `all` (default)

## Steps

1. **Build both versions**
   ```bash
   # Build HEAD
   cargo build --release
   cp target/release/shipctl /tmp/shipctl-next

   # Build the previous tag
   git stash
   git checkout {prev-tag}
   cargo build --release
   cp target/release/shipctl /tmp/shipctl-prev
   git checkout -
   git stash pop
   ```

2. **Diff public flags**
   Capture help output for every command and subcommand:
   ```bash
   /tmp/shipctl-prev --help > /tmp/flags-prev.txt
   /tmp/shipctl-prev release --help >> /tmp/flags-prev.txt
   # ... repeat for all subcommands

   /tmp/shipctl-next --help > /tmp/flags-next.txt
   /tmp/shipctl-next release --help >> /tmp/flags-next.txt

   diff /tmp/flags-prev.txt /tmp/flags-next.txt
   ```
   Lines prefixed with `-` in the diff represent removed flags or changed defaults.

3. **Check exit codes**
   Run a battery of known invocations and compare exit codes:
   ```bash
   # Example: unknown flag should exit 2
   /tmp/shipctl-prev --unknown-flag 2>&1; echo "prev exit: $?"
   /tmp/shipctl-next --unknown-flag 2>&1; echo "next exit: $?"
   ```
   Document any changes; a changed exit code for a common error case is a breaking change.

4. **Check output format** (JSON / machine-readable outputs)
   ```bash
   /tmp/shipctl-prev release --dry-run --json > /tmp/out-prev.json
   /tmp/shipctl-next release --dry-run --json > /tmp/out-next.json
   diff /tmp/out-prev.json /tmp/out-next.json
   ```
   Removed JSON keys, renamed fields, or type changes are breaking.

5. **Classify findings**
   | Type | Breaking? | Action |
   |------|-----------|--------|
   | New flag added | No | Note in changelog under Added |
   | Flag removed | **Yes** | Requires `BREAKING CHANGE:` in commit |
   | Flag renamed | **Yes** | Requires `BREAKING CHANGE:`; add alias for one release cycle |
   | Default changed | **Yes** | Requires `BREAKING CHANGE:` |
   | Exit code changed | **Yes** | Requires `BREAKING CHANGE:` |
   | New JSON key added | No | Note under Added |
   | JSON key removed/renamed | **Yes** | Requires `BREAKING CHANGE:` |

6. **Decide**
   - If no breaking changes: proceed with the release.
   - If breaking changes are intentional: bump the major version; add `BREAKING CHANGE:` to the commit footer; document a migration path in the changelog.
   - If breaking changes are accidental: revert or fix before cutting the release.

## Conventions
- This audit runs before every `release-cut` invocation (step 3 in that skill)
- Breaking changes require a major version bump per semver
- A one-release deprecation alias is preferred over immediate removal
- All findings are appended to `AUDIT.md` for record-keeping

## Edge Cases
- **Previous tag doesn't build:** Note the failure, skip that check, document in the audit log that the previous baseline was unavailable.
- **Subcommand added:** New subcommands are non-breaking; still document under Added.
- **Output format is not machine-readable:** Treat human-readable output changes as non-breaking unless documented otherwise.
- **Environment-dependent output:** Use `--dry-run` or a controlled fixture to get deterministic output for diff.
