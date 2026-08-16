/**
 * BUG REPRO (GitHub issue #1): time spent with the browser CLOSED was counted
 * as tab aging.
 *
 * The extension deliberately ages tabs by *active* time, not wall-clock time —
 * see the idle compensation in tab-tracker (`shiftTabTimes` on idle -> active).
 * But that compensation only covers downtime the browser was alive to observe.
 * When the browser is shut down entirely, no events fire, while `tabTimes`
 * holds wall-clock timestamps. On the next launch the whole offline period had
 * already been charged against every tab, so a machine used once a week found
 * every tab expired on startup.
 *
 * The fix persists a heartbeat (`lastTickAt`) on each alarm tick. On startup
 * the gap since the last heartbeat is treated exactly like idle time and fed
 * through the same `shiftTabTimes` machinery.
 *
 * Double-compensation guards: pause and idle already account for their own
 * spans, and both subsume the downtime, so the heartbeat shift must stand down
 * when either is pending.
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

describe('browser downtime compensation', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    // Empty session store == the browser just started.
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];
    idleState = 'active';
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not age tabs while the browser is closed', async () => {
    // Browser was down for 10 minutes: last heartbeat and last tab touch both
    // 10 minutes old. Active elapsed at shutdown was ~0.
    seedTab(1, 10 * MINUTE);
    store['lastTickAt'] = Date.now() - 10 * MINUTE;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(elapsed).toBeLessThan(500);
  });

  it('preserves elapsed active time accumulated before shutdown', async () => {
    // Tab untouched for 25 minutes, but the browser only ran for the first 5 —
    // it went down 20 minutes ago. Active elapsed must stay ~5 minutes.
    seedTab(1, 25 * MINUTE);
    store['lastTickAt'] = Date.now() - 20 * MINUTE;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(Math.abs(elapsed - 5 * MINUTE)).toBeLessThan(500);
  });

  it('compensates a month-long absence (issue #1 scenario)', async () => {
    // The reporter's machine: untouched for 30 days, browser down for all of it.
    seedTab(1, 30 * DAY);
    store['lastTickAt'] = Date.now() - 30 * DAY;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(elapsed).toBeLessThan(500);
  });

  it('ignores sub-threshold gaps (normal service-worker churn)', async () => {
    // A gap of one alarm interval is ordinary MV3 SW sleep, not downtime.
    const touched = seedTab(1, 5 * MINUTE);
    store['lastTickAt'] = Date.now() - 30_000;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    expect(tracker.getLastAccessed(1)).toBe(touched);
  });

  it('grace-resets pre-existing timers when there is no heartbeat (upgrade)', async () => {
    // No heartbeat means we cannot know how long the browser was down. An
    // upgrade from a version without the heartbeat carries stale wall-clock
    // timers; charging them could close everything on the first launch. With no
    // evidence, treat the restart as a fresh start and reset to now.
    seedTab(1, 30 * DAY);

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(elapsed).toBeLessThan(1000);
  });

  it('does not grace-reset a mere service-worker recycle with no heartbeat', async () => {
    // Same "no heartbeat" state, but the session marker proves the browser
    // never closed — so there is nothing to compensate and no reset.
    const touched = seedTab(1, 10 * MINUTE);
    sessionStore['swSessionAlive'] = true;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    expect(tracker.getLastAccessed(1)).toBe(touched);
  });

  it('an overdue startup alarm compensates before overwriting the heartbeat', async () => {
    // BUG (shipped v1.3.0): onAlarmFired wrote lastTickAt=now BEFORE ensureReady,
    // so a persisted missed alarm firing at startup erased the downtime evidence
    // that init had not yet read — and a week-away machine closed its tabs.
    seedTab(1, 30 * DAY);
    store['lastTickAt'] = Date.now() - 30 * DAY;
    // session marker absent => genuine restart

    const { onAlarmFired } = await import('../background/timer-manager');
    const tracker = await import('../background/tab-tracker');
    const browser = (await import('webextension-polyfill')).default;
    vi.mocked(browser.tabs.query).mockResolvedValue([
      { id: 1, active: false, pinned: false, url: 'https://a.com' } as any,
    ]);

    await onAlarmFired({ name: 'aging-tabs-check' } as any);

    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(elapsed).toBeLessThan(1000); // compensated, not charged 30 days
  });

  it('stands down while paused — pause accounting already covers the gap', async () => {
    // Paused 2 hours ago, browser down for 1 hour of that. Unpausing shifts by
    // the full pause span; an extra downtime shift would double-count.
    const touched = seedTab(1, 3 * HOUR);
    store['pausedSince'] = Date.now() - 2 * HOUR;
    store['lastTickAt'] = Date.now() - 1 * HOUR;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    expect(tracker.getLastAccessed(1)).toBe(touched);

    await tracker.setPause(false);

    // Only the 1 hour of active time before the pause should remain.
    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(Math.abs(elapsed - 1 * HOUR)).toBeLessThan(500);
  });

  it('stands down while idle is pending — the idle span subsumes the downtime', async () => {
    // System went idle 3 hours ago, browser closed 1 hour ago. The idle span
    // already covers the downtime; shifting by both would over-compensate.
    seedTab(1, 4 * HOUR);
    store['idleSince'] = Date.now() - 3 * HOUR;
    store['lastTickAt'] = Date.now() - 1 * HOUR;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    // Only the 1 active hour before going idle should remain.
    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(Math.abs(elapsed - 1 * HOUR)).toBeLessThan(500);
  });

  it('clears a settled idle span when the system is active on startup', async () => {
    idleState = 'active';
    seedTab(1, 2 * HOUR);
    store['idleSince'] = Date.now() - 1 * HOUR;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    // Consumed on startup — a stale marker would over-shift the next idle cycle.
    expect(store['idleSince']).toBeUndefined();
    expect(tracker.getIdleSinceInternal()).toBeNull();
  });

  it('re-arms the idle span when the system is still idle on startup', async () => {
    idleState = 'idle';
    seedTab(1, 2 * HOUR);
    store['idleSince'] = Date.now() - 1 * HOUR;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    // Still idle: the marker must restart from now so the ongoing idle period
    // is compensated on the next active transition, without recounting.
    const armed = tracker.getIdleSinceInternal();
    expect(armed).not.toBeNull();
    expect(Math.abs(Date.now() - armed!)).toBeLessThan(500);
  });

  it('compensates an idle span longer than a day (24h cap regression)', async () => {
    // The old MAX_IDLE_SHIFT of 24h truncated the shift, so a week-long absence
    // still aged tabs by 6 days.
    seedTab(1, 7 * DAY);
    store['idleSince'] = Date.now() - 7 * DAY;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(elapsed).toBeLessThan(500);
  });

  it('ignores the gap when only the service worker recycled', async () => {
    // REGRESSION GUARD: MV3 tears the SW down every ~30s of inactivity, and a
    // throttled alarm can leave a wide heartbeat gap inside a browser that
    // never closed. Treating that as downtime would hand time back on every
    // wake-up and stall aging entirely.
    const touched = seedTab(1, 2 * HOUR);
    store['lastTickAt'] = Date.now() - 1 * HOUR;
    sessionStore['swSessionAlive'] = true; // browser session still alive

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    expect(tracker.getLastAccessed(1)).toBe(touched);
  });

  it('arms the session marker so the next recycle is not mistaken for a restart', async () => {
    seedTab(1, 10 * MINUTE);
    store['lastTickAt'] = Date.now() - 10 * MINUTE;

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    expect(sessionStore['swSessionAlive']).toBe(true);
  });

  it('arms the session marker even when paused shifts nothing', async () => {
    store['pausedSince'] = Date.now() - HOUR;
    seedTab(1, 2 * HOUR);

    const tracker = await loadTracker(1);
    await tracker.initTracker();

    expect(sessionStore['swSessionAlive']).toBe(true);
  });

  it('survives a missing idle API (Safari has no idle permission)', async () => {
    const browser = (await import('webextension-polyfill')).default;
    (browser as any).idle = undefined;

    seedTab(1, 10 * MINUTE);
    store['lastTickAt'] = Date.now() - 10 * MINUTE;

    const tracker = await loadTracker(1);
    await expect(tracker.initTracker()).resolves.not.toThrow();

    const elapsed = Date.now() - tracker.getLastAccessed(1)!;
    expect(elapsed).toBeLessThan(500);
  });
});

describe('heartbeat persistence', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    // Empty session store == the browser just started.
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];
    idleState = 'active';
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('records a heartbeat on every aging alarm tick', async () => {
    const { onAlarmFired } = await import('../background/timer-manager');
    const browser = (await import('webextension-polyfill')).default;
    vi.mocked(browser.tabs.query).mockResolvedValue([]);

    await onAlarmFired({ name: 'aging-tabs-check' } as any);

    expect(typeof store['lastTickAt']).toBe('number');
    expect(Math.abs(Date.now() - (store['lastTickAt'] as number))).toBeLessThan(1000);
  });

  it('records a heartbeat even while paused', async () => {
    // Downtime detection must work across a pause, so the heartbeat cannot sit
    // behind the pause gate.
    store['pausedSince'] = Date.now() - HOUR;

    const { onAlarmFired } = await import('../background/timer-manager');
    const browser = (await import('webextension-polyfill')).default;
    vi.mocked(browser.tabs.query).mockResolvedValue([]);

    await onAlarmFired({ name: 'aging-tabs-check' } as any);

    expect(typeof store['lastTickAt']).toBe('number');
  });

  it('does not record a heartbeat for unrelated alarms', async () => {
    const { onAlarmFired } = await import('../background/timer-manager');

    await onAlarmFired({ name: 'clear-notif-abc' } as any);

    expect(store['lastTickAt']).toBeUndefined();
  });
});
