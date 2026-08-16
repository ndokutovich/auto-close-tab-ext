import browser from 'webextension-polyfill';
import type { AgingStage } from '../shared/types';
import {
  getTabTimes, setTabTimes, getTabStages, setTabStages, unlockTab,
  getPausedSince, setPausedSince, getLockedTabs, setLockedTabs,
} from '../shared/storage';
import { shiftTabTimes } from '../shared/pure';
import {
  STORAGE_KEYS, SESSION_MARKER_KEY, CLASSIFY_ALARM_NAME,
  IDLE_DETECTION_SECONDS, MAX_TIME_SHIFT_MS,
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

// Whether this service worker's browser session has been classified as safe to
// close tabs in. False during the brief window at browser launch between the SW
// waking (e.g. an overdue alarm) and the onStartup reset — closing on stale,
// cross-session tab ids in that window could remove a restored tab. A recycle
// inside a live browser (session marker present) is classified live at once.
let sessionLive = false;
export function isSessionLive(): boolean {
  return sessionLive;
}

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

  // Classify the session. A present marker means this is a recycle inside a live
  // browser — safe to age/close immediately. Absent means we are the first SW of
  // a new session (launch/install/update); leave closing deferred until the
  // disambiguating event (onStartup resets; onInstalled classifies). If the API
  // is unavailable we cannot detect a recycle, so classify live to avoid ever
  // stalling aging (accepting the narrow launch-window risk on that platform).
  await detectRecycle();

  // In-session idle compensation. A genuine browser restart is handled by
  // resetTimersForNewSession (via runtime.onStartup), not here.
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

  // Add entries for tabs we don't know about.
  // On fresh install: reset ALL tabs to now (grace period — don't kill existing
  // tabs). Otherwise this is a service-worker start inside a live session, so
  // adopt each new tab's own last-access time. A genuine browser restart resets
  // everything separately via resetTimersForNewSession.
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
 * Detect whether this SW is a recycle (marker present) and stamp the marker for
 * future recycles this session. Sets sessionLive on a recycle, or when the API
 * is missing/errors (fall back to live rather than stall aging).
 */
async function detectRecycle(): Promise<void> {
  try {
    const session = browser.storage.session;
    if (!session) { sessionLive = true; return; }
    const existing = await session.get(SESSION_MARKER_KEY);
    if (existing?.[SESSION_MARKER_KEY] === true) sessionLive = true;
    await session.set({ [SESSION_MARKER_KEY]: true });
  } catch {
    sessionLive = true;
  }

  // Still unclassified (marker was absent): this is the first SW of a new
  // session. It is either a browser launch (onStartup will reset and classify)
  // or a case with no startup/install event at all — extension re-enable, or a
  // first worker that died before an event landed — where the browser is alive,
  // ids are valid, and closing is safe. Schedule a bounded fallback so closing
  // is never deferred for the whole session; a real launch classifies via
  // onStartup well before it fires.
  if (!sessionLive) {
    browser.alarms.create(CLASSIFY_ALARM_NAME, { delayInMinutes: 0.5 }).catch(() => {});
  }
}

/** Classify the session as live once a startup/install/update event resolves. */
export function markSessionLive(): void {
  sessionLive = true;
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
 * In-session compensation, run on every service-worker start.
 *
 * The browser never closed here (a genuine restart is handled separately by
 * resetTimersForNewSession, driven by runtime.onStartup), so tab ids are stable
 * and persisted per-id timers are trustworthy. Only give back a pending idle
 * span — the OS was idle/locked while the SW was last alive; pause settles on
 * unpause.
 */
async function compensateInactiveTime(now: number): Promise<void> {
  if (pausedSince !== null) return;

  if (idleSince !== null) {
    applyShift(now - idleSince, now);
    // Re-arm at `now` if still idle, else clear — a stale marker would make the
    // next idle -> active transition over-shift by the whole post-startup span.
    idleSince = (await isSystemIdle()) ? now : null;
    if (idleSince === null) {
      await browser.storage.local.remove(STORAGE_KEYS.IDLE_SINCE);
    } else {
      await browser.storage.local.set({ [STORAGE_KEYS.IDLE_SINCE]: idleSince });
    }
  }
}

/**
 * Start the current browser session fresh: reset every tracked tab to now /
 * stage 0, drop any stale idle marker, and clear locks.
 *
 * Called only from a genuine browser restart (runtime.onStartup) or a fresh
 * install. Across a restart the browser reassigns tab ids when it restores
 * tabs, so persisted per-id timers, stages, and locks may now point at
 * unrelated tabs — trusting them would let a reused id inherit an old tab's
 * timer (and close it) or an old lock (and freeze it). We cannot re-map them, so
 * we do not trust them. This also makes a long absence safe: nothing is charged.
 *
 * NOT called on an extension update/reload of the same version — the browser
 * stays open there, ids remain valid, and resetting would needlessly wipe timers
 * and locks. That distinction is why this is gated on onStartup, not on a
 * session marker (which the browser also clears on update/reload).
 *
 * Serialized through idleOpChain so it cannot interleave with an idle/pause
 * transition (which would otherwise re-arm idleSince just as we clear it), and
 * force-writes at the end so a concurrent aging flush that cleared `dirty` in
 * between cannot make the reset non-persistent.
 */
export function resetTimersForNewSession(): Promise<void> {
  const task = idleOpChain.then(async () => {
    await ensureReady();
    const now = Date.now();
    for (const id of Object.keys(tabTimes)) {
      tabTimes[Number(id)] = now;
      tabStages[Number(id)] = 0;
    }
    if (idleSince !== null) {
      idleSince = null;
      await browser.storage.local.remove(STORAGE_KEYS.IDLE_SINCE);
    }
    const locked = await getLockedTabs();
    if (locked.length > 0) await setLockedTabs([]);
    // Force-write: do not depend on `dirty`, which a racing flush may have
    // cleared after our mutation.
    await Promise.all([setTabTimes(tabTimes), setTabStages(tabStages)]);
    dirty = false;
    markSessionLive();
  });
  idleOpChain = task.catch(() => {}); // don't break the chain on error
  return task;
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
