import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extPath = resolve(__dirname, '../dist/chrome');
const outDir = resolve(__dirname, '../screenshots');
mkdirSync(outDir, { recursive: true });

async function main() {
  // Launch Chromium with the extension loaded
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
    viewport: { width: 1280, height: 800 },
  });

  const page = context.pages()[0] || await context.newPage();

  // Open several tabs to simulate usage
  const urls = [
    'https://github.com',
    'https://developer.mozilla.org',
    'https://news.ycombinator.com',
    'https://en.wikipedia.org/wiki/Browser_extension',
    'https://stackoverflow.com',
  ];

  for (const url of urls) {
    const tab = await context.newPage();
    await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  }

  // Wait a moment for tabs to settle
  await page.waitForTimeout(3000);

  // Screenshot 1: Multiple tabs open (the browser with several tabs)
  await page.bringToFront();
  await page.goto('about:blank');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(outDir, '01-tabs-open.png'), fullPage: false });
  console.log('Screenshot 1: tabs open');

  // Find the extension popup - need to find the extension ID first
  // Get the service worker to find the extension ID
  let extensionId = '';
  for (const sw of context.serviceWorkers()) {
    const url = sw.url();
    if (url.includes('chrome-extension://')) {
      extensionId = url.split('/')[2];
      break;
    }
  }

  if (!extensionId) {
    // Wait for service worker to register
    const sw = await context.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => null);
    if (sw) {
      extensionId = sw.url().split('/')[2];
    }
  }

  if (extensionId) {
    console.log('Extension ID:', extensionId);

    // Screenshot 2: Popup
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popupPage.waitForTimeout(1000);
    await popupPage.setViewportSize({ width: 400, height: 500 });
    await popupPage.screenshot({ path: resolve(outDir, '02-popup.png'), fullPage: false });
    console.log('Screenshot 2: popup');

    // Screenshot 3: Options page
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options/options.html`);
    await optionsPage.waitForTimeout(1000);
    await optionsPage.setViewportSize({ width: 1280, height: 800 });
    await optionsPage.screenshot({ path: resolve(outDir, '03-options.png'), fullPage: true });
    console.log('Screenshot 3: options');
  } else {
    console.log('Could not find extension ID - skipping popup/options screenshots');
  }

  await context.close();
  console.log('Done! Screenshots in:', outDir);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
