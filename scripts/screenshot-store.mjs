/**
 * Generate Chrome Web Store / AMO ready screenshots at 1280x800.
 * Run: node scripts/screenshot-store.mjs
 *
 * CWS requires screenshots at exactly 1280x800 or 640x400. We render the popup
 * centered on a branded gradient canvas and the options page cropped to 1280x800.
 */

import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_PATH = resolve(__dirname, '../dist/chrome');
const ROOT = resolve(__dirname, '..');
const OUT = resolve(__dirname, '../screenshots/store');
mkdirSync(OUT, { recursive: true });

const SHOT = { width: 1280, height: 800 };

// Build first
console.log('Building...');
execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'pipe', shell: true });

/**
 * Wrap the current popup document body inside a 1280x800 showcase container
 * with a gradient background and a soft drop-shadow on the popup card.
 */
async function wrapPopupShowcase(page, { scheme, caption }) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize(SHOT);
  await page.evaluate(
    ({ scheme, caption }) => {
      // Move the entire popup body into a fixed-size card.
      const card = document.createElement('div');
      card.id = '__shot_card__';
      while (document.body.firstChild) {
        card.appendChild(document.body.firstChild);
      }
      document.body.appendChild(card);

      // Caption element (optional).
      const capEl = document.createElement('div');
      capEl.id = '__shot_caption__';
      capEl.textContent = caption;
      document.body.appendChild(capEl);

      const style = document.createElement('style');
      const bg =
        scheme === 'dark'
          ? 'linear-gradient(135deg,#0b1020 0%,#1e293b 55%,#111827 100%)'
          : 'linear-gradient(135deg,#f1f5f9 0%,#e0e7ff 55%,#f8fafc 100%)';
      const captionColor = scheme === 'dark' ? '#e2e8f0' : '#0f172a';
      style.textContent = `
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          width: 1280px !important;
          height: 800px !important;
          background: ${bg} !important;
          overflow: hidden !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        body {
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 24px !important;
        }
        #__shot_caption__ {
          font-size: 26px;
          font-weight: 600;
          color: ${captionColor};
          letter-spacing: -0.01em;
          max-width: 720px;
          text-align: center;
          text-shadow: 0 1px 2px rgba(0,0,0,0.15);
        }
        #__shot_card__ {
          width: 400px;
          max-height: 560px;
          overflow: hidden;
          border-radius: 16px;
          box-shadow: 0 30px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.08);
          background: var(--bg, #fff);
        }
      `;
      document.head.appendChild(style);
    },
    { scheme, caption }
  );
  await page.waitForTimeout(300);
}

