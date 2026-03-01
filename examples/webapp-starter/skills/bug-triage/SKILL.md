---
name: bug-triage
description: Triage a bug report into an actionable GitHub issue with severity, reproduction steps, and assignment. Use when a bug is reported, when error logs need investigation, or when asked to file/triage an issue.
metadata:
  forged-by: claude-agent
  forged-from: session-2026-02-20
  forged-reason: "Forked from ops-toolkit — adapted for this project's labeling and priority scheme"
  fork-of: ops-toolkit/bug-triage
  usage-count: "6"
  last-used: "2026-02-25"
---

# Bug Triage

Convert a bug report (user message, error log, Sentry alert) into a well-structured GitHub issue.

## Inputs
- Bug report (raw text, screenshot, error log, or Sentry URL)
- Reporter (who reported it, if known)
- Environment (production, staging, local)

## Steps

1. **Reproduce or verify**
   - Can you reproduce the bug from the report?
   - If yes: document exact reproduction steps
   - If no: flag as "needs-repro" and note what you tried

2. **Classify severity**
   | Severity | Criteria | Label |
   |----------|----------|-------|
   | P0 | Data loss, security, or full outage | `severity:critical` |
   | P1 | Major feature broken, no workaround | `severity:high` |
   | P2 | Feature broken, workaround exists | `severity:medium` |
   | P3 | Minor annoyance, cosmetic | `severity:low` |

3. **Identify the component**
   - Frontend / Backend / Infrastructure / Extension
   - Add the corresponding label: `area:frontend`, `area:backend`, etc.

4. **Write the GitHub issue**
   ```markdown
   ## Bug: [one-line description]

   **Severity:** P[0-3]
   **Environment:** [production/staging/local]
   **Reporter:** [name or "internal"]

   ### What happened
   [Clear description of the bug]

   ### Expected behavior
   [What should have happened]

   ### Reproduction steps
   1. ...
   2. ...
   3. ...

   ### Evidence
   [Error logs, screenshots, Sentry link]

   ### Suspected cause
   [If you have a hypothesis, state it]
   ```

5. **File the issue**
   ```bash
   gh issue create --title "Bug: [description]" --body "[body]" --label "bug,severity:[level],area:[component]"
   ```

6. **Assign if obvious**
   - If the suspected cause points to a clear owner, assign them
   - If not, leave unassigned (triage meeting will handle it)

## Conventions
- Bug titles always start with `Bug:`
- Every bug issue has both a `severity:` and `area:` label
- P0 bugs get a Slack notification (via `scripts/notify-critical.sh`)
- Duplicate bugs are closed with a reference to the original

## Edge Cases
- **Vague reports:** Ask the reporter for reproduction steps before filing. Don't file issues you can't act on.
- **Already fixed:** Check recent commits/PRs. If fixed, reply to reporter and don't file.
- **Feature request disguised as bug:** Re-label as `enhancement` and move to backlog.
