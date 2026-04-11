import browser from 'webextension-polyfill';
import type { AgingStage } from '../shared/types';
import {
  getTabTimes, setTabTimes, getTabStages, setTabStages, unlockTab,
  getPausedSince, setPausedSince, getLockedTabs, setLockedTabs,
} from '../shared/storage';
import { shiftTabTimes } from '../shared/pure';
import { clearCachedTitle } from './timer-manager';

// In-memory cache, flushed to storage when dirty
let tabTimes: Record<number, number> = {};
let tabStages: Record<number, AgingStage> = {};
let initialized = false;
let dirty = false;
let idleSince: number | null = null;
let pausedSince: number | null = null;

let initPromise: Promise<void> | null = null;

// Serialize all operations that touch tabTimes/idleSince/pausedSince to avoid
// races between idle state transitions and pause/unpause. Used by both the
// idle.onStateChanged handler and setPause.
let idleOpChain: Promise<void> = Promise.resolve();

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

  pausedSince = await getPausedSince();

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

  // Prune locked tabs that no longer exist (stale IDs from previous sessions)
  const lockedTabs = await getLockedTabs();
  const prunedLocked = lockedTabs.filter(id => openIds.has(id));
  if (prunedLocked.length < lockedTabs.length) {
    await setLockedTabs(prunedLocked);
  }

  // Recover active tab from the query. The active tab is immune from closure
  // (immunity check), and onActivated will refresh its timer on the next switch.
  // No need to touch tabTimes here — preserves persisted state correctly.
  const activeTab = tabs.find(t => t.active);
  if (activeTab?.id) currentActiveTabId = activeTab.id;

  await flush();
  initialized = true;
}

export function isLoaded(): boolean {
  return initialized;
}

// --- Pause API ---

export function isPaused(): boolean {
  return pausedSince !== null;
}

export function getPausedSinceInternal(): number | null {
  return pausedSince;
}

export function getIdleSinceInternal(): number | null {
  return idleSince;
}

/**
 * Toggle the global pause state. On unpause, shifts all tabTimes forward
 * by the pause duration (capped at `now` for tabs activated during pause).
 *
 * Chained through idleOpChain to serialize with idle state transitions —
 * both modify tabTimes/idleSince, so concurrent execution could double-shift.
 */
export function setPause(paused: boolean): Promise<void> {
  const task = idleOpChain.then(async () => {
    await ensureReady();
    if (paused) {
      if (pausedSince !== null) return; // already paused
      pausedSince = Date.now();
      await setPausedSince(pausedSince);
    } else {
      if (pausedSince === null) return; // already running
      const now = Date.now();
      const shiftMs = Math.max(0, now - pausedSince);
      // Atomic sync block: update ALL in-memory state before any await.
      // Clearing both synchronously guarantees handlers see either "paused"
      // (early return) or "running with no pending idle" (no-op).
      //
      // Rationale for clearing idleSince (vs rewriting to `now`): clicking the
      // unpause button requires mouse movement, so the OS is guaranteed active
      // at this moment. A stale idleSince would otherwise break the next
      // idle→active compensation.
      shiftTabTimes(tabTimes, shiftMs, now);
      dirty = true;
      const hadStaleIdle = idleSince !== null;
      pausedSince = null;
      idleSince = null;
      // Now persist — in-memory state is already consistent.
      await setPausedSince(null);
      await flush();
      if (hadStaleIdle) {
        await browser.storage.local.remove('idleSince');
      }
    }
  });
  idleOpChain = task.catch(() => {}); // don't break the chain on error
  return task;
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
    clearCachedTitle(tabId);
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

    // idleOpChain is module-level — shared with setPause to serialize all
    // operations that touch tabTimes/idleSince/pausedSince.

    browser.idle.onStateChanged.addListener((state) => {
      idleOpChain = idleOpChain.then(async () => {
        await ensureReady();
        // While globally paused, pause handles all time accounting.
        // Idle tracking is suppressed to avoid double-compensation.
        if (pausedSince !== null) return;

        if (state === 'active') {
          if (idleSince !== null) {
            const MAX_IDLE_SHIFT = 24 * 60 * 60 * 1000;
            const now = Date.now();
            const idleDuration = Math.max(0, Math.min(now - idleSince, MAX_IDLE_SHIFT));
            shiftTabTimes(tabTimes, idleDuration, now);
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
