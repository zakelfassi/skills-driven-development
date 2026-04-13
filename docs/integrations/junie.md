# Junie

> Junie is JetBrains' IntelliJ Platform agent. It supports Agent Skills inside any JetBrains IDE (IntelliJ IDEA, PyCharm, GoLand, WebStorm, Rider, etc.).

## Quick install

```bash
mkdir -p .junie/skills/skillforge
curl -fsSL https://raw.githubusercontent.com/zakelfassi/skills-driven-development/main/skillforge/SKILL.md \
  -o .junie/skills/skillforge/SKILL.md
touch .skills-registry.md
```

## Configure

Junie reads `AGENTS.md` at the project root and the JetBrains-native `.junie/config.xml` for IDE-level settings. SkDD uses `AGENTS.md` — add the standard skills block from [`docs/configuration.md`](../configuration.md) pointing at `.junie/skills/`.

## Harness notes

- Junie's skills docs: [junie.jetbrains.com/docs/agent-skills.html](https://junie.jetbrains.com/docs/agent-skills.html).
- Junie runs as an IDE plugin, so skill discovery happens at project open (not session start). Closing and reopening the project is the equivalent of "fresh session" for the verification step.
- Junie supports both project-scope and JetBrains user-scope (`~/.junie/skills/` or the platform-specific config dir).
- `allowed-tools` support varies by IDE language plugin — check your specific IDE's Junie release notes.

## Verify

Open the project in your JetBrains IDE, open the Junie chat panel, and run the three-question check. On the third question, close and reopen the project instead of starting a "fresh session".

## Troubleshooting

If skills aren't loaded, check Junie's "Project Instructions" setting (Preferences → Tools → Junie → Instructions). It must point at `AGENTS.md` or have "auto-detect" enabled.
