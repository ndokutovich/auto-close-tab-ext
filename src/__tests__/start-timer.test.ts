/**
 * BUG REPRO: startTimer() used to clear+recreate the alarm on every SW wake-up,
 * which reset the 30-second countdown. For users with frequent tab events,
 * the aging alarm would be indefinitely delayed and might never fire.
 *
 * After the fix, startTimer is idempotent — it checks alarms.get() first and
 * only creates the alarm if it doesn't already exist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const alarms: Record<string, { periodInMinutes?: number; delayInMinutes?: number }> = {};

vi.mock('webextension-polyfill', () => ({
  default: {
    alarms: {
      get: vi.fn(async (name: string) => alarms[name]),
      create: vi.fn(async (name: string, opts: any) => {
        alarms[name] = opts;
      }),
      clear: vi.fn(async (name: string) => {
        delete alarms[name];
      }),
    },
  },
}));

describe('startTimer idempotency', () => {
  beforeEach(() => {
    for (const k of Object.keys(alarms)) delete alarms[k];
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('creates the alarm on first call', async () => {
    const { startTimer } = await import('../background/timer-manager');
    const browser = (await import('webextension-polyfill')).default;

    await startTimer();

    expect(browser.alarms.create).toHaveBeenCalledTimes(1);
    expect(alarms['aging-tabs-check']).toBeDefined();
  });

  it('does NOT recreate the alarm on subsequent calls', async () => {
    const { startTimer } = await import('../background/timer-manager');
    const browser = (await import('webextension-polyfill')).default;

    await startTimer();
    await startTimer();
    await startTimer();

    // Only the first call should have invoked create
    expect(browser.alarms.create).toHaveBeenCalledTimes(1);
  });

  it('does not call clear (would reset the countdown)', async () => {
    const { startTimer } = await import('../background/timer-manager');
    const browser = (await import('webextension-polyfill')).default;

    await startTimer();
    await startTimer();

    expect(browser.alarms.clear).not.toHaveBeenCalled();
  });
});
