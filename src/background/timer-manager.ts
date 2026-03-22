import browser from 'webextension-polyfill';
import type { AgingStage, BgToContentMsg } from '../shared/types';
import { ALARM_NAME, CHECK_INTERVAL_SECONDS } from '../shared/constants';
import { computeAgingStage } from '../shared/pure';
import { getSettings } from '../shared/storage';
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
import { buryTab } from './graveyard';

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

  const immunityCtx = buildImmunityContext(settings, allTabs);

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

  // Close expired tabs, tracking count locally instead of re-querying
  let tabCount = immunityCtx.totalTabCount;
  for (const tabId of tabsToClose) {
    if (tabCount <= settings.minTabCount) break;
    try {
      const tab = tabMap.get(tabId);
      if (tab) {
        await buryTab(tab, settings.graveyardMaxSize);
        await browser.tabs.remove(tabId);
        tabCount--;
        showCloseNotification(tab);
      }
    } catch {
      // Tab already gone
    }
  }

  await flush();
}

function sendAgingUpdate(tabId: number, stage: AgingStage, timeRemainingMs: number): void {
  const message: BgToContentMsg = { type: 'UPDATE_AGING', stage, timeRemainingMs };
  browser.tabs.sendMessage(tabId, message).catch(() => {});
}

const NOTIF_PREFIX = 'aging-tabs-closed-';

function showCloseNotification(tab: browser.Tabs.Tab): void {
  const notifId = NOTIF_PREFIX + Date.now();
  const title = tab.title || 'Untitled';
  const domain = tab.url ? new URL(tab.url).hostname : '';

  browser.notifications.create(notifId, {
    type: 'basic',
    iconUrl: tab.favIconUrl || browser.runtime.getURL('icons/icon-48.svg'),
    title: 'Tab closed',
    message: `${title}\n${domain}`,
  }).catch(() => {});

  // Auto-clear after 8 seconds
  setTimeout(() => {
    browser.notifications.clear(notifId).catch(() => {});
  }, 8000);
}

// Click notification → restore tab
browser.notifications.onClicked.addListener(async (notifId: string) => {
  if (!notifId.startsWith(NOTIF_PREFIX)) return;

  // Restore the most recently closed tab from graveyard
  const { getGraveyard } = await import('../shared/storage');
  const graveyard = await getGraveyard();
  if (graveyard.length > 0) {
    const { restoreTab, removeEntry } = await import('./graveyard');
    const entry = graveyard[0];
    await restoreTab(entry.url);
    await removeEntry(entry.closedAt);
  }
  browser.notifications.clear(notifId).catch(() => {});
});
