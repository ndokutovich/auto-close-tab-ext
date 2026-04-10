import browser from 'webextension-polyfill';
import { ensureReady, setupTabListeners } from './tab-tracker';
import { startTimer, onAlarmFired, setupNotificationListener } from './timer-manager';
import { setupMessageListener } from './messaging';
import { setupContextMenuListeners, createContextMenuItems, toggleLockForTab } from './context-menu';
import { syncBadge } from './graveyard';
import { setupHistorySyncListener } from './history-sync';
import { isRestrictedUrl } from '../shared/pure';

// Register all listeners synchronously at module load. MV3 requires this so
// wake-up events are not dropped before async init completes.
setupTabListeners();
setupMessageListener();
setupNotificationListener();
setupContextMenuListeners();
setupHistorySyncListener();
setupKeyboardShortcuts();
browser.alarms.onAlarm.addListener(onAlarmFired);

// Ensure the aging alarm exists on every SW load. startTimer is idempotent —
// if the alarm already exists (persisted across SW restarts), this is a cheap
// no-op. This guards against edge cases where the alarm was never created
// (e.g., onInstalled didn't fire reliably) without resetting the countdown.
startTimer().catch(err => console.error('[Aging Tabs] startTimer error:', err));

// Full initialization — only runs on browser startup or extension install/update,
// NOT on every SW wake-up. Alarms and context menus persist across SW restarts,
// so recreating them on each wake-up would reset timers and spam errors.
async function init(freshInstall: boolean): Promise<void> {
  try {
    await ensureReady(freshInstall);
    await startTimer();
    await syncBadge();
    if (freshInstall) {
      createContextMenuItems();
      browser.tabs.create({
        url: browser.runtime.getURL('options/options.html?welcome=1'),
      }).catch(() => {});
    }
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

// Full init only on real startup/install events. Regular SW wake-ups
// rely on lazy ensureReady() from inside event listeners.
browser.runtime.onStartup.addListener(() => init(false));
browser.runtime.onInstalled.addListener((details) => {
  init(details.reason === 'install');
  // Always recreate menu items on install/update (handles permission changes)
  createContextMenuItems();
});
