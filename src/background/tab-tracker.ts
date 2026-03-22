import browser from 'webextension-polyfill';
import type { AgingStage } from '../shared/types';
import { getTabTimes, setTabTimes, getTabStages, setTabStages } from '../shared/storage';

// In-memory cache, flushed to storage periodically
let tabTimes: Record<number, number> = {};
let tabStages: Record<number, AgingStage> = {};
let initialized = false;

export async function initTracker(freshInstall = false): Promise<void> {
  if (initialized) return;

  // Load persisted state
  tabTimes = await getTabTimes();
  tabStages = await getTabStages();

  // Reconcile with currently open tabs
  const tabs = await browser.tabs.query({});
  const openIds = new Set(tabs.map(t => t.id!));

  // Remove entries for tabs that no longer exist
  for (const idStr of Object.keys(tabTimes)) {
    const id = Number(idStr);
    if (!openIds.has(id)) {
      delete tabTimes[id];
      delete tabStages[id];
    }
  }

  // Add entries for tabs we don't know about
  // On fresh install: reset ALL tabs to now (grace period — don't kill existing tabs)
  const now = Date.now();
  if (freshInstall) {
    for (const tab of tabs) {
      if (tab.id !== undefined) {
        tabTimes[tab.id] = now;
        tabStages[tab.id] = 0;
      }
    }
  } else {
    for (const tab of tabs) {
      if (tab.id !== undefined && !(tab.id in tabTimes)) {
        tabTimes[tab.id] = tab.lastAccessed ?? now;
      }
    }
  }

  await flush();
  initialized = true;
}

export function ensureLoaded(): boolean {
  return initialized;
}

// Called when Chrome kills the service worker and we need to reload from storage
export async function reloadFromStorage(): Promise<void> {
  tabTimes = await getTabTimes();
  tabStages = await getTabStages();
  initialized = true;
}

export function recordActivation(tabId: number): void {
  tabTimes[tabId] = Date.now();
  tabStages[tabId] = 0;
}

export function recordNewTab(tabId: number): void {
  tabTimes[tabId] = Date.now();
  tabStages[tabId] = 0;
}

export function removeTab(tabId: number): void {
  delete tabTimes[tabId];
  delete tabStages[tabId];
}

export function getLastAccessed(tabId: number): number | undefined {
  return tabTimes[tabId];
}

export function getStage(tabId: number): AgingStage {
  return tabStages[tabId] ?? 0;
}

export function setStage(tabId: number, stage: AgingStage): void {
  tabStages[tabId] = stage;
}

export function getAllTrackedTabIds(): number[] {
  return Object.keys(tabTimes).map(Number);
}

export async function flush(): Promise<void> {
  await setTabTimes(tabTimes);
  await setTabStages(tabStages);
}

// --- Event listeners ---

let currentActiveTabId: number | undefined;

export function setupTabListeners(): void {
  // Track initial active tab
  browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
    if (tabs[0]?.id) currentActiveTabId = tabs[0].id;
  });

  browser.tabs.onActivated.addListener(({ tabId }) => {
    // Update the tab we're LEAVING — its timer starts NOW, not when we arrived
    if (currentActiveTabId !== undefined && currentActiveTabId !== tabId) {
      recordActivation(currentActiveTabId);
    }

    // Update the tab we're ARRIVING at
    currentActiveTabId = tabId;
    recordActivation(tabId);
    browser.tabs.sendMessage(tabId, { type: 'RESET_AGING' }).catch(() => {});
  });

  browser.tabs.onCreated.addListener((tab) => {
    if (tab.id !== undefined) {
      recordNewTab(tab.id);
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    removeTab(tabId);
  });

  // Track URL changes as activity (user navigated)
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
      recordActivation(tabId);
      browser.tabs.sendMessage(tabId, { type: 'RESET_AGING' }).catch(() => {});
    }
  });
}
