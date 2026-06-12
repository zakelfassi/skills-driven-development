#!/usr/bin/env bash
# release-cut.sh — illustrative script for the release-cut skill
#
# This is a teaching stub. It prints what a real release-cut step WOULD do,
# so the example is self-consistent (the skill references this path) without
# assuming a real Rust/Go project or CI environment.
#
# Replace this with your actual release automation (cargo-release, goreleaser,
# a custom script calling gh + git, etc.) when you fork this skill into a real
# project.

set -euo pipefail

DRY_RUN=false
CHANGELOG_ONLY=false
VERSION=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --changelog-only) CHANGELOG_ONLY=true ;;
    v*) VERSION="$arg" ;;
    [0-9]*) VERSION="v$arg" ;;
  esac
done

VERSION="${VERSION:-v0.0.0-example}"
PREV_TAG="$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"
NOW="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo 'now')"

if [ "$CHANGELOG_ONLY" = true ]; then
  cat <<EOF
[release-cut] --changelog-only mode
[release-cut] would generate CHANGELOG.md entries from commits since ${PREV_TAG}:

  ## ${VERSION} (${NOW})

  ### Added
  - feat: placeholder entry from conventional commits
  ### Fixed
  - fix: placeholder entry from conventional commits

[release-cut] (stub) — no real changelog generated.
EOF
  exit 0
fi

cat <<EOF
[release-cut] shipctl release plan
[release-cut] ─────────────────────────────────────────────
[release-cut] version:      ${VERSION}
[release-cut] previous tag: ${PREV_TAG}
[release-cut] branch:       ${BRANCH}
[release-cut] timestamp:    ${NOW}
[release-cut] dry-run:      ${DRY_RUN}
[release-cut] ─────────────────────────────────────────────

[release-cut] step 1 — verify working tree is clean
[release-cut] step 2 — run: cargo test --workspace
[release-cut] step 3 — invoke breaking-change-audit skill
[release-cut] step 4 — bump version to ${VERSION} in Cargo.toml
[release-cut] step 5 — generate CHANGELOG.md from commits since ${PREV_TAG}
[release-cut] step 6 — create and push tag: ${VERSION}
[release-cut] step 7 — wait for CI cross-compile matrix
[release-cut] step 8 — gh release create ${VERSION} --draft
[release-cut] step 9 — publish release and announce

[release-cut] (stub) — no real release performed.
EOF
