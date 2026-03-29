import browser from 'webextension-polyfill';
import type { AgingStage } from '../shared/types';
import { getTabTimes, setTabTimes, getTabStages, setTabStages, unlockTab } from '../shared/storage';

// In-memory cache, flushed to storage when dirty
let tabTimes: Record<number, number> = {};
let tabStages: Record<number, AgingStage> = {};
let initialized = false;
let dirty = false;

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

  // Init active tab ID synchronously from the query we already have
  const activeTab = tabs.find(t => t.active);
  if (activeTab?.id) currentActiveTabId = activeTab.id;

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
  const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (activeTabs[0]?.id) currentActiveTabId = activeTabs[0].id;
  initialized = true;
}

export async function recordActivation(tabId: number): Promise<void> {
  tabTimes[tabId] = Date.now();
  tabStages[tabId] = 0;
  dirty = true;
  await flush();
}

export async function recordNewTab(tabId: number): Promise<void> {
  tabTimes[tabId] = Date.now();
  tabStages[tabId] = 0;
  dirty = true;
  await flush();
}

export function removeTab(tabId: number): void {
  delete tabTimes[tabId];
  delete tabStages[tabId];
  dirty = true;
}

export function getLastAccessed(tabId: number): number | undefined {
  return tabTimes[tabId];
}

export function getStage(tabId: number): AgingStage {
  return tabStages[tabId] ?? 0;
}

export function setStage(tabId: number, stage: AgingStage): void {
  tabStages[tabId] = stage;
  dirty = true;
}

export function getAllTrackedTabIds(): number[] {
  return Object.keys(tabTimes).map(Number);
}

export async function flush(): Promise<void> {
  if (!dirty) return;
  await Promise.all([setTabTimes(tabTimes), setTabStages(tabStages)]);
  dirty = false;
}

// --- Event listeners ---

let currentActiveTabId: number | undefined;

export function setupTabListeners(): void {
  browser.tabs.onActivated.addListener(({ tabId }) => {
    // Update the tab we're LEAVING — its timer starts NOW, not when we arrived
    const prev = currentActiveTabId;
    currentActiveTabId = tabId;

    const work = prev !== undefined && prev !== tabId
      ? recordActivation(prev).then(() => recordActivation(tabId))
      : recordActivation(tabId);

    work.catch(() => {});
    browser.tabs.sendMessage(tabId, { type: 'RESET_AGING' }).catch(() => {});
  });

  browser.tabs.onCreated.addListener((tab) => {
    if (tab.id !== undefined) {
      recordNewTab(tab.id).catch(() => {});
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    removeTab(tabId);
    unlockTab(tabId).catch(() => {});
  });

  // Track URL changes as activity (user navigated)
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
      recordActivation(tabId).catch(() => {});
      browser.tabs.sendMessage(tabId, { type: 'RESET_AGING' }).catch(() => {});
    }
  });

  // Pause aging when system is idle/locked — we only age during active work time
  try {
    if (!browser.idle?.onStateChanged) return;

    let idleSince: number | null = null;
    browser.idle.setDetectionInterval(60);

    browser.idle.onStateChanged.addListener((state) => {
      if (state === 'active') {
        if (idleSince !== null) {
          const MAX_IDLE_SHIFT = 24 * 60 * 60 * 1000;
          const idleDuration = Math.max(0, Math.min(Date.now() - idleSince, MAX_IDLE_SHIFT));
          for (const idStr of Object.keys(tabTimes)) {
            tabTimes[Number(idStr)] += idleDuration;
          }
          dirty = true;
          idleSince = null;
        }
      } else {
        if (idleSince === null) {
          idleSince = Date.now();
        }
      }
    });
  } catch {
    // idle API may not be available
  }
}
