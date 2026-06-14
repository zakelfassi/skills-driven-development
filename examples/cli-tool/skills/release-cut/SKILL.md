---
name: release-cut
description: Cut a versioned release for shipctl — bump the version, generate a changelog from conventional commits, create and push the git tag, and draft a GitHub release with cross-compiled binaries attached. Use when preparing a new release, when asked to "cut a release", or when the version needs bumping after a sprint.
metadata:
  forged-by: codex-agent
  forged-from: session-2026-03-04
  forged-reason: "Ran the same 8-step release sequence manually for v0.5.0, v0.6.0, and v0.7.0 — time to encode it"
  usage-count: "14"
  last-used: "2026-05-30"
---

# Release Cut

Bump the version, generate a changelog, tag, and publish a GitHub release for `shipctl`.

## Inputs
- Target version (semver, e.g. `1.2.0` or `patch`/`minor`/`major`)
- Release channel (defaults to `stable`; `pre` for release candidates)
- Skip binary attach? (boolean, defaults to `false`)

## Steps

1. **Verify the working tree is clean**
   ```bash
   git status --porcelain
   ```
   If dirty, commit or stash before proceeding.

2. **Run the full test suite**
   ```bash
   cargo test --workspace
   ```
   Abort if any test fails.

3. **Run the breaking-change audit** (invoke the `breaking-change-audit` skill)
   Confirms no accidental public-interface regressions before tagging.

4. **Bump the version**
   ```bash
   # For Rust:
   cargo set-version {version}   # or edit Cargo.toml manually
   # For Go:
   # Update version constant in cmd/root.go
   ```
   Commit the version bump:
   ```bash
   git commit -am "chore(release): bump version to {version}"
   ```

5. **Generate the changelog**
   ```bash
   scripts/release-cut.sh --changelog-only {version}
   ```
   Review `CHANGELOG.md` — edit entries if the generated text is unclear.
   Commit: `git commit -am "docs(changelog): {version} release notes"`

6. **Create and push the tag**
   ```bash
   git tag -a "v{version}" -m "Release v{version}"
   git push origin "v{version}"
   ```

7. **Trigger cross-compile and attach binaries**
   The CI matrix builds all registered target triples (see `cross-compile-matrix` skill).
   Wait for the `release` workflow to complete:
   ```bash
   gh run watch --exit-status
   ```

8. **Draft the GitHub release**
   ```bash
   gh release create "v{version}" \
     --title "v{version}" \
     --notes-file CHANGELOG.md \
     --draft
   ```
   Review the draft, then publish:
   ```bash
   gh release edit "v{version}" --draft=false
   ```

9. **Announce** (if applicable)
   Post in the team channel: title, key changes, install command:
   ```
   cargo install shipctl --version {version}
   ```

## Conventions
- Version tags always use the `v` prefix: `v1.2.0`, not `1.2.0`
- Changelog entries follow the Keep a Changelog format (Added / Changed / Deprecated / Removed / Fixed / Security)
- Release candidates are tagged `v1.2.0-rc.1`
- Binary naming: `shipctl-{version}-{target}.tar.gz`
- Dry-run: `scripts/release-cut.sh --dry-run {version}` prints the plan without side effects

## Edge Cases
- **Tag already exists:** Delete the local tag, investigate what was released, never force-push a tag that CI has already processed.
- **Changelog is empty:** Check that commits follow conventional format (`feat:`, `fix:`, etc.); if the log is legitimately empty, write a manual entry.
- **Binary attach fails:** Re-run `gh release upload "v{version}" dist/*.tar.gz`; check that the CI artifact paths match what the release workflow uploads.
- **Yanked release:** Use `gh release delete "v{version}"` + `git push origin --delete "v{version}"`; never publish a replacement under the same tag.
