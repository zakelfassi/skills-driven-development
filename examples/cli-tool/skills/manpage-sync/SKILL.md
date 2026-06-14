---
name: manpage-sync
description: Regenerate man pages and shell completion scripts from the shipctl command tree whenever commands, flags, or subcommands change. Use when a new command or flag is added, when the help text changes, or when asked to "update the man pages" or "sync completions".
metadata:
  forged-by: codex-agent
  forged-from: session-2026-04-15
  forged-reason: "Man pages drifted after three consecutive flag additions — users complained that --help and man shipctl showed different defaults"
  usage-count: "8"
  last-used: "2026-04-28"
---

# Manpage Sync

Regenerate man pages and shell completion scripts to match the current command tree.

## Inputs
- Scope: `all` (default), `man`, or `completions`
- Output directory for man pages (defaults to `docs/man/`)
- Output directory for completions (defaults to `completions/`)

## Steps

1. **Build the latest binary**
   ```bash
   cargo build --release
   # or: go build -o dist/shipctl ./cmd/shipctl
   ```
   Man page generation requires the actual binary to self-report its command tree.

2. **Generate man pages**
   ```bash
   # Using help2man:
   help2man --no-discard-stderr ./target/release/shipctl \
     -o docs/man/shipctl.1 \
     --name "cross-platform deployment CLI"

   # For each subcommand:
   help2man --no-discard-stderr "./target/release/shipctl {subcommand}" \
     -o "docs/man/shipctl-{subcommand}.1" \
     --name "shipctl {subcommand}"

   # Alternatively, if the binary has built-in man generation:
   ./target/release/shipctl man --output-dir docs/man/
   ```

3. **Generate shell completions**
   ```bash
   ./target/release/shipctl completions bash > completions/shipctl.bash
   ./target/release/shipctl completions zsh  > completions/_shipctl
   ./target/release/shipctl completions fish > completions/shipctl.fish
   ./target/release/shipctl completions powershell > completions/shipctl.ps1
   ```

4. **Verify the output**
   - Run `man -l docs/man/shipctl.1` and skim for obvious formatting errors
   - Spot-check that new flags appear in completions: `grep "{new-flag}" completions/shipctl.bash`
   - Confirm no old flags that were removed still appear

5. **Commit the generated files**
   ```bash
   git add docs/man/ completions/
   git commit -m "docs(manpages): regenerate for $(./target/release/shipctl --version)"
   ```

6. **Update install instructions** if a new section or man page was added
   Edit `docs/install.md` → the "Shell completions" and "Man pages" sections.

## Conventions
- Man pages are committed to `docs/man/`; they are generated, never hand-edited
- Completion scripts are committed to `completions/`; same rule
- This skill is run in CI after any command-tree change (see `.github/workflows/docs.yml`)
- Section numbers: `shipctl(1)`, `shipctl-release(1)`, `shipctl-build(1)`, etc.

## Edge Cases
- **`help2man` not installed:** Install via `brew install help2man` (macOS) or `apt-get install help2man` (Linux); on CI it is pre-installed.
- **Subcommand man page is empty:** The binary must output `--help` text on stderr for `help2man` to parse; add the `--no-discard-stderr` flag.
- **Completion file conflicts with a system package:** Rename to `shipctl.bash-completion` and instruct users to source it explicitly.
- **Binary not built yet:** Run `cargo build --release` first; if the build fails, fix it before trying to regenerate.
