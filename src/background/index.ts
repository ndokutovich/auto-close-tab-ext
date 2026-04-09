import browser from 'webextension-polyfill';
import { ensureReady, setupTabListeners } from './tab-tracker';
import { startTimer, onAlarmFired, setupNotificationListener } from './timer-manager';
import { setupMessageListener } from './messaging';
import { setupContextMenu, toggleLockForTab } from './context-menu';
import { syncBadge } from './graveyard';
import { isRestrictedUrl } from '../shared/pure';

// Register listeners synchronously to avoid dropped events in MV3 wake-ups
setupTabListeners();
setupMessageListener();
setupNotificationListener();
setupContextMenu();
setupKeyboardShortcuts();
browser.alarms.onAlarm.addListener(onAlarmFired);

async function init(freshInstall = false): Promise<void> {
  try {
    await ensureReady(freshInstall);
    await startTimer();
    await syncBadge();
  } catch (err) {
    console.error('[Aging Tabs] Init error:', err);
  }

  injectContentScripts();
}

function setupKeyboardShortcuts(): void {
  if (!browser.commands?.onCommand) return;
  browser.commands.onCommand.addListener(async (command: string) => {
    if (command === 'lock-current-tab') {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await toggleLockForTab(tab.id);
      }
    }
  });
}

async function injectContentScripts(): Promise<void> {
  try {
    if (!browser.scripting?.executeScript) return;
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
  } catch (err) {
    console.warn('[Aging Tabs] Content script injection failed:', err);
  }
}

// Service worker / background script startup
init();

// Re-init on browser startup
browser.runtime.onStartup.addListener(() => init());

// Handle extension install/update
browser.runtime.onInstalled.addListener((details) => {
  init(details.reason === 'install');
});
