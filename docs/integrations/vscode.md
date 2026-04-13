# VS Code (Copilot Chat)

> VS Code with GitHub Copilot Chat supports Agent Skills through the Copilot integration. Skills live at `.github/skills/` — the same path as standalone Copilot.

## Quick install

If your project already uses GitHub Copilot, follow [`docs/integrations/github-copilot.md`](github-copilot.md) — the wiring is identical.

## VS Code-specific notes

- Copilot Chat in VS Code honors `.github/copilot-instructions.md` automatically when the extension is enabled.
- Some VS Code Copilot surfaces have Agent Skills support in "Agent Skills (preview)" under Settings → Extensions → GitHub Copilot Chat → Features. Turn it on if your skills aren't being picked up.
- VS Code's Copilot extension ships a built-in Agent Skills browser (Command Palette → "Copilot: Browse Agent Skills") that lists skills from `.github/skills/` — a good sanity check that your colony is discoverable.
- See [code.visualstudio.com/docs/copilot/customization/agent-skills](https://code.visualstudio.com/docs/copilot/customization/agent-skills) for the canonical VS Code docs.

## Verify

Open the Agent Skills browser, confirm `skillforge` appears, then run the three-question check from the [Copilot integration doc](github-copilot.md#verify).

## Troubleshooting

Same as Copilot. If the Agent Skills browser is empty, try disabling and re-enabling the GitHub Copilot Chat extension — the skill index is populated on activation.
