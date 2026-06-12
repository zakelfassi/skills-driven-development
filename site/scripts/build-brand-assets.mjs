/**
 * build-brand-assets.mjs
 *
 * Converts hand-authored SVGs in assets/ to all PNG targets using sharp.
 * Run from repo root:  node site/scripts/build-brand-assets.mjs
 *
 * Outputs
 *   site/public/favicon-32.png          32×32   — browser tab PNG fallback
 *   site/public/apple-touch-icon.png   180×180  — iOS home screen
 *   site/public/og-image.png          1200×630  — Open Graph / Twitter card
 *   assets/og-image.png               1200×630  — canonical copy in assets/
 *   extensions/vscode/assets/icon.png  128×128  — VS Code Marketplace
 *   plugins/skdd-claude/icon.png       256×256  — Claude plugin icon
 */

import sharp from 'sharp';
import { readFileSync, mkdirSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const siteDir   = resolve(scriptDir, '..');
const repoRoot  = resolve(siteDir, '..');

const src = (rel) => resolve(repoRoot, 'assets', rel);
const pub = (rel) => resolve(siteDir, 'public', rel);
const ext = (rel) => resolve(repoRoot, 'extensions', 'vscode', 'assets', rel);
const plg = (rel) => resolve(repoRoot, 'plugins', 'skdd-claude', rel);

// Ensure target directories exist
for (const dir of [
  resolve(siteDir, 'public'),
  resolve(repoRoot, 'extensions', 'vscode', 'assets'),
]) {
  mkdirSync(dir, { recursive: true });
}

async function svgToPng(svgPath, pngPath, width, height) {
  const svgBuffer = readFileSync(svgPath);
  await sharp(svgBuffer)
    .resize(width, height)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(pngPath);
  console.log(`  ✓  ${pngPath.replace(repoRoot + '/', '')}  (${width}×${height})`);
}

async function build() {
  console.log('Building brand assets…\n');

  // favicon-32.png — use mark.svg (transparent, no outer border at small size)
  await svgToPng(src('mark.svg'), pub('favicon-32.png'), 32, 32);

  // apple-touch-icon.png — use dark logo
  await svgToPng(src('logo.svg'), pub('apple-touch-icon.png'), 180, 180);

  // og-image.png — from og-image.svg
  await svgToPng(src('og-image.svg'), pub('og-image.png'), 1200, 630);

  // Copy og-image.png to assets/ as canonical copy
  copyFileSync(pub('og-image.png'), src('og-image.png'));
  console.log(`  ✓  assets/og-image.png  (copy from site/public/og-image.png)`);

  // VS Code extension icon
  await svgToPng(src('logo.svg'), ext('icon.png'), 128, 128);

  // Claude plugin icon
  await svgToPng(src('logo.svg'), plg('icon.png'), 256, 256);

  console.log('\nAll brand assets generated. Run to verify dimensions:\n');
  console.log(
    '  sips -g pixelWidth -g pixelHeight \\\n' +
    '    site/public/favicon-32.png \\\n' +
    '    site/public/apple-touch-icon.png \\\n' +
    '    site/public/og-image.png \\\n' +
    '    extensions/vscode/assets/icon.png \\\n' +
    '    plugins/skdd-claude/icon.png\n'
  );
}

build().catch((err) => {
  console.error('build-brand-assets failed:', err);
  process.exit(1);
});
