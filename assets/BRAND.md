# SkDD Brand Guide

## Token Palette

| Token | Hex | Role |
|---|---|---|
| `--skdd-ink-900` | `#0f172a` | Background gradient start · dark mode canvas |
| `--skdd-ink-800` | `#1e293b` | Background gradient end · dark mode surface |
| `--skdd-ink-600` | `#334155` | Archive node fill · subtle dividers |
| `--skdd-slate-400` | `#94a3b8` | Secondary text · subdued labels |
| `--skdd-forge-500` | `#f59e0b` | Anvil gradient start — **forge** amber |
| `--skdd-forge-600` | `#ef4444` | Anvil gradient end — heat red |
| `--skdd-spark-100` | `#fef3c7` | Spark diamond — "energy" cream |
| `--skdd-loop-400` | `#38bdf8` | Loop arc — **discover** sky (Starlight accent) |
| `--skdd-loop-900` | `#0c4a6e` | Accent-low — dark sky for layering |
| `--skdd-paper-50` | `#f8fafc` | Light text / light-mode canvas |

## Semantic Mapping

| Concept | Color | Rationale |
|---|---|---|
| **Forge** (create, build, write) | amber `#f59e0b` → red `#ef4444` | Heat gradient of a forge/anvil — the craft metaphor |
| **Loop / Discover** (iterate, feed back) | sky `#38bdf8` | Clean, cool cycle energy; matches Starlight's default accent |
| **Ink** (text, backgrounds, depth) | slate `#0f172a` / `#1e293b` | Deep slate for authority and contrast |
| **Spark** (energy, emphasis) | cream `#fef3c7` | The hot-white point where heat meets light |

## Asset Inventory

| File | Size | Background | Use |
|---|---|---|---|
| `assets/logo.svg` | 128×128 | Dark (`#0f172a` → `#1e293b`) | GitHub, dark contexts |
| `assets/logo-light.svg` | 128×128 | Light (`#f8fafc`) | Light-mode contexts |
| `assets/mark.svg` | 128×128 | Transparent | Starlight header, embedding |
| `assets/wordmark.svg` | 560×128 | Dark | README dark banner |
| `assets/wordmark-light.svg` | 560×128 | Transparent/light | README light banner, docs |
| `assets/og-image.svg` | 1200×630 | Dark gradient | Social preview source |
| `site/public/favicon.svg` | scalable | Dark/light via media query | Browser tab SVG favicon |
| `site/public/favicon-32.png` | 32×32 | Dark | Browser tab PNG fallback |
| `site/public/apple-touch-icon.png` | 180×180 | Dark | iOS home screen icon |
| `site/public/og-image.png` | 1200×630 | Dark | Open Graph / Twitter card |
| `extensions/vscode/assets/icon.png` | 128×128 | Dark | VS Code Marketplace |
| `plugins/skdd-claude/icon.png` | 256×256 | Dark | Claude plugin icon |

## Regeneration Commands

```bash
# Install deps (one-time — sharp is already in site/node_modules)
pnpm -C site install

# Regenerate all PNG assets from hand-authored SVGs
node site/scripts/build-brand-assets.mjs

# Verify dimensions (macOS)
sips -g pixelWidth -g pixelHeight \
  site/public/favicon-32.png \
  site/public/apple-touch-icon.png \
  site/public/og-image.png \
  extensions/vscode/assets/icon.png \
  plugins/skdd-claude/icon.png
```

## Design Decisions

- **Mark (anvil)**: The SkDD mark is an anvil silhouette with a diamond spark above it, symbolising skilled craftsmanship. The loop arc with endpoint dots represents the feedback loop — forge, evaluate, evolve.
- **Wordmark**: "SkDD" uses a bold monospace typeface. `wordmark-light.svg` uses text outlined to paths for pixel-stable rendering across renderers.
- **Gradient direction**: Forge gradient flows top-left → bottom-right (x1/y1 to x2/y2) to feel like heat rising from the anvil.
- **OG image**: Dark canvas (1200×630), logo centred with "Skills-Driven Development" tagline and URL. Safe zone for cropped previews: central 800×400.
