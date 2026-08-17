import browser from 'webextension-polyfill';
import { ensureReady, setupTabListeners, resetTimersForNewSession, markSessionLive } from './tab-tracker';
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
async function init(freshInstall: boolean, freshSession: boolean): Promise<void> {
  try {
    await ensureReady(freshInstall);
    // A genuine browser restart (or fresh install, or migration from an old
    // version) starts the session fresh: tab ids are reassigned on restore, so
    // persisted per-id timers/locks are not trustworthy. Done before content
    // injection so scripts paint from the reset state.
    if (freshSession) await resetTimersForNewSession(freshInstall);
    // Any init here comes from a real startup/install/update event, which
    // classifies the session as safe to close tabs in (resetTimersForNewSession
    // already marks it; this covers the no-reset update path).
    markSessionLive();
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
//
// onStartup = a genuine browser restart -> fresh session.
// onInstalled 'install' = fresh install -> fresh session.
// onInstalled 'update'/'chrome_update' = the browser stays open, tab ids remain
//   valid -> preserve timers and locks (a reset here would wipe them on every
//   auto-update).
browser.runtime.onStartup.addListener(() => init(false, true));
browser.runtime.onInstalled.addListener((details) => {
  const freshInstall = details.reason === 'install';
  // Migrate on an update from a version before the session-aware timer model:
  // its persisted timers may carry baked-in browser downtime that would age or
  // close tabs early. A same-model update preserves timers (freshSession false).
  const migrating = details.reason === 'update'
    && isOlderThan(details.previousVersion, SESSION_MODEL_VERSION);
  init(freshInstall, freshInstall || migrating);
  // Always recreate menu items on install/update (handles permission changes)
  createContextMenuItems();
});

// First version whose persisted timers follow the session-aware model. An
// update from anything older gets a one-time migration reset.
const SESSION_MODEL_VERSION = '1.4.0';

/** True when `a` is a strictly older dotted version than `b` (missing == older). */
function isOlderThan(a: string | undefined, b: string): boolean {
  if (!a) return true;
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db;
  }
  return false;
}
