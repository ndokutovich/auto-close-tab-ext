import browser from 'webextension-polyfill';
import { initTracker, setupTabListeners } from './tab-tracker';
import { startTimer, onAlarmFired, setupNotificationListener } from './timer-manager';
import { setupMessageListener } from './messaging';
import { syncBadge } from './graveyard';
import { isRestrictedUrl } from '../shared/pure';

let listenersRegistered = false;

async function init(freshInstall = false): Promise<void> {
  await initTracker(freshInstall);

  // Guard against double-registering listeners on re-init
  if (!listenersRegistered) {
    setupTabListeners();
    setupMessageListener();
    setupNotificationListener();
    browser.alarms.onAlarm.addListener(onAlarmFired);
    listenersRegistered = true;
  }

  await startTimer();
  await syncBadge();
  await injectContentScripts();
}

async function injectContentScripts(): Promise<void> {
  const tabs = await browser.tabs.query({});
  const eligible = tabs.filter(t => t.id && t.url && !isRestrictedUrl(t.url));
  await Promise.allSettled(
    eligible.map(t =>
      browser.scripting.executeScript({
        target: { tabId: t.id! },
        files: ['browser-polyfill.js', 'content.js'],
      })
    )
  );
}

// Service worker / background script startup
init();

// Re-init on browser startup (restores state after restart)
browser.runtime.onStartup.addListener(() => init());

// Handle extension install/update
browser.runtime.onInstalled.addListener((details) => {
  init(details.reason === 'install');
});