async function shotPopup(context, extId, file, opts) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/popup/popup.html`);
  await page.waitForTimeout(600);
  if (opts.prepare) await opts.prepare(page);
  await wrapPopupShowcase(page, { scheme: opts.scheme, caption: opts.caption });
  await page.screenshot({
    path: resolve(OUT, file),
    clip: { x: 0, y: 0, ...SHOT },
  });
  console.log(`Screenshot: ${file}`);
  await page.close();
}

async function main() {
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
    viewport: SHOT,
    colorScheme: 'dark',
  });

  // Find extension ID. MV3 service workers register lazily, so we open a
  // dummy page first to give Chromium a chance to spin the worker up.
  const warmup = await context.newPage();
  await warmup.goto('about:blank').catch(() => {});
  await warmup.waitForTimeout(1500);

  function findExtId() {
    for (const w of context.serviceWorkers()) {
      if (w.url().startsWith('chrome-extension://')) {
        return w.url().split('/')[2];
      }
    }
    return null;
  }

  let extId = findExtId();
  if (!extId) {
    const sw = await context.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
    extId = sw?.url().split('/')[2] ?? findExtId();
  }
  // Some Chromium builds only expose the worker after the first navigation
  // targeting the extension origin. Poll a few times as a last resort.
  for (let i = 0; i < 10 && !extId; i++) {
    await warmup.waitForTimeout(500);
    extId = findExtId();
  }
  await warmup.close();

  if (!extId) throw new Error('Failed to locate extension service worker');
  console.log('Extension ID:', extId);

  // Open several real tabs so the background tracker has something to show
  const urls = [
    'https://github.com',
    'https://developer.mozilla.org',
    'https://news.ycombinator.com',
    'https://en.wikipedia.org/wiki/Tab_(interface)',
    'https://stackoverflow.com',
  ];
  for (const url of urls) {
    const tab = await context.newPage();
    await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  }
  await context.pages()[0].waitForTimeout(2000);

  // Seed graveyard with realistic entries
  const seedPage = await context.newPage();
  await seedPage.goto(`chrome-extension://${extId}/options/options.html`);
  await seedPage.waitForTimeout(800);

  const graveyardEntries = [
    { id: 'demo-1', url: 'https://react.dev/learn', title: 'Quick Start - React', faviconUrl: '', closedAt: Date.now() - 120000, domain: 'react.dev' },
    { id: 'demo-2', url: 'https://docs.python.org/3/tutorial/', title: 'The Python Tutorial', faviconUrl: '', closedAt: Date.now() - 300000, domain: 'docs.python.org' },
    { id: 'demo-3', url: 'https://news.ycombinator.com/item?id=12345', title: 'Show HN: I built an AI that writes tests', faviconUrl: '', closedAt: Date.now() - 600000, domain: 'news.ycombinator.com' },
    { id: 'demo-4', url: 'https://github.com/nickolay/aging-tabs', title: 'aging-tabs: Auto-close inactive browser tabs', faviconUrl: '', closedAt: Date.now() - 900000, domain: 'github.com' },
    { id: 'demo-5', url: 'https://stackoverflow.com/questions/12345', title: 'How to properly handle tab lifecycle in MV3?', faviconUrl: '', closedAt: Date.now() - 1200000, domain: 'stackoverflow.com' },
    { id: 'demo-6', url: 'https://developer.chrome.com/docs/extensions', title: 'Chrome Extensions documentation', faviconUrl: '', closedAt: Date.now() - 1800000, domain: 'developer.chrome.com' },
    { id: 'demo-7', url: 'https://addons.mozilla.org/firefox/addon/aging-tabs', title: 'Aging Tabs - Firefox addon', faviconUrl: '', closedAt: Date.now() - 3600000, domain: 'addons.mozilla.org' },
    { id: 'demo-8', url: 'https://www.typescriptlang.org/docs/', title: 'TypeScript: Documentation', faviconUrl: '', closedAt: Date.now() - 7200000, domain: 'typescriptlang.org' },
  ];

  await seedPage.evaluate(async (data) => {
    try {
      await browser.runtime.sendMessage({ type: 'IMPORT_DATA', data });
    } catch {}
  }, JSON.stringify({ graveyard: graveyardEntries }));
  await seedPage.waitForTimeout(500);
  await seedPage.close();

  // --- Popup screenshots (centered in 1280x800 showcase) ---
  await shotPopup(context, extId, '01-popup-dark.png', {
    scheme: 'dark',
    caption: 'Recover closed tabs from the graveyard',
  });
  await shotPopup(context, extId, '02-popup-light.png', {
    scheme: 'light',
    caption: 'Light & dark themes, follows the system',
  });
  await shotPopup(context, extId, '03-popup-sorted-domain.png', {
    scheme: 'dark',
    caption: 'Sort closed tabs by domain or time',
    prepare: async (page) => {
      await page.selectOption('#sort-mode', 'domain');
      await page.waitForTimeout(200);
    },
  });
  await shotPopup(context, extId, '04-popup-search.png', {
    scheme: 'dark',
    caption: 'Instant search across the graveyard',
    prepare: async (page) => {
      await page.fill('#search', 'github');
      await page.waitForTimeout(200);
    },
  });
  await shotPopup(context, extId, '05-popup-paused.png', {
    scheme: 'dark',
    caption: 'Global pause — freeze aging when you need it',
    prepare: async (page) => {
      await page.click('#btn-pause');
      await page.waitForTimeout(400);
    },
  });

  // --- Options screenshot (1280x800, cropped top region) ---
  const optionsPage = await context.newPage();
  await optionsPage.goto(`chrome-extension://${extId}/options/options.html`);
  await optionsPage.emulateMedia({ colorScheme: 'dark' });
  await optionsPage.setViewportSize(SHOT);
  await optionsPage.waitForTimeout(600);
  await optionsPage.screenshot({
    path: resolve(OUT, '06-options-dark.png'),
    clip: { x: 0, y: 0, ...SHOT },
  });
  console.log('Screenshot: 06-options-dark.png');

  await optionsPage.emulateMedia({ colorScheme: 'light' });
  await optionsPage.waitForTimeout(300);
  await optionsPage.screenshot({
    path: resolve(OUT, '07-options-light.png'),
    clip: { x: 0, y: 0, ...SHOT },
  });
  console.log('Screenshot: 07-options-light.png');
  await optionsPage.close();

  // Cleanup graveyard (best-effort)
  const cleanupPage = await context.newPage();
  await cleanupPage.goto(`chrome-extension://${extId}/options/options.html`);
  await cleanupPage.evaluate(async () => {
    try { await browser.runtime.sendMessage({ type: 'CLEAR_GRAVEYARD' }); } catch {}
  });
  await cleanupPage.close();

  await context.close();
  console.log(`\nDone! Screenshots in: ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
