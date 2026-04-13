# Security Policy

## Supported versions

SkDD is an early-stage open methodology + CLI + VS Code extension scaffold. Only the latest minor version on `main` is supported for security fixes. Older tagged releases get best-effort patches if the fix is small, but no guarantees.

| Version | Supported |
|---------|-----------|
| 0.3.x   | :white_check_mark: |
| 0.2.x   | best-effort |
| < 0.2   | :x: |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Use GitHub's **Private Vulnerability Reporting** instead:

1. Go to <https://github.com/zakelfassi/skills-driven-development/security/advisories>
2. Click **Report a vulnerability**
3. Describe the issue — what you observed, how to reproduce, and your threat model
4. If you have a suggested fix, include it (or link a private fork)

You can also reach the maintainer directly at `zakelfassi+security@gmail.com`. PGP is not currently required.

## What counts as a vulnerability

SkDD's threat surface is small — it's a CLI that reads + writes files in your project, a JSON Schema, a set of markdown templates, and a VS Code extension that shells out to the CLI. Things we consider in-scope:

- **Command injection in the CLI**: any `skdd` subcommand that runs a shell with user-supplied input without escaping
- **Path traversal**: `skdd init`, `skdd forge`, `skdd link`, `skdd import` writing outside the project root
- **Symlink attacks**: `skdd link` following a malicious symlink to clobber user data outside `skills/` or a configured mirror path
- **Arbitrary file overwrite without `--force`**: any command that silently replaces user content the user didn't explicitly opt into replacing
- **Supply-chain issues** in `cli/` dependencies (we pin via pnpm-lock, but upgrades can introduce risk)
- **VS Code extension issues**: the extension shells out to `skdd` via `vscode.window.createTerminal` or `vscode.ShellExecution` — anything that lets a crafted workspace file execute unintended commands is in-scope

Out of scope:

- **Skill content**: skills are markdown files the user authors or receives. If a skill says "run `rm -rf /`", that's social engineering of the user, not a SkDD bug. `skdd validate` will not analyze skill content for semantic safety.
- **Harness behavior**: how Claude Code / Codex / Cursor / etc. execute a skill is outside SkDD's control. Report those to the respective vendors.
- **DoS via large files**: SkDD doesn't run in production and has no notion of request rate. If `skdd validate` is slow on a huge colony, open a normal issue.
- **Publishing / marketplace submissions**: SkDD does not yet publish or submit colonies automatically.

## Response timeline

- **72 hours** for acknowledgement (maintainer will reply via the advisory thread)
- **14 days** for an initial patch plan for critical issues
- **30 days** for a public fix + advisory on non-critical issues
- **90 days** maximum embargo before public disclosure, unless we agree a longer window in writing

If the issue is actively exploited in the wild, we will disclose faster than 30 days.

## Credit

Researchers who report valid vulnerabilities will be credited in the advisory and `CHANGELOG.md` under the fix, unless they request anonymity. There is no paid bug bounty.

## See also

- [`docs/spec/colony-v1.json`](docs/spec/colony-v1.json) — JSON Schema for `.colony.json`
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to submit non-security patches and improvements
- [`ROADMAP.md`](ROADMAP.md) — a security doc with signing conventions and Snyk integration is planned (P4.6 in the project plan)
