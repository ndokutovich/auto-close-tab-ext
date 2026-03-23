import browser from 'webextension-polyfill';
import type { AgingStage, BgToContentMsg } from '../shared/types';
import { ALARM_NAME, CHECK_INTERVAL_SECONDS } from '../shared/constants';
import { computeAgingStage, extractDomain } from '../shared/pure';
import { msg } from '../shared/i18n';
import { getSettings, getGraveyard, getLockedTabs } from '../shared/storage';
import {
  ensureLoaded,
  reloadFromStorage,
  getAllTrackedTabIds,
  getLastAccessed,
  getStage,
  setStage,
  flush,
} from './tab-tracker';
import { buildImmunityContext, isImmune } from './immunity';
import { buryTab, restoreTab, removeEntry } from './graveyard';

export async function startTimer(): Promise<void> {
  await browser.alarms.clear(ALARM_NAME);
  await browser.alarms.create(ALARM_NAME, {
    periodInMinutes: CHECK_INTERVAL_SECONDS / 60,
  });
}

export async function onAlarmFired(alarm: browser.Alarms.Alarm): Promise<void> {
  if (alarm.name !== ALARM_NAME) return;

  if (!ensureLoaded()) {
    await reloadFromStorage();
  }

  const settings = await getSettings();
  const timeoutMs = settings.timeoutMinutes * 60 * 1000;
  const now = Date.now();

  // Single query for all tabs, build lookup map — avoids N+1 tabs.get() calls
  const allTabs = await browser.tabs.query({});
  const tabMap = new Map(allTabs.map(t => [t.id!, t]));

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
      continue;
    }

    const elapsed = now - lastAccessed;

    if (elapsed >= timeoutMs) {
      tabsToClose.push(tabId);
      continue;
    }

    const newStage = computeAgingStage(elapsed, timeoutMs);
    const oldStage = getStage(tabId);

    if (newStage !== oldStage) {
      setStage(tabId, newStage);
      sendAgingUpdate(tabId, newStage, timeoutMs - elapsed);
    }
  }

  // Handle expired tabs — close or discard based on setting
  let tabCount = immunityCtx.totalTabCount;
  for (const tabId of tabsToClose) {
    if (tabCount <= settings.minTabCount) break;
    try {
      const tab = tabMap.get(tabId);
      if (!tab) continue;

      if (settings.expireAction === 'discard') {
        await browser.tabs.discard(tabId);
      } else {
        const entry = await buryTab(tab, settings.graveyardMaxSize);
        await browser.tabs.remove(tabId);
        tabCount--;
        showCloseNotification(tab, entry.id);
      }
    } catch {
      // Tab already gone or can't be discarded
    }
  }

  await flush();
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
    iconUrl: browser.runtime.getURL('icons/icon-128.svg'),
    title: msg('notifTabClosed'),
    message: domain ? `${title} (${domain})` : title,
  }).catch((err: unknown) => {
    console.warn('[Aging Tabs] Notification failed:', err);
  });

  setTimeout(() => {
    browser.notifications.clear(notifId).catch(() => {});
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
