import browser from 'webextension-polyfill';
import { initTracker, setupTabListeners } from './tab-tracker';
import { startTimer, onAlarmFired } from './timer-manager';
import { setupMessageListener } from './messaging';
import { syncBadge } from './graveyard';

async function init(): Promise<void> {
  await initTracker();
  setupTabListeners();
  setupMessageListener();
  await startTimer();
  await syncBadge();
  console.log('[Aging Tabs] Background initialized');
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
    console.log('[Aging Tabs] Extension installed');
  }
  await init();
});
