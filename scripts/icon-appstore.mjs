#!/usr/bin/env node
/**
 * Render the App Store 1024×1024 icon as an opaque PNG.
 *
 * App Store Connect requirements:
 * - Exactly 1024×1024
 * - Opaque (no alpha channel) — transparent pixels cause rejection
 * - sRGB color profile
 * - No pre-rounded corners (Apple applies its own mask)
 *
 * Output: screenshots/store/icon-1024.png
 */

import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SVG_PATH = resolve(ROOT, 'src/icons/icon-1024.svg');
const OUT_DIR = resolve(ROOT, 'screenshots/store');
const OUT_PATH = resolve(OUT_DIR, 'icon-1024.png');

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const svg = await readFile(SVG_PATH, 'utf8');

  const browser = await chromium.launch();
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1024, height: 1024 });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;padding:0;">
      <div style="width:1024px;height:1024px;line-height:0;">${svg}</div>
    </body></html>`,
    { waitUntil: 'domcontentloaded' }
  );
  await page.evaluate(() => {
    const el = document.querySelector('svg');
    if (!el) return;
    el.setAttribute('width', '1024');
    el.setAttribute('height', '1024');
  });

  // omitBackground: false keeps the alpha channel opaque from the SVG's own
  // <rect fill="..."> background. This is mandatory for App Store Connect.
  await page.screenshot({
    path: OUT_PATH,
    omitBackground: false,
    clip: { x: 0, y: 0, width: 1024, height: 1024 },
  });

  await context.close();
  await browser.close();
  console.log(`✓ ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
