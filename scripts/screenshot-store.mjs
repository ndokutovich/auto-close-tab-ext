/**
 * Generate store-ready screenshots with seeded data.
 * Run: node scripts/screenshot-store.mjs
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

// Build first
console.log('Building...');
execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'pipe', shell: true });

async function main() {
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark',
  });

  // Find extension ID
  const sw = await context.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => null);
  let extId = sw?.url().split('/')[2];
  if (!extId) {
    for (const w of context.serviceWorkers()) {
      if (w.url().includes('chrome-extension://')) {
        extId = w.url().split('/')[2];
        break;
      }
    }
  }
  console.log('Extension ID:', extId);

  // Open several real tabs
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
  const optionsPage = await context.newPage();
  await optionsPage.goto(`chrome-extension://${extId}/options/options.html`);
  await optionsPage.waitForTimeout(800);

  const graveyardEntries = [
    { id: 'demo-1', url: 'https://react.dev/learn', title: 'Quick Start - React', faviconUrl: '', closedAt: Date.now() - 120000, domain: 'react.dev' },
    { id: 'demo-2', url: 'https://docs.python.org/3/tutorial/', title: 'The Python Tutorial', faviconUrl: '', closedAt: Date.now() - 300000, domain: 'docs.python.org' },
    { id: 'demo-3', url: 'https://news.ycombinator.com/item?id=12345', title: 'Show HN: I built an AI that writes tests', faviconUrl: '', closedAt: Date.now() - 600000, domain: 'news.ycombinator.com' },
    { id: 'demo-4', url: 'https://github.com/nickolay/aging-tabs', title: 'aging-tabs: Auto-close inactive browser tabs', faviconUrl: '', closedAt: Date.now() - 900000, domain: 'github.com' },
    { id: 'demo-5', url: 'https://stackoverflow.com/questions/12345', title: 'How to properly handle tab lifecycle in MV3?', faviconUrl: '', closedAt: Date.now() - 1200000, domain: 'stackoverflow.com' },
    { id: 'demo-6', url: 'https://developer.chrome.com/docs/extensions', title: 'Chrome Extensions documentation', faviconUrl: '', closedAt: Date.now() - 1800000, domain: 'developer.chrome.com' },
    { id: 'demo-7', url: 'https://addons.mozilla.org/firefox/addon/aging-tabs', title: 'Aging Tabs – Get this Extension for Firefox', faviconUrl: '', closedAt: Date.now() - 3600000, domain: 'addons.mozilla.org' },
    { id: 'demo-8', url: 'https://www.typescriptlang.org/docs/', title: 'TypeScript: Documentation', faviconUrl: '', closedAt: Date.now() - 7200000, domain: 'typescriptlang.org' },
  ];

  await optionsPage.evaluate(async (data) => {
    try {
      await browser.runtime.sendMessage({ type: 'IMPORT_DATA', data });
    } catch {}
  }, JSON.stringify({ graveyard: graveyardEntries }));
  await optionsPage.waitForTimeout(500);

  // --- Screenshot 1: Popup with graveyard (dark mode) ---
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.emulateMedia({ colorScheme: 'dark' });
  await popup.setViewportSize({ width: 400, height: 520 });
  await popup.waitForTimeout(800);
  await popup.screenshot({ path: resolve(OUT, '01-popup-dark.png') });
  console.log('Screenshot 1: popup dark with graveyard');

  // --- Screenshot 2: Popup light mode ---
  await popup.emulateMedia({ colorScheme: 'light' });
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: resolve(OUT, '02-popup-light.png') });
  console.log('Screenshot 2: popup light');

  // --- Screenshot 3: Popup sorted by domain ---
  await popup.emulateMedia({ colorScheme: 'dark' });
  await popup.selectOption('#sort-mode', 'domain');
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: resolve(OUT, '03-popup-sorted-domain.png') });
  console.log('Screenshot 3: popup sorted by domain');

  // --- Screenshot 4: Popup with search ---
  await popup.selectOption('#sort-mode', 'recent');
  await popup.fill('#search', 'github');
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: resolve(OUT, '04-popup-search.png') });
  console.log('Screenshot 4: popup search');
  await popup.close();

  // --- Screenshot 5: Options page (dark) ---
  await optionsPage.emulateMedia({ colorScheme: 'dark' });
  await optionsPage.setViewportSize({ width: 1280, height: 900 });
  await optionsPage.waitForTimeout(500);
  await optionsPage.screenshot({ path: resolve(OUT, '05-options-dark.png'), fullPage: true });
  console.log('Screenshot 5: options dark');

  // --- Screenshot 6: Options page (light) ---
  await optionsPage.emulateMedia({ colorScheme: 'light' });
  await optionsPage.waitForTimeout(300);
  await optionsPage.screenshot({ path: resolve(OUT, '06-options-light.png'), fullPage: true });
  console.log('Screenshot 6: options light');

  await optionsPage.close();

  // Cleanup graveyard
  const cleanupPage = await context.newPage();
  await cleanupPage.goto(`chrome-extension://${extId}/options/options.html`);
  await cleanupPage.evaluate(async () => {
    try { await browser.runtime.sendMessage({ type: 'CLEAR_GRAVEYARD' }); } catch {}
  });
  await cleanupPage.close();

  await context.close();
  console.log(`\nDone! Screenshots in: ${OUT}`);
}

main().catch(err => { console.error(err); process.exit(1); });
