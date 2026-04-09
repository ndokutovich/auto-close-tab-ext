/**
 * BUG REPRO: recordActivation() resets in-memory state but never flushes
 * to storage. If the MV3 service worker dies before the next alarm tick,
 * init from storage loads stale timestamps — the tab jumps from stage 0
 * to a high stage, skipping all intermediate steps.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock browser.storage.local as a simple in-memory store ---

const store: Record<string, unknown> = {};

// Clone on get/set to mimic real browser.storage.local serialization boundary
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[] | Record<string, unknown> | null) => {
          if (keys === null) return clone(store);
          const keyList = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
          const result: Record<string, unknown> = {};
          for (const k of keyList) {
            if (k in store) result[k] = clone(store[k]);
          }
          return result;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) {
            store[k] = clone(v);
          }
        }),
      },
    },
    tabs: {
      query: vi.fn(async () => []),
      sendMessage: vi.fn(async () => {}),
    },
    idle: {},
  },
}));

describe('tab-tracker flush on activation', () => {
  beforeEach(() => {
    // Clear store and module cache before each test
    for (const key of Object.keys(store)) delete store[key];
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('BUG: recordActivation does not flush — service worker restart loses the reset', async () => {
    // Seed storage with a tab that has an OLD lastAccessed time (20 min ago)
    const OLD_TIME = Date.now() - 20 * 60 * 1000;
    store['tabTimes'] = { 42: OLD_TIME };
    store['tabStages'] = { 42: 3 }; // stage 3 — already aging

    // Dynamically import so the mock is applied
    const tracker = await import('../background/tab-tracker');
    const browser = (await import('webextension-polyfill')).default;

    // Simulate a single open tab so init doesn't prune our test tab
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 42, active: true, pinned: false, url: 'https://example.com' } as any,
    ]);

    await tracker.initTracker();

    // Verify the old time was loaded
    expect(tracker.getLastAccessed(42)).toBe(OLD_TIME);
    expect(tracker.getStage(42)).toBe(3);

    // User activates tab — this should reset timer to NOW and stage to 0
    await tracker.recordActivation(42);

    const timeAfterActivation = tracker.getLastAccessed(42)!;
    expect(timeAfterActivation).toBeGreaterThan(OLD_TIME);
    expect(tracker.getStage(42)).toBe(0);

    // NOW: simulate MV3 service worker death + restart
    // The key question: was the activation persisted to storage?
    const storedTimes = store['tabTimes'] as Record<number, number>;
    const storedStages = store['tabStages'] as Record<number, number>;

    // THIS IS THE BUG: storage still has the OLD values because flush was never called
    // After the fix, these should reflect the activation reset
    expect(storedTimes[42]).toBe(timeAfterActivation);  // FAILS before fix — still OLD_TIME
    expect(storedStages[42]).toBe(0);                     // FAILS before fix — still 3
  });
});
