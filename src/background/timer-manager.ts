import browser from 'webextension-polyfill';
import type { AgingStage, BgToContentMsg, Settings } from '../shared/types';
import { ALARM_NAME, CHECK_INTERVAL_SECONDS, MAX_STAGE } from '../shared/constants';
import { getSettings } from '../shared/storage';
import {
  initTracker,
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
  // Clear any existing alarm
  await browser.alarms.clear(ALARM_NAME);

  // Create periodic alarm (minimum 30s in Chrome MV3)
  await browser.alarms.create(ALARM_NAME, {
    periodInMinutes: CHECK_INTERVAL_SECONDS / 60,
  });
}

export async function onAlarmFired(alarm: browser.Alarms.Alarm): Promise<void> {
  if (alarm.name !== ALARM_NAME) return;

  // Ensure tracker is loaded (service worker may have restarted)
  if (!ensureLoaded()) {
    await reloadFromStorage();
  }

  const settings = await getSettings();
  const timeoutMs = settings.timeoutMinutes * 60 * 1000;
  const now = Date.now();

  // Build immunity context once per check cycle
  const immunityCtx = await buildImmunityContext(settings);

  const trackedIds = getAllTrackedTabIds();
  const tabsToClose: number[] = [];

  for (const tabId of trackedIds) {
    const lastAccessed = getLastAccessed(tabId);
    if (lastAccessed === undefined) continue;

    // Get full tab info for immunity check
    let tab: browser.Tabs.Tab;
    try {
      tab = await browser.tabs.get(tabId);
    } catch {
      // Tab no longer exists
      continue;
    }

    if (isImmune(tab, immunityCtx)) {
      // Reset stage if it was aging
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

    // Compute aging stage (0-4)
    const ratio = elapsed / timeoutMs;
    const newStage = Math.min(MAX_STAGE, Math.floor(ratio * (MAX_STAGE + 1))) as AgingStage;
    const oldStage = getStage(tabId);

    if (newStage !== oldStage) {
      setStage(tabId, newStage);
      const timeRemaining = timeoutMs - elapsed;
      sendAgingUpdate(tabId, newStage, timeRemaining);
    }
  }

  // Close expired tabs (respecting minTabCount during closure)
  for (const tabId of tabsToClose) {
    // Re-check tab count since we might have closed some already
    const currentTabs = await browser.tabs.query({ currentWindow: true });
    if (currentTabs.length <= settings.minTabCount) break;

    try {
      const tab = await browser.tabs.get(tabId);
      await buryTab(tab, settings.graveyardMaxSize);
      await browser.tabs.remove(tabId);
    } catch {
      // Tab already gone
    }
  }

  // Flush tracker state to storage
  await flush();
}

function sendAgingUpdate(tabId: number, stage: AgingStage, timeRemainingMs: number): void {
  const message: BgToContentMsg = {
    type: 'UPDATE_AGING',
    stage,
    timeRemainingMs,
  };
  browser.tabs.sendMessage(tabId, message).catch(() => {
    // Content script not injected (restricted page)
  });
}
