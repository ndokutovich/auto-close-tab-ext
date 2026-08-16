/**
 * Startup reconciliation of aging state (GitHub issue #1 and its follow-ups).
 *
 * The extension ages tabs by *active* browsing time, not wall-clock time, and
 * distinguishes two ways the background can start:
 *
 *   - A service-worker recycle inside a live browser (an ordinary SW start, or
 *     an extension update/reload): tab ids are stable, so persisted per-id
 *     timers/stages/locks still refer to the same tabs. initTracker preserves
 *     them and only gives back a pending idle span; pause settles on unpause.
 *
 *   - A genuine browser restart (runtime.onStartup) or a fresh install: the
 *     browser reassigns tab ids when it restores tabs, so persisted per-id state
 *     may point at unrelated tabs. resetTimersForNewSession starts fresh —
 *     resets every tab to now/stage-0 and clears locks — which also makes a long
 *     absence safe (issue #1). The user's pause intent is preserved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const store: Record<string, unknown> = {};
// storage.session: present marker == recycle in a live browser; cleared on
// restart/update. Used by detectRecycle to classify the session.
const sessionStore: Record<string, unknown> = {};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

let idleState: 'active' | 'idle' | 'locked' = 'active';

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
      session: {
        get: vi.fn(async (key: string) => (key in sessionStore ? { [key]: sessionStore[key] } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) sessionStore[k] = v;
        }),
      },
    },
    tabs: {
      query: vi.fn(async () => []),
      sendMessage: vi.fn(async () => {}),
    },
    alarms: {
      get: vi.fn(async () => undefined),
      create: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
    },
    notifications: {
      clear: vi.fn(async () => {}),
    },
    idle: {
      setDetectionInterval: vi.fn(),
      onStateChanged: { addListener: vi.fn() },
      queryState: vi.fn(async () => idleState),
    },
  },
}));

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Seed one tab, last touched `agoMs` before now. */
function seedTab(id: number, agoMs: number): number {
  const t = Date.now() - agoMs;
  store['tabTimes'] = { [id]: t };
  store['tabStages'] = { [id]: 0 };
  return t;
}

async function loadTracker(tabId: number) {
  const tracker = await import('../background/tab-tracker');
  const browser = (await import('webextension-polyfill')).default;
  vi.mocked(browser.tabs.query).mockResolvedValue([
    { id: tabId, active: true, pinned: false, url: 'https://example.com' } as any,
  ]);
  return tracker;
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  idleState = 'active';
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Service-worker recycle / live session: initTracker preserves per-id state ---

describe('in-session start (service-worker recycle)', () => {
  it('preserves timers on a service-worker recycle', async () => {
    const touched = seedTab(1, 2 * HOUR);

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    expect(tracker.getLastAccessed(1)).toBe(touched);
  });

  it('preserves locks on a service-worker recycle', async () => {
    seedTab(1, 5 * MINUTE);
    store['lockedTabs'] = [1];

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    expect(store['lockedTabs']).toEqual([1]);
  });

  it('adds a newly opened tab with its own last-access time', async () => {
    store['tabTimes'] = {};
    store['tabStages'] = {};

    const tracker = await import('../background/tab-tracker');
    const browser = (await import('webextension-polyfill')).default;
    const la = Date.now() - 3 * MINUTE;
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 9, active: false, pinned: false, url: 'https://a.com', lastAccessed: la } as any,
    ]);

    await tracker.initTracker();

    expect(tracker.getLastAccessed(9)).toBe(la);
  });

  it('compensates a pending idle span', async () => {
    seedTab(1, 4 * HOUR);
    store['idleSince'] = Date.now() - 3 * HOUR;
    idleState = 'active';

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    // The 3h idle span is shifted away; ~1h of pre-idle active time remains.
    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(Math.abs(elapsed - 1 * HOUR)).toBeLessThan(1000);
  });

  it('clears a settled idle span when the system is active', async () => {
    idleState = 'active';
    seedTab(1, 2 * HOUR);
    store['idleSince'] = Date.now() - 1 * HOUR;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    expect(store['idleSince']).toBeUndefined();
    expect(tracker.getIdleSinceInternal()).toBeNull();
  });

  it('re-arms the idle span when the system is still idle', async () => {
    idleState = 'idle';
    seedTab(1, 2 * HOUR);
    store['idleSince'] = Date.now() - 1 * HOUR;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    const armed = tracker.getIdleSinceInternal();
    expect(armed).not.toBeNull();
    expect(Math.abs(Date.now() - armed!)).toBeLessThan(1000);
  });

  it('compensates an idle span longer than a day', async () => {
    seedTab(1, 7 * DAY);
    store['idleSince'] = Date.now() - 7 * DAY;
    idleState = 'active';

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(elapsed).toBeLessThan(1000);
  });

  it('stands down while paused, settling on unpause', async () => {
    const touched = seedTab(1, 3 * HOUR);
    store['pausedSince'] = Date.now() - 2 * HOUR;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    expect(tracker.getLastAccessed(1)).toBe(touched); // frozen while paused

    await tracker.setPause(false);
    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(Math.abs(elapsed - 1 * HOUR)).toBeLessThan(1000);
  });

  it('survives a missing idle API (Safari without the idle permission)', async () => {
    const browser = (await import('webextension-polyfill')).default;
    (browser as any).idle = undefined;

    const touched = seedTab(1, 10 * MINUTE);

    const tracker = await loadTracker(1);
    await expect(tracker.initTracker()).resolves.not.toThrow();

    expect(tracker.getLastAccessed(1)).toBe(touched);
  });
});

