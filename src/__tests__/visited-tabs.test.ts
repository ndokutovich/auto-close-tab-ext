/**
 * The visited-tabs lifecycle in tab-tracker (for the "protect unvisited" feature):
 * marked on activation, unvisited on create, pruned on remove/reconcile, and
 * seeded/cleared on a new-session reset per reprotectRestoredTabs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const store: Record<string, unknown> = {};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      local: {
        get: vi.fn(async (keys: any) => {
          if (keys === null) return clone(store);
          const keyList = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
          const result: Record<string, unknown> = {};
          for (const k of keyList) if (k in store) result[k] = clone(store[k]);
          return result;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store[k] = clone(v);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const list = typeof keys === 'string' ? [keys] : keys;
          for (const k of list) delete store[k];
        }),
      },
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
      },
    },
    tabs: {
      query: vi.fn(async () => []),
      sendMessage: vi.fn(async () => {}),
      onActivated: { addListener: vi.fn((fn: any) => { activatedHandler = fn; }) },
      onCreated: { addListener: vi.fn() },
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
    },
    idle: { onStateChanged: { addListener: vi.fn() }, setDetectionInterval: vi.fn() },
  },
}));

let activatedHandler: ((info: { tabId: number }) => any) | null = null;

function setSettings(over: Record<string, unknown>) {
  store['settings'] = { ...(store['settings'] as object || {}), ...over };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.clearAllMocks();
  vi.resetModules();
});
afterEach(() => vi.restoreAllMocks());

async function load(openTabs: any[]) {
  const tracker = await import('../background/tab-tracker');
  const browser = (await import('webextension-polyfill')).default;
  vi.mocked(browser.tabs.query).mockResolvedValue(openTabs as any);
  return tracker;
}

describe('visited-tabs lifecycle', () => {
  it('markVisited adds a tab and persists it', async () => {
    store['visitedTabs'] = []; // key present == not first run; tab 5 stays unvisited
    const tracker = await load([{ id: 5, active: false, url: 'https://a.com' }]);
    await tracker.initTracker();

    expect(tracker.getVisitedTabIds()).not.toContain(5);
    await tracker.markVisited(5);

    expect(tracker.getVisitedTabIds()).toContain(5);
    expect(store['visitedTabs']).toEqual([5]);
  });

  it('seeds open tabs visited when the key is absent (first run / upgrade)', async () => {
    // No visitedTabs key (e.g. an update from a version before the feature).
    // Existing open tabs must be treated as visited, not retroactively protected.
    store['tabTimes'] = { 1: Date.now(), 2: Date.now() };
    const tracker = await load([
      { id: 1, active: false, url: 'https://a.com' },
      { id: 2, active: false, url: 'https://b.com' },
    ]);
    await tracker.initTracker();

    expect(new Set(tracker.getVisitedTabIds())).toEqual(new Set([1, 2]));
    expect(store['visitedTabs']).toBeDefined();
  });

  it('does not re-seed when the key is present but empty (reprotect-cleared)', async () => {
    store['visitedTabs'] = []; // deliberately cleared
    const tracker = await load([{ id: 1, active: false, url: 'https://a.com' }]);
    await tracker.initTracker();

    expect(tracker.getVisitedTabIds()).toEqual([]);
  });

  it('first activation resets the timer AND marks visited (no expired+visited window)', async () => {
    // An unvisited tab with an already-expired timer. On activation it must end
    // up BOTH visited AND with a fresh timer — never visited-while-expired, which
    // would let an aging pass close the tab the user just opened.
    const EXPIRED = Date.now() - 60 * 60 * 1000;
    store['visitedTabs'] = [];
    store['tabTimes'] = { 5: EXPIRED };
    store['tabStages'] = { 5: 4 };

    const tracker = await load([{ id: 5, active: true, url: 'https://a.com' }]);
    await tracker.initTracker();
    tracker.setupTabListeners();
    expect(activatedHandler).toBeTypeOf('function');
    expect(tracker.getVisitedTabIds()).not.toContain(5);

    await activatedHandler!({ tabId: 5 });

    expect(tracker.getVisitedTabIds()).toContain(5);           // now visited
    const elapsed = Date.now() - tracker.getLastAccessed(5)!;  // and timer fresh
    expect(elapsed).toBeLessThan(1000);
    expect(store['visitedTabs']).toContain(5);                 // and persisted
  });

  it('persists visited even if the timer flush fails (independent write)', async () => {
    store['visitedTabs'] = [];
    store['tabTimes'] = { 1: Date.now(), 5: Date.now() };

    const tracker = await load([
      { id: 1, active: false, url: 'https://a.com' },
      { id: 5, active: true, url: 'https://b.com' },
    ]);
    await tracker.initTracker();
    tracker.setupTabListeners();

    // Make the timer-persist path (setTabTimes) reject; the visited write must
    // still land, so a recycle would not reload the tab as unvisited.
    const browser = (await import('webextension-polyfill')).default;
    const realSet = browser.storage.local.set;
    (browser.storage.local.set as any) = vi.fn(async (items: Record<string, unknown>) => {
      if ('tabTimes' in items) throw new Error('timer write failed');
      return (realSet as any)(items);
    });
    try {
      // Switch from tab 1 (prev) to unvisited tab 5.
      await activatedHandler!({ tabId: 1 });
      await activatedHandler!({ tabId: 5 });
      await new Promise(r => setTimeout(r, 0));

      expect(store['visitedTabs']).toContain(5);
    } finally {
      browser.storage.local.set = realSet;
    }
  });

  it('does not wedge init when the visited-key read fails (falls back to seed)', async () => {
    store['tabTimes'] = { 1: Date.now() };
    const browser = (await import('webextension-polyfill')).default;
    const realGet = browser.storage.local.get;
    (browser.storage.local.get as any) = vi.fn(async (keys: any) => {
      if (keys === 'visitedTabs') throw new Error('read failed');
      return (realGet as any)(keys);
    });
    try {
      const tracker = await import('../background/tab-tracker');
      vi.mocked(browser.tabs.query).mockResolvedValue([
        { id: 1, active: false, url: 'https://a.com' } as any,
      ]);

      // Must resolve, not reject (a rejected initPromise would wedge ensureReady).
      await expect(tracker.initTracker()).resolves.not.toThrow();
      // Safe direction: the open tab is seeded visited.
      expect(tracker.getVisitedTabIds()).toContain(1);
    } finally {
      browser.storage.local.get = realGet;
    }
  });

  it('a newly created tab is not visited', async () => {
    const tracker = await load([]);
    await tracker.initTracker();

    await tracker.recordNewTab(7);
    expect(tracker.getVisitedTabIds()).not.toContain(7);
  });

  it('removeTab drops the tab from the visited set', async () => {
    const tracker = await load([{ id: 5, active: false, url: 'https://a.com' }]);
    await tracker.initTracker();
    await tracker.markVisited(5);

    tracker.removeTab(5);
    expect(tracker.getVisitedTabIds()).not.toContain(5);
  });

  it('init prunes visited ids whose tabs are no longer open', async () => {
    store['visitedTabs'] = [5, 99]; // 99 is gone
    store['tabTimes'] = { 5: Date.now() };
    const tracker = await load([{ id: 5, active: false, url: 'https://a.com' }]);
    await tracker.initTracker();

    expect(tracker.getVisitedTabIds()).toEqual([5]);
  });

  it('reset seeds all open tabs as visited when reprotectRestoredTabs is off', async () => {
    store['tabTimes'] = { 1: Date.now(), 2: Date.now() };
    setSettings({ reprotectRestoredTabs: false });
    const tracker = await load([
      { id: 1, active: false, url: 'https://a.com' },
      { id: 2, active: false, url: 'https://b.com' },
    ]);
    await tracker.resetTimersForNewSession(/* freshInstall */ false);

    expect(new Set(tracker.getVisitedTabIds())).toEqual(new Set([1, 2]));
  });

  it('restart clears visited when reprotectRestoredTabs is on', async () => {
    store['tabTimes'] = { 1: Date.now(), 2: Date.now() };
    store['visitedTabs'] = [1, 2];
    setSettings({ reprotectRestoredTabs: true });
    const tracker = await load([
      { id: 1, active: false, url: 'https://a.com' },
      { id: 2, active: false, url: 'https://b.com' },
    ]);
    await tracker.resetTimersForNewSession(/* freshInstall */ false);

    expect(tracker.getVisitedTabIds()).toEqual([]);
  });

  it('fresh install always seeds visited even with reprotectRestoredTabs on', async () => {
    store['tabTimes'] = { 1: Date.now() };
    setSettings({ reprotectRestoredTabs: true });
    const tracker = await load([{ id: 1, active: false, url: 'https://a.com' }]);
    await tracker.resetTimersForNewSession(/* freshInstall */ true);

    expect(tracker.getVisitedTabIds()).toContain(1);
  });
});
