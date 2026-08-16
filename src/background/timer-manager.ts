import browser from 'webextension-polyfill';
import type { AgingStage, BgToContentMsg, Settings } from '../shared/types';
import { ALARM_NAME, CHECK_INTERVAL_SECONDS, MAX_STAGE } from '../shared/constants';
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

  const settings = await getSettings();

  // Graveyard auto-expiry runs even while paused — it's a privacy cleanup,
  // not tab aging. Leaving it behind the pause gate would let entries pile up
  // for days if the user forgets to unpause.
  await pruneExpiredEntries(settings.graveyardRetentionDays);

  // Globally paused — skip stage progression and closures entirely.
  // Timers will resume from frozen state when unpaused.
  if (isPaused()) return;

  await runAgingExclusive(settings, { force: false, closeExpired: true });
}

type AgingVisuals = Pick<Settings, 'faviconDimming' | 'titlePrefix' | 'titleBlink'>;

function visualsOf(settings: Settings): AgingVisuals {
  return {
    faviconDimming: settings.faviconDimming,
    titlePrefix: settings.titlePrefix,
    titleBlink: settings.titleBlink,
  };
}

// Serialize every aging pass. The alarm and a settings-triggered refresh both
// mutate shared tab-stage state across await points (and the paused repaint
// sends messages that must not interleave with a concurrent pass); without this
// they could interleave, one using stale settings and overwriting what the
// other just decided.
let agingChain: Promise<void> = Promise.resolve();
function serializeAging(fn: () => Promise<void>): Promise<void> {
  const task = agingChain.then(fn);
  agingChain = task.catch(() => {}); // never break the chain on error
  return task;
}
function runAgingExclusive(settings: Settings, opts: { force: boolean; closeExpired: boolean }): Promise<void> {
  return serializeAging(() => applyAging(settings, opts));
}

/**
 * Recompute every tracked tab's stage and, when it changed (or `force`), send
 * the update. Optionally close expired tabs. Always run via runAgingExclusive.
 *
 * `force` exists for settings changes: stage-delta gating means a plain repaint
 * would never reach an already-painted tab, so toggling a visual off (or a
 * stage-4 tab that will never transition again) would keep the old paint
 * forever. On a settings save we repaint unconditionally and skip closing.
 */
