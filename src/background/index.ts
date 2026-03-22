import browser from 'webextension-polyfill';
import { initTracker, setupTabListeners } from './tab-tracker';
import { startTimer, onAlarmFired } from './timer-manager';
import { setupMessageListener } from './messaging';
import { syncBadge } from './graveyard';

async function init(freshInstall = false): Promise<void> {
  await initTracker(freshInstall);
  setupTabListeners();
  setupMessageListener();
  await startTimer();
  await syncBadge();
  await injectContentScripts();
  console.log('[Aging Tabs] Background initialized', freshInstall ? '(fresh install — grace period active)' : '');
}

// Inject content script into all existing tabs that don't have it yet
async function injectContentScripts(): Promise<void> {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    // Skip restricted URLs where we can't inject
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('about:') ||
        tab.url.startsWith('chrome-extension://') || tab.url.startsWith('moz-extension://')) {
      continue;
    }
    try {
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['browser-polyfill.js', 'content.js'],
      });
    } catch {
      // Tab might not allow injection — skip silently
    }
  }
}

// Service worker / background script startup
init();

// Handle alarms
browser.alarms.onAlarm.addListener(onAlarmFired);

// Re-init on browser startup (restores state after restart)
browser.runtime.onStartup.addListener(async () => {
  await init();
});

// Handle extension install/update
browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('[Aging Tabs] Fresh install — all existing tabs get a grace period');
    await init(true);
  } else {
    await init();
  }
});
