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
    },
    idle: {},
  },
}));

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
    const tracker = await load([{ id: 5, active: false, url: 'https://a.com' }]);
    await tracker.initTracker();

    expect(tracker.getVisitedTabIds()).not.toContain(5);
    await tracker.markVisited(5);

    expect(tracker.getVisitedTabIds()).toContain(5);
    expect(store['visitedTabs']).toEqual([5]);
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
