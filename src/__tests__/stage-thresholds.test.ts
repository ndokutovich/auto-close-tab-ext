/**
 * Custom stage thresholds: explicit minute marks for stages 1..4 instead of
 * even fractions of the timeout.
 *
 * Requested case: hourglass at 3 minutes, Zzz at 5, warning at 10 — which the
 * fraction model cannot express, since it always places the stages at 20/40/
 * 60/80 percent of whatever the timeout happens to be.
 */
import { describe, it, expect } from 'vitest';
import { computeAgingStage, normalizeStageThresholds } from '../shared/pure';

const MIN = 60_000;

describe('computeAgingStage with custom thresholds', () => {
  // Stages begin at 3, 5, 10 and 15 minutes; the tab closes at 20.
  const thresholds = [3 * MIN, 5 * MIN, 10 * MIN, 15 * MIN];
  const timeout = 20 * MIN;

  it('holds stage 0 before the first mark', () => {
    expect(computeAgingStage(0, timeout, thresholds)).toBe(0);
    expect(computeAgingStage(2.9 * MIN, timeout, thresholds)).toBe(0);
  });

  it('advances exactly at each mark', () => {
    expect(computeAgingStage(3 * MIN, timeout, thresholds)).toBe(1);
    expect(computeAgingStage(5 * MIN, timeout, thresholds)).toBe(2);
    expect(computeAgingStage(10 * MIN, timeout, thresholds)).toBe(3);
    expect(computeAgingStage(15 * MIN, timeout, thresholds)).toBe(4);
  });

  it('holds the stage between marks', () => {
    expect(computeAgingStage(4.9 * MIN, timeout, thresholds)).toBe(1);
    expect(computeAgingStage(9.9 * MIN, timeout, thresholds)).toBe(2);
    expect(computeAgingStage(14.9 * MIN, timeout, thresholds)).toBe(3);
  });

  it('is at the final stage once the timeout is reached', () => {
    expect(computeAgingStage(timeout, timeout, thresholds)).toBe(4);
    expect(computeAgingStage(timeout * 2, timeout, thresholds)).toBe(4);
  });

  it('ignores marks that sit beyond the timeout without skipping earlier ones', () => {
    // Thresholds outside the timeout are simply never reached before closure.
    const far = [1 * MIN, 2 * MIN, 99 * MIN, 100 * MIN];
    expect(computeAgingStage(1 * MIN, 5 * MIN, far)).toBe(1);
    expect(computeAgingStage(2 * MIN, 5 * MIN, far)).toBe(2);
    expect(computeAgingStage(4.9 * MIN, 5 * MIN, far)).toBe(2);
    expect(computeAgingStage(5 * MIN, 5 * MIN, far)).toBe(4); // expired
  });

  it('falls back to fractions when no thresholds are given', () => {
    expect(computeAgingStage(0, timeout, null)).toBe(0);
    expect(computeAgingStage(timeout * 0.2, timeout, null)).toBe(1);
    expect(computeAgingStage(timeout * 0.4, timeout, null)).toBe(2);
    expect(computeAgingStage(timeout * 0.8, timeout, null)).toBe(4);
  });

  it('matches the old signature when the argument is omitted', () => {
    expect(computeAgingStage(timeout * 0.6, timeout)).toBe(3);
  });
});

describe('normalizeStageThresholds', () => {
  it('accepts four ascending positive minute values', () => {
    expect(normalizeStageThresholds([3, 5, 10, 15])).toEqual([3, 5, 10, 15]);
  });

  it('rejects a wrong-length list', () => {
    expect(normalizeStageThresholds([3, 5, 10])).toBeNull();
    expect(normalizeStageThresholds([3, 5, 10, 15, 20])).toBeNull();
  });

  it('rejects non-ascending values — stages must not overlap', () => {
    expect(normalizeStageThresholds([3, 3, 10, 15])).toBeNull();
    expect(normalizeStageThresholds([10, 5, 3, 1])).toBeNull();
  });

  it('rejects non-positive and non-finite values', () => {
    expect(normalizeStageThresholds([0, 5, 10, 15])).toBeNull();
    expect(normalizeStageThresholds([-1, 5, 10, 15])).toBeNull();
    expect(normalizeStageThresholds([3, 5, Infinity, 15])).toBeNull();
    expect(normalizeStageThresholds([3, 5, NaN, 15])).toBeNull();
  });

  it('rejects anything that is not a numeric array', () => {
    expect(normalizeStageThresholds(null)).toBeNull();
    expect(normalizeStageThresholds(undefined)).toBeNull();
    expect(normalizeStageThresholds('3,5,10,15')).toBeNull();
    expect(normalizeStageThresholds([3, '5', 10, 15])).toBeNull();
    expect(normalizeStageThresholds({ 0: 3 })).toBeNull();
  });

  it('caps values at the maximum timeout — a mark past it is unreachable anyway', () => {
    expect(normalizeStageThresholds([1, 2, 3, 999_999])).toBeNull();
  });

  it('rejects marks at or beyond the configured timeout', () => {
    // With a 10-minute timeout the tab closes at minute 10, so a stage that
    // would begin at 10 (or 15) can never be seen — reject the whole list
    // rather than accept a schedule with unreachable stages.
    expect(normalizeStageThresholds([3, 5, 10, 15], 10)).toBeNull();
    expect(normalizeStageThresholds([3, 5, 8, 9], 10)).toEqual([3, 5, 8, 9]);
    expect(normalizeStageThresholds([3, 5, 10, 12], 10)).toBeNull();
  });

  it('ignores the timeout argument when it is not a positive number', () => {
    expect(normalizeStageThresholds([3, 5, 10, 15], 0)).toEqual([3, 5, 10, 15]);
    expect(normalizeStageThresholds([3, 5, 10, 15], undefined)).toEqual([3, 5, 10, 15]);
  });
});