// --- Browser restart / fresh install: resetTimersForNewSession starts fresh ---

describe('new-session reset (browser restart / fresh install)', () => {
  it('resets tab timers and stages', async () => {
    // A per-id timer may now point at an unrelated restored tab — do not trust it.
    seedTab(1, 30 * DAY);
    store['tabStages'] = { 1: 4 };

    const tracker = await loadTracker(1);
    await tracker.resetTimersForNewSession();

    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(elapsed).toBeLessThan(1000);
    expect(tracker.getStage(1)).toBe(0);
  });

  it('a month-long absence does not close tabs (issue #1)', async () => {
    seedTab(1, 30 * DAY);

    const tracker = await loadTracker(1);
    await tracker.resetTimersForNewSession();

    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(elapsed).toBeLessThan(1000);
  });

  it('clears locks (lock keyed by an ephemeral tab id)', async () => {
    seedTab(1, 5 * MINUTE);
    store['lockedTabs'] = [1, 42];

    const tracker = await loadTracker(1);
    await tracker.resetTimersForNewSession();

    expect(store['lockedTabs']).toEqual([]);
  });

  it('clears a stale idle marker', async () => {
    seedTab(1, HOUR);
    store['idleSince'] = Date.now() - 2 * HOUR;

    const tracker = await loadTracker(1);
    await tracker.resetTimersForNewSession();

    expect(store['idleSince']).toBeUndefined();
    expect(tracker.getIdleSinceInternal()).toBeNull();
  });

  it('keeps the user pause intent but still resets timers', async () => {
    seedTab(1, 30 * DAY);
    store['pausedSince'] = Date.now() - 2 * HOUR;

    const tracker = await loadTracker(1);
    await tracker.resetTimersForNewSession();

    expect(tracker.isPaused()).toBe(true);          // pause survives the restart
    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(elapsed).toBeLessThan(1000);             // but timers are fresh
  });

  it('initializes the tracker itself if called before initTracker', async () => {
    seedTab(1, 30 * DAY);

    const tracker = await import('../background/tab-tracker');
    const browser = (await import('webextension-polyfill')).default;
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 1, active: false, pinned: false, url: 'https://a.com' } as any,
    ]);

    await tracker.resetTimersForNewSession();

    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(elapsed).toBeLessThan(1000);
  });
});

// --- Session classification: gate closing until the session is known ---

describe('session classification', () => {
  it('classifies a recycle (marker present) as live immediately', async () => {
    sessionStore['swSessionAlive'] = true;
    seedTab(1, 5 * MINUTE);

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    expect(tracker.isSessionLive()).toBe(true);
  });

  it('leaves the session unclassified on the first init of a launch (marker absent)', async () => {
    // No marker yet: this could be a launch (reset pending via onStartup) — do
    // not classify live, so closing is deferred until the event resolves.
    seedTab(1, 5 * MINUTE);

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    expect(tracker.isSessionLive()).toBe(false);
    // The marker is now stamped so the NEXT recycle is classified at once.
    expect(sessionStore['swSessionAlive']).toBe(true);
  });

  it('becomes live after the new-session reset (onStartup path)', async () => {
    seedTab(1, 5 * MINUTE);

    const tracker = await loadTracker(1);
    await tracker.initTracker();
    expect(tracker.isSessionLive()).toBe(false);

    await tracker.resetTimersForNewSession();
    expect(tracker.isSessionLive()).toBe(true);
  });

  it('can be marked live without a reset (no-reset update path)', async () => {
    seedTab(1, 5 * MINUTE);

    const tracker = await loadTracker(1);
    await tracker.initTracker();
    expect(tracker.isSessionLive()).toBe(false);

    tracker.markSessionLive();
    expect(tracker.isSessionLive()).toBe(true);
  });

  it('classifies live after the grace window via an aging tick (event-less start)', async () => {
    vi.useFakeTimers();
    try {
      seedTab(1, 5 * MINUTE);

      const { onAlarmFired } = await import('../background/timer-manager');
      const tracker = await import('../background/tab-tracker');
      const browser = (await import('webextension-polyfill')).default;
      vi.mocked(browser.tabs.query).mockResolvedValue([
        { id: 1, active: false, pinned: false, url: 'https://a.com' } as any,
      ]);

      await tracker.initTracker();
      expect(tracker.isSessionLive()).toBe(false);

      // Past the grace window with no startup/install event.
      vi.setSystemTime(Date.now() + 60_000);
      await onAlarmFired({ name: 'aging-tabs-check' } as any);

      expect(tracker.isSessionLive()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT classify live within the grace window (protects the launch race)', async () => {
    vi.useFakeTimers();
    try {
      seedTab(1, 5 * MINUTE);

      const { onAlarmFired } = await import('../background/timer-manager');
      const tracker = await import('../background/tab-tracker');
      const browser = (await import('webextension-polyfill')).default;
      vi.mocked(browser.tabs.query).mockResolvedValue([
        { id: 1, active: false, pinned: false, url: 'https://a.com' } as any,
      ]);

      await tracker.initTracker();

      // An aging tick well within the grace window must not classify live —
      // onStartup's reset may still be pending on a genuine launch.
      vi.setSystemTime(Date.now() + 5_000);
      await onAlarmFired({ name: 'aging-tabs-check' } as any);

      expect(tracker.isSessionLive()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to live when storage.session is unavailable', async () => {
    const browser = (await import('webextension-polyfill')).default;
    (browser.storage as any).session = undefined;
    seedTab(1, 5 * MINUTE);

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    // Cannot detect a recycle — classify live rather than stall aging forever.
    expect(tracker.isSessionLive()).toBe(true);
  });
});
