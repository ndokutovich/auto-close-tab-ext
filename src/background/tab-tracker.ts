import browser from 'webextension-polyfill';
import type { AgingStage } from '../shared/types';
import { getTabTimes, setTabTimes, getTabStages, setTabStages, unlockTab } from '../shared/storage';

// In-memory cache, flushed to storage when dirty
let tabTimes: Record<number, number> = {};
let tabStages: Record<number, AgingStage> = {};
let initialized = false;
let dirty = false;
let idleSince: number | null = null;

let initPromise: Promise<void> | null = null;

export function ensureReady(freshInstall = false): Promise<void> {
  if (!initPromise) {
    initPromise = initTracker(freshInstall);
  }
  return initPromise;
}

export async function initTracker(freshInstall = false): Promise<void> {
  if (initialized) return;

  // Load persisted state
  tabTimes = await getTabTimes();
  tabStages = await getTabStages();
  
  const idleRes = await browser.storage.local.get('idleSince');
  idleSince = typeof idleRes.idleSince === 'number' ? idleRes.idleSince : null;

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

export function isLoaded(): boolean {
  return initialized;
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
  browser.tabs.onActivated.addListener(async ({ tabId }) => {
    await ensureReady();
    // Update the tab we're LEAVING — its timer starts NOW, not when we arrived
    const prev = currentActiveTabId;
    currentActiveTabId = tabId;

    const work = prev !== undefined && prev !== tabId
      ? recordActivation(prev).then(() => recordActivation(tabId))
      : recordActivation(tabId);

    work.catch(() => {});
    browser.tabs.sendMessage(tabId, { type: 'RESET_AGING' }).catch(() => {});
  });

  browser.tabs.onCreated.addListener(async (tab) => {
    await ensureReady();
    if (tab.id !== undefined) {
      recordNewTab(tab.id).catch(() => {});
    }
  });

  browser.tabs.onRemoved.addListener(async (tabId) => {
    await ensureReady();
    removeTab(tabId);
    unlockTab(tabId).catch(() => {});
  });

  // Track URL changes as activity (user navigated)
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    await ensureReady();
    if (changeInfo.url) {
      recordActivation(tabId).catch(() => {});
      browser.tabs.sendMessage(tabId, { type: 'RESET_AGING' }).catch(() => {});
    }
  });

  // Pause aging when system is idle/locked — we only age during active work time
  try {
    if (!browser.idle?.onStateChanged) return;

    browser.idle.setDetectionInterval(60);

    // Serialize all idle state transitions through a single chain to eliminate
    // the set/remove race when idle → active → idle fires in rapid succession.
    let idleOpChain: Promise<void> = Promise.resolve();

    browser.idle.onStateChanged.addListener((state) => {
      idleOpChain = idleOpChain.then(async () => {
        await ensureReady();
        if (state === 'active') {
          if (idleSince !== null) {
            const MAX_IDLE_SHIFT = 24 * 60 * 60 * 1000;
            const idleDuration = Math.max(0, Math.min(Date.now() - idleSince, MAX_IDLE_SHIFT));
            for (const idStr of Object.keys(tabTimes)) {
              tabTimes[Number(idStr)] += idleDuration;
            }
            dirty = true;
            idleSince = null;
            await browser.storage.local.remove('idleSince');
            await flush();
          }
        } else {
          if (idleSince === null) {
            idleSince = Date.now();
            await browser.storage.local.set({ idleSince });
          }
        }
      }).catch((err) => {
        console.warn('[Aging Tabs] idle handler error:', err);
      });
    });
  } catch {
    // idle API may not be available
  }
}
