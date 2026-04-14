# Gemini CLI

> Google's open-source Gemini CLI supports the Agent Skills spec at `.gemini/skills/`.

## Quick install

```bash
pnpm dlx @zakelfassi/skdd init --harness=gemini
```

That writes `skills/skillforge/SKILL.md` as the canonical source, `.gemini/skills → ../skills` as the mirror Gemini CLI actually reads, `.skills-registry.md`, and the skills block in `AGENTS.md`.

## Configure

Gemini CLI reads `AGENTS.md`. The skills block (auto-written by `skdd init`) references `skills/` as canonical and `.gemini/skills` as the mirror maintained by `skdd link`. See [`docs/configuration.md#gemini-cli`](../configuration.md#gemini-cli) for the exact text.

## Verify

Run `gemini` in the project directory and ask *"What skills are available?"* → *"Forge a skill for publishing release notes."* → reopen → confirm persistence.

## Harness notes

- Gemini CLI honors nested skill discovery in monorepos the same way Claude Code does.
- The CLI is open-source at [github.com/GoogleCloudPlatform/generative-ai-cli](https://github.com/GoogleCloudPlatform/generative-ai-cli) and ships under Apache-2.0.
- See [geminicli.com/docs/cli/skills/](https://geminicli.com/docs/cli/skills/) for the canonical skills docs.

## Troubleshooting

Same failure modes as Claude Code (agent doesn't scan registry → check `AGENTS.md`; skill doesn't land → re-prompt to update the registry). Cross-reference [`docs/integrations/claude-code.md#troubleshooting`](claude-code.md#troubleshooting).
