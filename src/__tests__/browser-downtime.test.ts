/**
 * Startup reconciliation of aging state (GitHub issue #1 and its follow-ups).
 *
 * The extension ages tabs by *active* browsing time, not wall-clock time. The
 * trust boundary is the browser session, detected by a storage.session marker
 * that survives a service-worker recycle but not a browser restart:
 *
 *   - Recycle (marker present): the browser never closed, tab ids are stable,
 *     persisted per-id timers/stages/locks still refer to the same tabs. A
 *     pending idle span is given back; pause settles on unpause.
 *   - Restart (marker absent): a new session. Tab ids are reassigned on restore,
 *     so persisted per-id state may point at unrelated tabs. We start fresh —
 *     reset every tracked tab to now/stage-0 and clear locks — which also makes
 *     a long absence safe (issue #1). The user's pause intent is preserved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const store: Record<string, unknown> = {};
// Cleared by the browser on profile restart — that is the whole point of it.
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
        get: vi.fn(async (keys: any) => {
          const keyList = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
          const result: Record<string, unknown> = {};
          for (const k of keyList) {
            if (k in sessionStore) result[k] = clone(sessionStore[k]);
          }
          return result;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) sessionStore[k] = clone(v);
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

describe('startup reconciliation', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    // Empty session store == the browser just started (restart).
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];
    idleState = 'active';
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Browser restart (session marker absent): fresh start, no per-id trust ---

  it('resets tab timers on a browser restart', async () => {
    // ids are reassigned on restore, so a persisted per-id timer may now point
    // at an unrelated tab. Do not trust it — reset to now (and stage 0).
    seedTab(1, 30 * DAY);
    store['tabStages'] = { 1: 4 };

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(elapsed).toBeLessThan(1000);
    expect(tracker.getStage(1)).toBe(0);
  });

  it('a month-long absence does not close tabs on restart (issue #1)', async () => {
    seedTab(1, 30 * DAY);

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(elapsed).toBeLessThan(1000);
  });

  it('resets an open tab missing from storage on restart', async () => {
    // No persisted entry (created while disabled, or a missed write), open with
    // an old lastAccessed. Under a fresh-start restart it must be reset too, not
    // charged its stale lastAccessed while persisted peers reset.
    store['tabTimes'] = {};
    store['tabStages'] = {};

    const tracker = await import('../background/tab-tracker');
    const browser = (await import('webextension-polyfill')).default;
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 9, active: false, pinned: false, url: 'https://a.com', lastAccessed: Date.now() - 30 * DAY } as any,
    ]);

    await tracker.initTracker();

    const elapsed = Date.now() - tracker.getLastAccessed(9)!;
    expect(elapsed).toBeLessThan(1000);
  });

  it('clears locks on a browser restart (lock keyed by ephemeral id)', async () => {
    // A restored tab could reuse a formerly-locked id and inherit its lock,
    // becoming immune forever. Locks cannot be re-mapped across a restart.
    seedTab(1, 5 * MINUTE);
    store['lockedTabs'] = [1, 42];

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    expect(store['lockedTabs']).toEqual([]);
  });

  it('clears a stale idle marker on restart', async () => {
    seedTab(1, HOUR);
    store['idleSince'] = Date.now() - 2 * HOUR;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    expect(store['idleSince']).toBeUndefined();
    expect(tracker.getIdleSinceInternal()).toBeNull();
  });

  it('keeps the user pause intent across a restart but still resets timers', async () => {
    seedTab(1, 30 * DAY);
    store['pausedSince'] = Date.now() - 2 * HOUR;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    expect(tracker.isPaused()).toBe(true);          // pause survives the restart
    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(elapsed).toBeLessThan(1000);             // but timers are fresh
  });

  it('an alarm at startup on a fresh session resets rather than charges', async () => {
    // A persisted, overdue alarm can fire at startup. It must not age tabs on
    // the stale timers — init runs first and resets.
    seedTab(1, 30 * DAY);

    const { onAlarmFired } = await import('../background/timer-manager');
    const tracker = await import('../background/tab-tracker');
    const browser = (await import('webextension-polyfill')).default;
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 1, active: false, pinned: false, url: 'https://a.com' } as any,
    ]);

    await onAlarmFired({ name: 'aging-tabs-check' } as any);

    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(elapsed).toBeLessThan(1000);
  });

  // --- Service-worker recycle (marker present): live session, ids stable ---

  it('preserves timers on a service-worker recycle', async () => {
    const touched = seedTab(1, 2 * HOUR);
    sessionStore['swSessionAlive'] = true;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    expect(tracker.getLastAccessed(1)).toBe(touched);
  });

  it('preserves locks on a service-worker recycle', async () => {
    seedTab(1, 5 * MINUTE);
    store['lockedTabs'] = [1];
    sessionStore['swSessionAlive'] = true;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    expect(store['lockedTabs']).toEqual([1]);
  });

  it('compensates a pending idle span on recycle', async () => {
    // System went idle 3 hours ago inside a live browser; on recycle the idle
    // span is given back (tab looks freshly accessed).
    seedTab(1, 4 * HOUR);
    store['idleSince'] = Date.now() - 3 * HOUR;
    sessionStore['swSessionAlive'] = true;
    idleState = 'active';

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    // The 3h idle span is shifted away; ~1h of pre-idle active time remains.
    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(Math.abs(elapsed - 1 * HOUR)).toBeLessThan(1000);
  });

  it('clears a settled idle span when the system is active on recycle', async () => {
    idleState = 'active';
    seedTab(1, 2 * HOUR);
    store['idleSince'] = Date.now() - 1 * HOUR;
    sessionStore['swSessionAlive'] = true;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    expect(store['idleSince']).toBeUndefined();
    expect(tracker.getIdleSinceInternal()).toBeNull();
  });

  it('re-arms the idle span when the system is still idle on recycle', async () => {
    idleState = 'idle';
    seedTab(1, 2 * HOUR);
    store['idleSince'] = Date.now() - 1 * HOUR;
    sessionStore['swSessionAlive'] = true;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    const armed = tracker.getIdleSinceInternal();
    expect(armed).not.toBeNull();
    expect(Math.abs(Date.now() - armed!)).toBeLessThan(1000);
  });

  it('compensates an idle span longer than a day on recycle', async () => {
    seedTab(1, 7 * DAY);
    store['idleSince'] = Date.now() - 7 * DAY;
    sessionStore['swSessionAlive'] = true;
    idleState = 'active';

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(elapsed).toBeLessThan(1000);
  });

  it('stands down while paused on recycle, settling on unpause', async () => {
    const touched = seedTab(1, 3 * HOUR);
    store['pausedSince'] = Date.now() - 2 * HOUR;
    sessionStore['swSessionAlive'] = true;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    expect(tracker.getLastAccessed(1)).toBe(touched); // frozen while paused

    await tracker.setPause(false);
    // ~1h of pre-pause active time remains after the pause span is given back.
    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(Math.abs(elapsed - 1 * HOUR)).toBeLessThan(1000);
  });

  // --- Session marker plumbing ---

  it('arms the session marker so the next recycle is not mistaken for a restart', async () => {
    seedTab(1, 10 * MINUTE);

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    expect(sessionStore['swSessionAlive']).toBe(true);
  });

  it('survives a missing idle API (Safari has no idle permission)', async () => {
    const browser = (await import('webextension-polyfill')).default;
    (browser as any).idle = undefined;
    sessionStore['swSessionAlive'] = true;

    const touched = seedTab(1, 10 * MINUTE);

    const tracker = await loadTracker(1);
    await expect(tracker.initTracker()).resolves.not.toThrow();

    expect(tracker.getLastAccessed(1)).toBe(touched);
  });
});
