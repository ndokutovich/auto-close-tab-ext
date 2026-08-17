/**
 * The "protect unvisited tabs" immunity gate in immunity.ts.
 *
 * When protectUnvisited is on, a tab whose id is not in the visited set is
 * immune; when off, the gate has no effect. A visited tab ages normally.
 */
import { describe, it, expect } from 'vitest';
import { buildImmunityContext, isImmune } from '../background/immunity';
import { DEFAULT_SETTINGS } from '../shared/constants';
import type { Settings } from '../shared/types';

const settings = (over: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...over });

// A plain, non-immune-by-other-means tab: not active/pinned/audible, real URL,
// enough total tabs to clear the minTabCount floor.
const plainTab = (id: number) =>
  ({ id, active: false, pinned: false, audible: false, url: 'https://example.com' }) as any;
const manyTabs = (id: number) => Array.from({ length: 10 }, (_, i) => plainTab(i + 1)).map(t => t.id === id ? plainTab(id) : t);

describe('protect-unvisited immunity gate', () => {
  it('makes an unvisited tab immune when protectUnvisited is on', () => {
    const ctx = buildImmunityContext(settings({ protectUnvisited: true }), manyTabs(3), [], /* visited */ []);
    expect(isImmune(plainTab(3), ctx)).toBe(true);
  });

  it('does not protect a tab that has been visited', () => {
    const ctx = buildImmunityContext(settings({ protectUnvisited: true }), manyTabs(3), [], /* visited */ [3]);
    expect(isImmune(plainTab(3), ctx)).toBe(false);
  });

  it('has no effect when protectUnvisited is off', () => {
    const ctx = buildImmunityContext(settings({ protectUnvisited: false }), manyTabs(3), [], /* visited */ []);
    expect(isImmune(plainTab(3), ctx)).toBe(false);
  });

  it('other immunity reasons still win regardless of visited state', () => {
    // A pinned unvisited tab is immune via pinned, not via the unvisited gate,
    // but must still be immune either way.
    const ctx = buildImmunityContext(settings({ protectUnvisited: false }), manyTabs(3), [], []);
    const pinned = { ...plainTab(3), pinned: true };
    expect(isImmune(pinned, ctx)).toBe(true);
  });
});
