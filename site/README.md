# SkDD documentation site

Starlight (Astro-powered) documentation site for [Skills-Driven Development](https://github.com/zakelfassi/skills-driven-development).

## Status

**Scaffold.** The Astro + Starlight structure is in place and the homepage (`src/content/docs/index.mdx`) renders. Most page content still lives under the repo root's `docs/` directory and is **not yet ingested** — we'll wire that up in a follow-up by either copying docs into `site/src/content/docs/` at build time or pointing Starlight's content loader at the parent `docs/` directory.

Right now this site shows:

- `/` — homepage with hero, the one-minute pitch, and the five principles
- Sidebar stubs for future content (Why SkDD, Configuration, Skill colony, Forging, Spec alignment, Harness integrations, Specs & manifests)

All linked sidebar entries **404 until their `src/content/docs/*.mdx` files are written** — that work is tracked in the L-content / L-commit milestone of the P5 roadmap (see `/Users/zakelfassi/.claude/plans/linear-gathering-hamming.md`).

## Develop

```bash
cd site
pnpm install
pnpm dev            # localhost:4321
pnpm build          # static output in dist/
```

## Deploy

GitHub Pages via `.github/workflows/deploy-docs.yml`. The workflow builds `site/` on every push to `main` and publishes the result to the `gh-pages` branch (or GitHub Pages artifact — whichever is configured in the repo settings).

First deploy requires a one-time manual step: enable Pages in repo Settings → Pages → Source = `GitHub Actions`.

## Adding a page

1. Drop a `.mdx` file under `src/content/docs/`.
2. Update the sidebar in `astro.config.mjs`.
3. Commit + push — the deploy workflow handles the rest.

## Ingesting the repo's existing docs

Follow-up work (not done in this scaffold):

- **Option A** (simplest): `cp ../docs/*.md src/content/docs/` as a pre-build step in the workflow. Keeps the site in lockstep with the authoritative markdown.
- **Option B**: Symlink `src/content/docs` to `../docs` and adjust frontmatter generation via a Starlight plugin.
- **Option C**: Write a tiny Node script that walks `../docs/**/*.md`, rewrites relative links, and emits MDX shells with proper frontmatter into `src/content/docs/`.

Whatever we pick, the existing `.md` files in the parent `docs/` directory are canonical — the site should never fork them.
