/**
 * Pause feature integration tests — verifies that setPause() correctly
 * freezes and resumes aging timers across the tab-tracker module.
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
        remove: vi.fn(async (keys: string | string[]) => {
          const list = typeof keys === 'string' ? [keys] : keys;
          for (const k of list) delete store[k];
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

describe('pause integration', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('setPause(true) writes pausedSince to storage', async () => {
    // Seed two tabs with known timestamps
    const T0 = Date.now() - 10_000;
    store['tabTimes'] = { 1: T0, 2: T0 };
    store['tabStages'] = { 1: 1, 2: 1 };

    const tracker = await import('../background/tab-tracker');
    const browser = (await import('webextension-polyfill')).default;
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 1, active: false, pinned: false, url: 'https://a.com' } as any,
      { id: 2, active: true, pinned: false, url: 'https://b.com' } as any,
    ]);

    await tracker.initTracker();
    expect(tracker.isPaused()).toBe(false);

    await tracker.setPause(true);

    expect(tracker.isPaused()).toBe(true);
    expect(typeof store['pausedSince']).toBe('number');
  });

  it('setPause(false) shifts tabTimes by pause duration (preserving elapsed)', async () => {
    // Seed: pausedSince is 5 seconds ago, tabs last accessed 15 seconds ago
    const now = Date.now();
    const PAUSED_SINCE = now - 5_000;
    const LAST_ACCESSED = now - 15_000;

    store['tabTimes'] = { 42: LAST_ACCESSED };
    store['tabStages'] = { 42: 0 };
    store['pausedSince'] = PAUSED_SINCE;

    const tracker = await import('../background/tab-tracker');
    const browser = (await import('webextension-polyfill')).default;
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 42, active: true, pinned: false, url: 'https://example.com' } as any,
    ]);

    await tracker.initTracker();
    expect(tracker.isPaused()).toBe(true);

    // At the time of init, elapsed-active = PAUSED_SINCE - LAST_ACCESSED = 10_000
    // After unpause, elapsed-active should still be ~10_000 regardless of pause duration.
    const elapsedActiveBeforeUnpause = PAUSED_SINCE - LAST_ACCESSED;

    await tracker.setPause(false);

    expect(tracker.isPaused()).toBe(false);
    expect(store['pausedSince']).toBeUndefined();

    const newLastAccessed = tracker.getLastAccessed(42)!;
    const elapsedActiveAfterUnpause = Date.now() - newLastAccessed;

    // Allow small delta for test execution time
    expect(Math.abs(elapsedActiveAfterUnpause - elapsedActiveBeforeUnpause)).toBeLessThan(500);
  });

  it('setPause(true) is idempotent — second call does not overwrite pausedSince', async () => {
    const tracker = await import('../background/tab-tracker');

    await tracker.initTracker();
    await tracker.setPause(true);
    const firstPausedSince = store['pausedSince'];

    await new Promise(r => setTimeout(r, 15));

    await tracker.setPause(true);
    const secondPausedSince = store['pausedSince'];

    expect(secondPausedSince).toBe(firstPausedSince);
  });

  it('setPause(false) is idempotent when not paused', async () => {
    const tracker = await import('../background/tab-tracker');
    await tracker.initTracker();

    expect(tracker.isPaused()).toBe(false);
    await tracker.setPause(false); // no-op
    expect(tracker.isPaused()).toBe(false);
    expect(store['pausedSince']).toBeUndefined();
  });

  it('pause state persists across re-init (simulating SW restart)', async () => {
    {
      const tracker = await import('../background/tab-tracker');
      await tracker.initTracker();
      await tracker.setPause(true);
      expect(tracker.isPaused()).toBe(true);
    }

    // Simulate SW death + restart
    vi.resetModules();

    {
      const tracker = await import('../background/tab-tracker');
      await tracker.initTracker();
      expect(tracker.isPaused()).toBe(true); // state restored from storage
    }
  });

  it('tabs activated DURING pause are not shifted into the future on resume', async () => {
    const now = Date.now();
    const PAUSED_SINCE = now - 20_000; // paused 20 seconds ago
    // Tab 7 was last accessed 5 seconds ago (DURING the pause)
    const MID_PAUSE_ACCESS = now - 5_000;

    store['tabTimes'] = { 7: MID_PAUSE_ACCESS };
    store['tabStages'] = { 7: 0 };
    store['pausedSince'] = PAUSED_SINCE;

    const tracker = await import('../background/tab-tracker');
    const browser = (await import('webextension-polyfill')).default;
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 7, active: true, pinned: false, url: 'https://example.com' } as any,
    ]);

    await tracker.initTracker();
    await tracker.setPause(false);

    const newLastAccessed = tracker.getLastAccessed(7)!;
    // Should be clamped to approximately `now` — the tab is "fresh"
    expect(newLastAccessed).toBeLessThanOrEqual(Date.now());
    expect(Date.now() - newLastAccessed).toBeLessThan(500);
  });

  it('setPause(false) atomically clears pausedSince and idleSince (race regression)', async () => {
    // REGRESSION: setPause(false) is not serialized through idleOpChain, so it
    // can interleave with the idle handler on await boundaries. The bug version
    // cleared pausedSince and idleSince in separate sync blocks with awaits
    // between them:
    //   sync: pausedSince = null
    //   await setPausedSince(null)            <-- YIELD
    //   await flush()                         <-- YIELD
    //   if (idleSince !== null) idleSince = null; await remove('idleSince')
    // An idle handler running concurrently could observe pausedSince === null
    // while idleSince was still stale, and apply an (over-)shift on top of the
    // pause shift.
    //
    // This test verifies the atomic invariant: at the moment the first
    // storage-write triggered by setPause(false) happens (remove 'pausedSince'),
    // the in-memory idleSince must ALREADY be null.
    const now = Date.now();
    store['idleSince'] = now - 3_600_000;
    store['pausedSince'] = now - 1_000;
    store['tabTimes'] = { 1: now - 500 };
    store['tabStages'] = { 1: 0 };

    const tracker = await import('../background/tab-tracker');
    const browser = (await import('webextension-polyfill')).default;
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 1, active: true, pinned: false, url: 'https://x.com' } as any,
    ]);
    await tracker.initTracker();

    let observedIdleSinceAtPausedSinceWrite: number | null | 'not-seen' = 'not-seen';
    vi.mocked(browser.storage.local.remove).mockImplementation(async (keys: any) => {
      const list = typeof keys === 'string' ? [keys] : keys;
      if (list.includes('pausedSince')) {
        observedIdleSinceAtPausedSinceWrite = tracker.getIdleSinceInternal();
      }
      for (const k of list) delete store[k];
    });

    await tracker.setPause(false);

    expect(observedIdleSinceAtPausedSinceWrite).toBeNull();
  });

  it('setPause(false) clears stale idleSince instead of rewriting it to now', async () => {
    // REGRESSION (Codex P1): on resume, idleSince was rewritten to `now`.
    // The idle handler only updates idleSince when it is null, so the next
    // idle → active cycle would shift tabs by (work_after_resume + real_idle)
    // instead of just real_idle — over-shifting by the entire post-resume
    // work interval.
    //
    // Scenario: system went idle → user paused → became active during pause
    // (the idle handler early-returns while paused, so idleSince stays stale)
    // → user resumed. At that moment the OS is definitely active (clicking
    // the unpause button requires mouse movement), so idleSince must be
    // cleared to null — not rewritten — so the next real idle event can set
    // a fresh timestamp.
    const now = Date.now();
    store['idleSince'] = now - 3_600_000;      // idle started 1 hour ago
    store['pausedSince'] = now - 1_800_000;    // paused 30 minutes ago
    store['tabTimes'] = { 1: now - 7_200_000 };
    store['tabStages'] = { 1: 0 };

    const tracker = await import('../background/tab-tracker');
    const browser = (await import('webextension-polyfill')).default;
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 1, active: true, pinned: false, url: 'https://example.com' } as any,
    ]);

    await tracker.initTracker();
    expect(tracker.isPaused()).toBe(true);

    await tracker.setPause(false);

    // Must be cleared, not rewritten to now
    expect(store['idleSince']).toBeUndefined();
  });
});
