import browser from 'webextension-polyfill';
import type { AgingStage } from '../shared/types';
import {
  getTabTimes, setTabTimes, getTabStages, setTabStages, unlockTab,
  getPausedSince, setPausedSince, getLockedTabs, setLockedTabs, getLastTickAt,
} from '../shared/storage';
import { shiftTabTimes } from '../shared/pure';
import {
  STORAGE_KEYS, SESSION_MARKER_KEY, IDLE_DETECTION_SECONDS,
  DOWNTIME_THRESHOLD_MS, MAX_TIME_SHIFT_MS,
} from '../shared/constants';
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

  const idleRes = await browser.storage.local.get(STORAGE_KEYS.IDLE_SINCE);
  idleSince = typeof idleRes.idleSince === 'number' ? idleRes.idleSince : null;

  pausedSince = await getPausedSince();

  // Give back the time the tabs were not actually being neglected, before any
  // of it can be charged against them.
  await compensateInactiveTime(Date.now());

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

// --- Inactive-time compensation ---

/**
 * Shift every tracked tab forward by `spanMs`, i.e. hand back time that was
 * never active browsing. shiftTabTimes clamps each tab to `now`, so an
 * over-large span can only make tabs look freshly accessed — never stale.
 */
function applyShift(spanMs: number, now: number): void {
  const shift = Math.max(0, Math.min(spanMs, MAX_TIME_SHIFT_MS));
  if (shift === 0) return;
  shiftTabTimes(tabTimes, shift, now);
  dirty = true;
}

/**
 * True when this is the first service worker of a new browser session.
 *
 * `storage.session` lives and dies with the browser profile, so an absent
 * marker means the browser itself restarted — as opposed to the service worker
 * merely being recycled, which MV3 does every ~30 seconds of inactivity.
 * Without this distinction a throttled alarm would look identical to downtime
 * and hand back time to tabs in a browser that never closed.
 *
 * If the API is unavailable the heartbeat threshold alone decides.
 */
async function consumeBrowserSessionMarker(): Promise<boolean> {
  try {
    const session = browser.storage.session;
    if (!session) return true;
    const existing = await session.get(SESSION_MARKER_KEY);
    await session.set({ [SESSION_MARKER_KEY]: true });
    return existing?.[SESSION_MARKER_KEY] !== true;
  } catch {
    return true;
  }
}

async function isSystemIdle(): Promise<boolean> {
  try {
    if (!browser.idle?.queryState) return false;
    return (await browser.idle.queryState(IDLE_DETECTION_SECONDS)) !== 'active';
  } catch {
    return false;
  }
}

/**
 * Aging measures active browsing time, not wall-clock time. Two spans that
 * elapse before startup are not active time and must be given back:
 *
 *   - a pending idle span — the OS was idle/locked when the browser last ran
 *   - browser downtime — the gap since the last heartbeat, i.e. the browser
 *     was not running at all
 *
 * The spans nest rather than add up: a pause covers everything inside it, and
 * an idle span left open at shutdown already covers the downtime that followed.
 * Applying more than one would shift twice, so the widest pending span wins and
 * the narrower ones stand down.
 */
async function compensateInactiveTime(now: number): Promise<void> {
  // Always consume the marker, even on paths that shift nothing — leaving it
  // unset would make the next service-worker recycle look like a restart.
  const browserRestarted = await consumeBrowserSessionMarker();

  // Pause settles its own span on unpause, downtime inside it included.
  if (pausedSince !== null) return;

  if (idleSince !== null) {
    applyShift(now - idleSince, now);
    // Consume the marker. The idle handler only arms it when null, so leaving a
    // stale one behind would make the next idle -> active transition shift by
    // the entire working period since startup on top of the real idle span.
    // Re-arm at `now` if the OS is still idle, so the ongoing span is not lost.
    idleSince = (await isSystemIdle()) ? now : null;
    if (idleSince === null) {
      await browser.storage.local.remove(STORAGE_KEYS.IDLE_SINCE);
    } else {
      await browser.storage.local.set({ [STORAGE_KEYS.IDLE_SINCE]: idleSince });
    }
    return;
  }

  // Only a genuine browser restart can have produced downtime. A recycled
  // service worker inside a live browser has not missed any real time.
  if (!browserRestarted) return;

  const lastTick = await getLastTickAt();
  if (lastTick === null) {
    // No heartbeat and a genuine restart: either a fresh install (no tabs
    // tracked yet — reset is a no-op) or an upgrade from a version without the
    // heartbeat, carrying stale wall-clock timers. We cannot measure the
    // downtime, so treat it as a fresh start and reset tracked tabs to now
    // rather than charge a possibly week-long absence against them.
    for (const id of Object.keys(tabTimes)) {
      tabTimes[Number(id)] = now;
    }
    dirty = true;
    return;
  }
  const downtime = now - lastTick;
  if (downtime < DOWNTIME_THRESHOLD_MS) return; // shut down and reopened at once
  applyShift(downtime, now);
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
      const shiftMs = now - pausedSince;
      // Atomic sync block: update ALL in-memory state before any await.
      // Clearing both synchronously guarantees handlers see either "paused"
      // (early return) or "running with no pending idle" (no-op).
      //
      // Rationale for clearing idleSince (vs rewriting to `now`): clicking the
      // unpause button requires mouse movement, so the OS is guaranteed active
      // at this moment. A stale idleSince would otherwise break the next
      // idle→active compensation.
      applyShift(shiftMs, now);
      const hadStaleIdle = idleSince !== null;
      pausedSince = null;
      idleSince = null;
      // Now persist — in-memory state is already consistent.
      await setPausedSince(null);
      await flush();
      if (hadStaleIdle) {
        await browser.storage.local.remove(STORAGE_KEYS.IDLE_SINCE);
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

    browser.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);

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
            const now = Date.now();
            // Bounded by MAX_TIME_SHIFT_MS, not by a day: a machine left alone
            // for a week is idle for a week, and truncating the shift would
            // charge the remainder to the tabs (issue #1).
            applyShift(now - idleSince, now);
            idleSince = null;
            await browser.storage.local.remove(STORAGE_KEYS.IDLE_SINCE);
            await flush();
          }
        } else {
          if (idleSince === null) {
            idleSince = Date.now();
            await browser.storage.local.set({ [STORAGE_KEYS.IDLE_SINCE]: idleSince });
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
