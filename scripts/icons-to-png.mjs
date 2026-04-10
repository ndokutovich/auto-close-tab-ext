/**
 * Render SVG icons into PNG at the sizes Chrome Web Store accepts.
 * Run: node scripts/icons-to-png.mjs
 *
 * Outputs are written next to the SVG sources in src/icons/ so they are
 * picked up by the existing build step that copies src/icons to dist icons/.
 */

import { chromium } from 'playwright';
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = resolve(__dirname, '../src/icons');

const SIZES = [16, 32, 48, 128];

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ deviceScaleFactor: 1 });

  for (const size of SIZES) {
    const svgPath = resolve(ICONS_DIR, `icon-${size}.svg`);
    const pngPath = resolve(ICONS_DIR, `icon-${size}.png`);
    const svg = await readFile(svgPath, 'utf-8');

    const page = await context.newPage();
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;padding:0;background:transparent;">
        <div style="width:${size}px;height:${size}px;line-height:0;">${svg}</div>
      </body></html>`,
      { waitUntil: 'domcontentloaded' }
    );
    // Force the SVG to fill the viewport in case it has explicit smaller dims.
    await page.evaluate((s) => {
      const svg = document.querySelector('svg');
      if (!svg) return;
      svg.setAttribute('width', String(s));
      svg.setAttribute('height', String(s));
    }, size);

    await page.screenshot({
      path: pngPath,
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    await page.close();
    console.log(`Rendered ${pngPath}`);
  }

  await context.close();
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
