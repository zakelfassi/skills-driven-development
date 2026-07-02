---
description: Toggle the SkDD enforcement hooks (finish-the-loop gate, freeze-the-session reminder) on or off for this project
argument-hint: "on | off | status | finish-the-loop on|off | freeze-the-session on|off"
---

Manage the SkDD enforcement hooks for this project. The hooks are **off by default** and their state lives in `.claude/skdd.local.md` (project-scoped, survives sessions; add it to `.gitignore` if the team shouldn't share it).

The user's request: `$ARGUMENTS`

## What to do

1. Read `.claude/skdd.local.md` if it exists. Its frontmatter holds the toggles:

   ```markdown
   ---
   skdd-hooks:
     finish-the-loop: false
     freeze-the-session: false
   ---

   # SkDD hook toggles

   Managed by /skdd-claude:skdd-hooks. `true`/`on` enables a gate for this project.
   ```

2. Apply the request:
   - `on` / `off` (no gate named) → set **both** gates to that state.
   - `finish-the-loop on|off` or `freeze-the-session on|off` → set just that gate.
   - `status` or empty → don't write anything; report the current state of both gates.

3. Write the file back (create `.claude/` if needed, keep the format above — the hook scripts parse the `gate-name: true|false` lines).

4. Confirm to the user what changed, and remind them what each gate does:
   - **finish-the-loop** (Stop gate): if the session changed product source and the final report claims success without observed evidence ("should work now"), the stop is bounced **once** with instructions to verify or state plainly that it's unverified. Second stop always passes.
   - **freeze-the-session** (SessionEnd + PreCompact reminder): if the session looks substantive and the colony registry hasn't been touched, a non-blocking reminder to extract skills/conventions before the context dies.

A skill is a procedure the model follows when it decides to; a hook is a gate for when it forgets.