async function applyAging(
  settings: Settings,
  opts: { force: boolean; closeExpired: boolean },
): Promise<void> {
  const timeoutMs = settings.timeoutMinutes * 60 * 1000;
  const thresholdsMs = settings.stageThresholdMinutes
    ? settings.stageThresholdMinutes.map(m => m * 60 * 1000)
    : null;
  const visuals = visualsOf(settings);
  const now = Date.now();

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
      const changed = getStage(tabId) > 0;
      if (changed) setStage(tabId, 0);
      if ((changed || opts.force) && !tab.discarded) {
        sendAgingUpdate(tabId, 0, timeoutMs, visuals);
      }
      if (tab.title) cleanTitles.set(tabId, stripAgingPrefix(tab.title));
      continue;
    }

    const elapsed = now - lastAccessed;

    if (elapsed >= timeoutMs) {
      if (opts.closeExpired) tabsToClose.push(tabId);
      else if (opts.force) {
        // Not closing on this pass — record and repaint the terminal stage so
        // the tracker's stored stage matches what content shows (otherwise a
        // later immune pass sees stage 0 and never sends a reset).
        if (getStage(tabId) !== MAX_STAGE) setStage(tabId, MAX_STAGE);
        if (!tab.discarded) sendAgingUpdate(tabId, MAX_STAGE, 0, visuals);
      }
      continue;
    }

    const newStage = computeAgingStage(elapsed, timeoutMs, thresholdsMs);
    const oldStage = getStage(tabId);

    if (newStage < 4 && tab.title) {
      cleanTitles.set(tabId, stripAgingPrefix(tab.title));
    }

    if (newStage !== oldStage) setStage(tabId, newStage);
    if ((newStage !== oldStage || opts.force) && !tab.discarded) {
      sendAgingUpdate(tabId, newStage, timeoutMs - elapsed, visuals);
    }
  }

  if (opts.closeExpired) {
    let tabCount = immunityCtx.totalTabCount;
    for (const tabId of tabsToClose) {
      if (tabCount <= settings.minTabCount) break;
      try {
        const tab = tabMap.get(tabId);
        if (!tab) continue;

        // Re-check against live tracker state: an await earlier in this loop
        // (a previous buryTab/remove) may have yielded long enough for the user
        // to activate this queued tab, which resets its timer. Closing it on
        // the stale snapshot would kill a tab the user just returned to.
        const la = getLastAccessed(tabId);
        if (la === undefined || Date.now() - la < timeoutMs) continue;

        const cachedTitle = cleanTitles.get(tabId);

        if (settings.expireAction === 'discard') {
          if (typeof browser.tabs.discard === 'function') {
            if (tab.discarded) continue;
            await browser.tabs.discard(tabId);
          } else {
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
  }

  await flush();
  await saveCleanTitles();
}

/**
 * Immediately repaint every tab from current settings. Called after a settings
 * save so a toggled-off visual (or changed stage timings) reaches tabs at once
 * instead of waiting for a stage transition that may never come.
 */
export async function refreshVisualsForAllTabs(): Promise<void> {
  await ensureReady();
  const settings = await getSettings();
  if (isPaused()) {
    // Aging is frozen, so elapsed time is meaningless — repaint each tab at its
    // stored (frozen) stage with the new visuals, rather than skip. Without
    // this, disabling a visual while paused leaves painted tabs stuck until an
    // unpause plus a later stage transition. Serialized so it cannot interleave
    // with a concurrent aging pass.
    await serializeAging(() => repaintFrozenVisuals(settings));
    return;
  }
  await runAgingExclusive(settings, { force: true, closeExpired: false });
}

async function repaintFrozenVisuals(settings: Settings): Promise<void> {
  const visuals = visualsOf(settings);
  const timeoutMs = settings.timeoutMinutes * 60 * 1000;
  const allTabs = await browser.tabs.query({});
  const tabMap = new Map(allTabs.map(t => [t.id!, t]));
  const immunityCtx = buildImmunityContext(settings, allTabs, await getLockedTabs());
  for (const tabId of getAllTrackedTabIds()) {
    const tab = tabMap.get(tabId);
    if (!tab || tab.discarded) continue;
    // An immune tab (pinned/locked/whitelisted while paused) must show clean,
    // not its frozen aged stage — send stage 0 for it.
    const stage = isImmune(tab, immunityCtx) ? 0 : getStage(tabId);
    sendAgingUpdate(tabId, stage, timeoutMs, visuals);
  }
}

/**
 * The current aging message for one tab, for a freshly injected content script
 * that asks via CONTENT_READY. Returns null if the tab is not tracked, immune,
 * or aging is paused — nothing to paint.
 */
export async function currentAgingMessageFor(tabId: number): Promise<BgToContentMsg | null> {
  await ensureReady();
  if (isPaused()) return null;
  const lastAccessed = getLastAccessed(tabId);
  if (lastAccessed === undefined) return null;

  const settings = await getSettings();

  // An immune tab (pinned, locked, active, audible, whitelisted, or under the
  // min-tab floor) must not be painted — recompute immunity here, or a
  // long-unused pinned tab would get a stage-4 snapshot and start blinking.
  const allTabs = await browser.tabs.query({});
  const tab = allTabs.find(t => t.id === tabId);
  if (!tab) return null;
  const immunityCtx = buildImmunityContext(settings, allTabs, await getLockedTabs());
  if (isImmune(tab, immunityCtx)) return null;

  const timeoutMs = settings.timeoutMinutes * 60 * 1000;
  const thresholdsMs = settings.stageThresholdMinutes
    ? settings.stageThresholdMinutes.map(m => m * 60 * 1000)
    : null;
  const elapsed = Date.now() - lastAccessed;
  const stage = elapsed >= timeoutMs
    ? MAX_STAGE
    : computeAgingStage(elapsed, timeoutMs, thresholdsMs);
  return {
    type: 'UPDATE_AGING',
    stage,
    timeRemainingMs: Math.max(0, timeoutMs - elapsed),
    ...visualsOf(settings),
  };
}

function sendAgingUpdate(
  tabId: number,
  stage: AgingStage,
  timeRemainingMs: number,
  visuals: AgingVisuals,
): void {
  const message: BgToContentMsg = { type: 'UPDATE_AGING', stage, timeRemainingMs, ...visuals };
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
