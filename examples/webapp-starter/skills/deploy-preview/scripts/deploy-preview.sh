#!/usr/bin/env bash
# deploy-preview.sh — illustrative script for the deploy-preview skill
#
# This is a teaching stub. It prints what a real deploy step WOULD do, so
# the example is self-consistent (the skill references this path) without
# assuming a real deploy target.
#
# Replace this with your actual deploy command (Vercel, Netlify, fly.io,
# Cloudflare Pages, a homegrown Ansible playbook, etc.) when you fork this
# skill into a real project.

set -euo pipefail

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)}"
# Sanitize slashes per the skill's documented convention.
SAFE_BRANCH="${BRANCH//\//-}"
PREVIEW_URL="preview-${SAFE_BRANCH}.staging.example.com"

cat <<EOF
[deploy-preview] would deploy branch: ${BRANCH}
[deploy-preview] sanitized:           ${SAFE_BRANCH}
[deploy-preview] preview URL:         https://${PREVIEW_URL}
[deploy-preview] expires:             $(date -u -v+7d '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d '+7 days' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo '+7 days from now')

[deploy-preview] (stub) — no real deploy performed.
EOF
