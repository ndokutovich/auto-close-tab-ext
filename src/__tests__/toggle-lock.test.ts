/**
 * BUG REPRO: toggleLockForTab used to do check-then-act without serialization.
 * Rapid clicks (menu + hotkey) could race: both handlers read `locked = false`,
 * both call lockTab → net effect "locked" instead of expected toggle.
 *
 * After the fix, ops are serialized per tabId via a Promise chain, so concurrent
 * calls apply sequentially and the second call sees the first's result.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const lockedSet = new Set<number>();

vi.mock('../shared/storage', () => ({
  isTabLocked: vi.fn(async (id: number) => lockedSet.has(id)),
  lockTab: vi.fn(async (id: number) => {
    // Simulate storage latency so races are observable
    await new Promise(r => setTimeout(r, 5));
    lockedSet.add(id);
    return [...lockedSet];
  }),
  unlockTab: vi.fn(async (id: number) => {
    await new Promise(r => setTimeout(r, 5));
    lockedSet.delete(id);
    return [...lockedSet];
  }),
}));

vi.mock('../shared/i18n', () => ({
  msg: (k: string) => k,
}));

vi.mock('webextension-polyfill', () => ({
  default: { contextMenus: undefined },
}));

describe('toggleLockForTab serialization', () => {
  beforeEach(() => {
    lockedSet.clear();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('two concurrent toggles on the same tab produce two toggle results', async () => {
    const { toggleLockForTab } = await import('../background/context-menu');

    // Fire both concurrently — without serialization both would read
    // `locked=false` and both would call lockTab → both return `true`.
    const [r1, r2] = await Promise.all([
      toggleLockForTab(42),
      toggleLockForTab(42),
    ]);

    // With serialization: first returns true (locked), second returns false (unlocked).
    expect(r1).toBe(true);
    expect(r2).toBe(false);
    expect(lockedSet.has(42)).toBe(false);
  });

  it('three rapid toggles on the same tab end up locked', async () => {
    const { toggleLockForTab } = await import('../background/context-menu');

    const results = await Promise.all([
      toggleLockForTab(7),
      toggleLockForTab(7),
      toggleLockForTab(7),
    ]);

    expect(results).toEqual([true, false, true]);
    expect(lockedSet.has(7)).toBe(true);
  });

  it('different tabs do not block each other', async () => {
    const { toggleLockForTab } = await import('../background/context-menu');

    const [a, b] = await Promise.all([
      toggleLockForTab(1),
      toggleLockForTab(2),
    ]);

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(lockedSet.has(1)).toBe(true);
    expect(lockedSet.has(2)).toBe(true);
  });
});
