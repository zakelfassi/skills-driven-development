---
name: deploy-preview
description: Deploy a preview branch to the staging environment for review. Use when a feature branch is ready for visual review, when someone asks to "deploy this for review", or before opening a PR.
metadata:
  forged-by: codex-agent
  forged-from: session-2026-02-10
  forged-reason: "Deployed 3 preview branches manually in one session — same steps each time"
  usage-count: "11"
  last-used: "2026-02-28"
---

# Deploy Preview

Deploy the current branch to a preview URL for review before merging.

## Inputs
- Branch name (defaults to current branch)
- Environment (defaults to `staging`)

## Steps

1. **Verify branch is clean**
   ```bash
   git status --porcelain
   ```
   If dirty, commit or stash before proceeding.

2. **Run tests locally**
   ```bash
   npm test
   ```
   Do not deploy if tests fail.

3. **Push to remote**
   ```bash
   git push origin HEAD
   ```

4. **Trigger preview deploy**
   ```bash
   scripts/deploy-preview.sh
   ```
   This builds, uploads, and returns a preview URL.

5. **Verify the preview**
   - Open the preview URL
   - Check: page loads, no console errors, key feature works
   - If broken: fix locally, re-push, re-deploy

6. **Share the preview URL**
   - Post in the PR description
   - Or share in the team channel

## Conventions
- Preview URLs follow the pattern: `preview-{branch}.staging.example.com`
- Preview deploys expire after 7 days
- Only one preview per branch (re-deploying replaces the previous)

## Edge Cases
- **Branch name has slashes:** The deploy script sanitizes `/` to `-`
- **Large assets:** Preview deploys skip video files >50MB
- **Environment variables:** Preview uses staging env vars, not production
