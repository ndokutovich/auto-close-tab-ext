/**
 * Generate Chrome Web Store promo tiles:
 *   - Small promo tile: 440x280 PNG
 *   - Marquee promo tile: 1400x560 PNG (optional, shown on featured pages)
 *
 * Run: node scripts/promo-tile.mjs
 */

import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../screenshots/store/promo');
mkdirSync(OUT, { recursive: true });

const iconSvg = readFileSync(
  resolve(__dirname, '../src/icons/icon-128.svg'),
  'utf-8'
);

function renderHtml({ width, height, titleSize, subtitleSize, iconSize }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body {
    margin: 0; padding: 0;
    width: ${width}px; height: ${height}px;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #f1f5f9;
    background:
      radial-gradient(ellipse at 85% 15%, rgba(59,130,246,0.32) 0%, transparent 55%),
      radial-gradient(ellipse at 15% 90%, rgba(139,92,246,0.26) 0%, transparent 60%),
      linear-gradient(135deg, #0b1020 0%, #0f172a 55%, #111827 100%);
  }
  .wrap {
    width: 100%; height: 100%;
    display: flex; align-items: center;
    padding: ${Math.round(height * 0.08)}px ${Math.round(width * 0.06)}px;
    box-sizing: border-box;
    gap: ${Math.round(width * 0.04)}px;
  }
  .icon {
    width: ${iconSize}px; height: ${iconSize}px;
    flex-shrink: 0;
    filter: drop-shadow(0 12px 32px rgba(59, 130, 246, 0.4));
  }
  .icon svg {
    width: 100%; height: 100%; display: block;
  }
  .text { flex: 1; min-width: 0; }
  .title {
    font-size: ${titleSize}px;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 0 0 ${Math.round(titleSize * 0.18)}px 0;
    line-height: 1.05;
    background: linear-gradient(135deg, #f1f5f9 0%, #94a3b8 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .subtitle {
    font-size: ${subtitleSize}px;
    font-weight: 500;
    color: #cbd5e1;
    margin: 0 0 ${Math.round(subtitleSize * 0.4)}px 0;
    line-height: 1.25;
  }
  .pills {
    display: flex;
    gap: ${Math.round(subtitleSize * 0.4)}px;
    flex-wrap: wrap;
    margin-top: ${Math.round(subtitleSize * 0.3)}px;
  }
  .pill {
    font-size: ${Math.round(subtitleSize * 0.72)}px;
    font-weight: 600;
    padding: ${Math.round(subtitleSize * 0.22)}px ${Math.round(subtitleSize * 0.55)}px;
    border-radius: 999px;
    color: #e2e8f0;
    background: rgba(148, 163, 184, 0.12);
    border: 1px solid rgba(148, 163, 184, 0.22);
    white-space: nowrap;
  }
  .pill.accent {
    color: #bfdbfe;
    background: rgba(59, 130, 246, 0.16);
    border-color: rgba(59, 130, 246, 0.35);
  }
</style></head>
<body>
  <div class="wrap">
    <div class="icon">${iconSvg}</div>
    <div class="text">
      <h1 class="title">Aging Tabs</h1>
      <p class="subtitle">Tabs fade out before they close. Graveyard brings anything back.</p>
      <div class="pills">
        <span class="pill accent">Auto-close</span>
        <span class="pill">Graveyard</span>
        <span class="pill">Global pause</span>
        <span class="pill">Privacy-first</span>
      </div>
    </div>
  </div>
</body></html>`;
}

async function render(spec, filename) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: spec.width, height: spec.height },
    // CWS requires the image to be exactly spec.width x spec.height. Playwright
    // multiplies output by deviceScaleFactor, so we keep it at 1.
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  await page.setContent(renderHtml(spec), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(200);
  await page.screenshot({
    path: resolve(OUT, filename),
    clip: { x: 0, y: 0, width: spec.width, height: spec.height },
  });
  console.log(`Rendered ${filename} (${spec.width}x${spec.height})`);
  await context.close();
  await browser.close();
}

await render(
  { width: 440, height: 280, titleSize: 44, subtitleSize: 17, iconSize: 104 },
  'promo-440x280.png'
);
await render(
  { width: 1400, height: 560, titleSize: 110, subtitleSize: 40, iconSize: 260 },
  'promo-1400x560.png'
);
