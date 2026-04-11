import browser from 'webextension-polyfill';
import type { AgingStage, BgToContentMsg } from '../shared/types';
import { ALARM_NAME, CHECK_INTERVAL_SECONDS } from '../shared/constants';
import { computeAgingStage, extractDomain, stripAgingPrefix } from '../shared/pure';
import { msg } from '../shared/i18n';
import { getSettings, getGraveyard, getLockedTabs } from '../shared/storage';
import {
  ensureReady,
  getAllTrackedTabIds,
  getLastAccessed,
  getStage,
  setStage,
  flush,
  isPaused,
} from './tab-tracker';
import { buildImmunityContext, isImmune } from './immunity';
import { buryTab, restoreTab, removeEntry, pruneExpiredEntries } from './graveyard';

// Cache clean titles for tabs before stage-4 blink replaces them with
// "Closing soon...". Updated each alarm tick for tabs at stages 0-3.
// Persisted to storage.local so SW restarts don't lose them.
const CLEAN_TITLES_KEY = 'cleanTitles';
let cleanTitles = new Map<number, string>();
let cleanTitlesLoaded = false;

async function loadCleanTitles(openTabIds: Set<number>): Promise<void> {
  if (cleanTitlesLoaded) return;
  cleanTitlesLoaded = true;
  try {
    const res = await browser.storage.local.get(CLEAN_TITLES_KEY);
    const stored = res[CLEAN_TITLES_KEY];
    if (stored && typeof stored === 'object') {
      // Prune stale entries from previous sessions (tabIds get recycled)
      for (const [k, v] of Object.entries(stored)) {
        const tabId = Number(k);
        if (openTabIds.has(tabId)) {
          cleanTitles.set(tabId, v as string);
        }
      }
    }
  } catch { /* first run or corrupt */ }
}

async function saveCleanTitles(): Promise<void> {
  const obj: Record<string, string> = {};
  for (const [k, v] of cleanTitles) obj[String(k)] = v;
  await browser.storage.local.set({ [CLEAN_TITLES_KEY]: obj }).catch(() => {});
}

/** Remove cached title when a tab is closed. */
export function clearCachedTitle(tabId: number): void {
  cleanTitles.delete(tabId);
}

export async function startTimer(): Promise<void> {
  // Alarms persist across SW restarts in MV3. Don't recreate if already scheduled —
  // recreation resets the countdown, so frequent SW wake-ups would indefinitely
  // delay the aging alarm from firing.
  const existing = await browser.alarms.get(ALARM_NAME);
  if (existing) return;
  await browser.alarms.create(ALARM_NAME, {
    periodInMinutes: CHECK_INTERVAL_SECONDS / 60,
  });
}

export async function onAlarmFired(alarm: browser.Alarms.Alarm): Promise<void> {
  // Short-circuit notification-clear alarms — they don't need tracker state
  if (alarm.name.startsWith('clear-notif-')) {
    const notifId = alarm.name.replace('clear-notif-', '');
    browser.notifications.clear(notifId).catch(() => {});
    return;
  }

  if (alarm.name !== ALARM_NAME) return;

  await ensureReady();

  // Globally paused — skip stage progression and closures entirely.
  // Timers will resume from frozen state when unpaused.
  if (isPaused()) return;

  const settings = await getSettings();
  const timeoutMs = settings.timeoutMinutes * 60 * 1000;
  const now = Date.now();

  // Single query for all tabs, build lookup map — avoids N+1 tabs.get() calls
  const allTabs = await browser.tabs.query({});
  const tabMap = new Map(allTabs.map(t => [t.id!, t]));
  const openTabIds = new Set(allTabs.map(t => t.id!));

  await loadCleanTitles(openTabIds);

  const lockedTabs = await getLockedTabs();
  const immunityCtx = buildImmunityContext(settings, allTabs, lockedTabs);

  const trackedIds = getAllTrackedTabIds();
  const tabsToClose: number[] = [];

  for (const tabId of trackedIds) {
    const lastAccessed = getLastAccessed(tabId);
    if (lastAccessed === undefined) continue;

    const tab = tabMap.get(tabId);
    if (!tab) continue;

    if (isImmune(tab, immunityCtx)) {
      if (getStage(tabId) > 0) {
        setStage(tabId, 0);
        sendAgingUpdate(tabId, 0, timeoutMs);
      }
      // Cache clean title while tab is immune / at stage 0
      if (tab.title) cleanTitles.set(tabId, stripAgingPrefix(tab.title));
      continue;
    }

    const elapsed = now - lastAccessed;

    if (elapsed >= timeoutMs) {
      tabsToClose.push(tabId);
      continue;
    }

    const newStage = computeAgingStage(elapsed, timeoutMs);
    const oldStage = getStage(tabId);

    // Cache clean title while still recoverable (before stage-4 blink)
    if (newStage < 4 && tab.title) {
      cleanTitles.set(tabId, stripAgingPrefix(tab.title));
    }

    if (newStage !== oldStage) {
      setStage(tabId, newStage);
      // Discarded tabs can't receive messages — skip the content script update
      if (!tab.discarded) {
        sendAgingUpdate(tabId, newStage, timeoutMs - elapsed);
      }
    }
  }

  // Handle expired tabs — close or discard based on setting
  let tabCount = immunityCtx.totalTabCount;
  for (const tabId of tabsToClose) {
    if (tabCount <= settings.minTabCount) break;
    try {
      const tab = tabMap.get(tabId);
      if (!tab) continue;

      const cachedTitle = cleanTitles.get(tabId);

      if (settings.expireAction === 'discard') {
        if (typeof browser.tabs.discard === 'function') {
          if (tab.discarded) continue; // already discarded — nothing to do
          await browser.tabs.discard(tabId);
        } else {
          // Safari doesn't support tabs.discard — fall back to close
          const entry = await buryTab(tab, settings.graveyardMaxSize, cachedTitle);
          await browser.tabs.remove(tabId);
          tabCount--;
          showCloseNotification(tab, entry.id);
        }
      } else {
        const entry = await buryTab(tab, settings.graveyardMaxSize, cachedTitle);
        await browser.tabs.remove(tabId);
        tabCount--;
        showCloseNotification(tab, entry.id);
      }
      cleanTitles.delete(tabId);
    } catch {
      // Tab already gone or can't be discarded
    }
  }

  await flush();
  await saveCleanTitles();

  // Auto-expiry: prune graveyard entries older than the retention limit
  await pruneExpiredEntries(settings.graveyardRetentionDays);
}

function sendAgingUpdate(tabId: number, stage: AgingStage, timeRemainingMs: number): void {
  const message: BgToContentMsg = { type: 'UPDATE_AGING', stage, timeRemainingMs };
  browser.tabs.sendMessage(tabId, message).catch(() => {});
}

const NOTIF_PREFIX = 'aging-tabs-closed-';

function showCloseNotification(tab: browser.Tabs.Tab, entryId: string): void {
  const notifId = NOTIF_PREFIX + entryId;
  const title = tab.title || 'Untitled';
  const domain = extractDomain(tab.url);

  browser.notifications.create(notifId, {
    type: 'basic',
    iconUrl: browser.runtime.getURL('icons/icon-128.png'),
    title: msg('notifTabClosed'),
    message: domain ? `${title} (${domain})` : title,
  }).catch((err: unknown) => {
    console.warn('[Aging Tabs] Notification failed:', err);
  });

  // Chrome clamps alarm delays to a 30s minimum in release builds, so 0.5 is the
  // smallest honored value. Serves as fallback if SW dies before setTimeout fires.
  const clearAlarmName = `clear-notif-${notifId}`;
  browser.alarms.create(clearAlarmName, { delayInMinutes: 0.5 });

  setTimeout(() => {
    browser.notifications.clear(notifId).catch(() => {});
    browser.alarms.clear(clearAlarmName).catch(() => {});
  }, 8000);
}

export function setupNotificationListener(): void {
  try {
    if (!browser.notifications?.onClicked) return;
    browser.notifications.onClicked.addListener(async (notifId: string) => {
      if (!notifId.startsWith(NOTIF_PREFIX)) return;
      const entryId = notifId.slice(NOTIF_PREFIX.length);

      const graveyard = await getGraveyard();
      const entry = graveyard.find(e => e.id === entryId);
      if (entry) {
        await restoreTab(entry.url);
        await removeEntry(entry.id);
      }
      browser.notifications.clear(notifId).catch(() => {});
    });
  } catch {
    // notifications may not be available
  }
}
