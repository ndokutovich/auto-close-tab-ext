import { describe, it, expect } from 'vitest';
import {
  computeAgingStage,
  shouldClose,
  isDomainWhitelisted,
  extractDomain,
  isRestrictedUrl,
  isTabImmune,
  stripAgingPrefix,
  capGraveyard,
  expireGraveyardEntries,
  shiftTabTimes,
  type TabProps,
} from '../shared/pure';

// --- computeAgingStage ---

describe('computeAgingStage', () => {
  const timeout = 30 * 60 * 1000; // 30 minutes

  it('returns 0 for fresh tabs (no time elapsed)', () => {
    expect(computeAgingStage(0, timeout)).toBe(0);
  });

  it('returns 0 for negative elapsed', () => {
    expect(computeAgingStage(-1000, timeout)).toBe(0);
  });

  it('returns 1 for ~20-39% elapsed', () => {
    expect(computeAgingStage(timeout * 0.25, timeout)).toBe(1);
  });

  it('returns 2 for ~40-59% elapsed', () => {
    expect(computeAgingStage(timeout * 0.5, timeout)).toBe(2);
  });

  it('returns 3 for ~60-79% elapsed', () => {
    expect(computeAgingStage(timeout * 0.7, timeout)).toBe(3);
  });

  it('returns 4 for ~80-99% elapsed', () => {
    expect(computeAgingStage(timeout * 0.9, timeout)).toBe(4);
  });

  it('returns 4 when elapsed equals timeout', () => {
    expect(computeAgingStage(timeout, timeout)).toBe(4);
  });

  it('returns 4 when elapsed exceeds timeout', () => {
    expect(computeAgingStage(timeout * 2, timeout)).toBe(4);
  });

  it('handles zero timeout gracefully', () => {
    expect(computeAgingStage(1000, 0)).toBe(0);
  });

  it('progresses monotonically through stages', () => {
    const stages: number[] = [];
    for (let pct = 0; pct <= 100; pct += 5) {
      stages.push(computeAgingStage(timeout * pct / 100, timeout));
    }
    // Each stage should be >= previous
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i]).toBeGreaterThanOrEqual(stages[i - 1]);
    }
  });
});

// --- shouldClose ---

describe('shouldClose', () => {
  it('returns false when elapsed < timeout', () => {
    expect(shouldClose(1000, 2000)).toBe(false);
  });

  it('returns true when elapsed == timeout', () => {
    expect(shouldClose(2000, 2000)).toBe(true);
  });

  it('returns true when elapsed > timeout', () => {
    expect(shouldClose(3000, 2000)).toBe(true);
  });
});

// --- isDomainWhitelisted ---

describe('isDomainWhitelisted', () => {
  const whitelist = ['github.com', 'google.com', 'localhost'];

  it('matches exact domain', () => {
    expect(isDomainWhitelisted('github.com', whitelist)).toBe(true);
  });

  it('matches subdomain', () => {
    expect(isDomainWhitelisted('api.github.com', whitelist)).toBe(true);
  });

  it('matches deep subdomain', () => {
    expect(isDomainWhitelisted('docs.api.github.com', whitelist)).toBe(true);
  });

  it('does not match partial domain name', () => {
    expect(isDomainWhitelisted('notgithub.com', whitelist)).toBe(false);
  });

  it('does not match unrelated domain', () => {
    expect(isDomainWhitelisted('gitlab.com', whitelist)).toBe(false);
  });

  it('handles empty whitelist', () => {
    expect(isDomainWhitelisted('github.com', [])).toBe(false);
  });

  it('matches localhost', () => {
    expect(isDomainWhitelisted('localhost', whitelist)).toBe(true);
  });
});

// --- extractDomain ---

describe('extractDomain', () => {
  it('extracts hostname from URL', () => {
    expect(extractDomain('https://github.com/tabwrangler')).toBe('github.com');
  });

  it('returns empty for undefined', () => {
    expect(extractDomain(undefined)).toBe('');
  });

  it('returns empty for invalid URL', () => {
    expect(extractDomain('not a url')).toBe('');
  });

  it('handles URLs with ports', () => {
    expect(extractDomain('http://localhost:3000/path')).toBe('localhost');
  });
});

// --- isRestrictedUrl ---

describe('isRestrictedUrl', () => {
  it('detects chrome:// URLs', () => {
    expect(isRestrictedUrl('chrome://extensions')).toBe(true);
  });

  it('detects about: URLs', () => {
    expect(isRestrictedUrl('about:blank')).toBe(true);
  });

  it('detects chrome-extension:// URLs', () => {
    expect(isRestrictedUrl('chrome-extension://abc/popup.html')).toBe(true);
  });

  it('detects moz-extension:// URLs', () => {
    expect(isRestrictedUrl('moz-extension://abc/popup.html')).toBe(true);
  });

  it('detects safari-web-extension:// URLs', () => {
    expect(isRestrictedUrl('safari-web-extension://abc/popup.html')).toBe(true);
  });

  it('allows normal URLs', () => {
    expect(isRestrictedUrl('https://example.com')).toBe(false);
  });

  it('handles undefined', () => {
    expect(isRestrictedUrl(undefined)).toBe(false);
  });
});

// --- isTabImmune ---

describe('isTabImmune', () => {
  const baseSettings = { minTabCount: 3, whitelistedDomains: ['github.com'] };

  const normalTab: TabProps = {
    id: 1,
    pinned: false,
    audible: false,
    url: 'https://example.com',
  };

  it('protects active tab', () => {
    expect(isTabImmune(normalTab, 1, 10, baseSettings)).toBe(true);
  });

  it('does not protect non-active tab', () => {
    expect(isTabImmune(normalTab, 99, 10, baseSettings)).toBe(false);
  });

  it('protects pinned tabs', () => {
    expect(isTabImmune({ ...normalTab, pinned: true }, 99, 10, baseSettings)).toBe(true);
  });

  it('protects audible tabs', () => {
    expect(isTabImmune({ ...normalTab, audible: true }, 99, 10, baseSettings)).toBe(true);
  });

  it('protects when at minimum tab count', () => {
    expect(isTabImmune(normalTab, 99, 3, baseSettings)).toBe(true);
  });

  it('does not protect when above minimum', () => {
    expect(isTabImmune(normalTab, 99, 4, baseSettings)).toBe(false);
  });

  it('protects whitelisted domains', () => {
    const tab: TabProps = { ...normalTab, url: 'https://github.com/repo' };
    expect(isTabImmune(tab, 99, 10, baseSettings)).toBe(true);
  });

  it('protects whitelisted subdomains', () => {
    const tab: TabProps = { ...normalTab, url: 'https://api.github.com/v3' };
    expect(isTabImmune(tab, 99, 10, baseSettings)).toBe(true);
  });

  it('protects restricted URLs', () => {
    const tab: TabProps = { ...normalTab, url: 'chrome://settings' };
    expect(isTabImmune(tab, 99, 10, baseSettings)).toBe(true);
  });

  it('does not protect normal non-whitelisted tab', () => {
    const tab: TabProps = { ...normalTab, url: 'https://random-site.com' };
    expect(isTabImmune(tab, 99, 10, baseSettings)).toBe(false);
  });
});

// --- stripAgingPrefix ---

describe('stripAgingPrefix', () => {
  it('strips hourglass prefix', () => {
    expect(stripAgingPrefix('\u23f3 My Tab')).toBe('My Tab');
  });

  it('strips sleep prefix', () => {
    expect(stripAgingPrefix('\ud83d\udca4 My Tab')).toBe('My Tab');
  });

  it('strips ghost prefix', () => {
    expect(stripAgingPrefix('\ud83d\udc7b My Tab')).toBe('My Tab');
  });

  it('leaves unprefixed titles unchanged', () => {
    expect(stripAgingPrefix('Normal Title')).toBe('Normal Title');
  });

  it('handles empty string', () => {
    expect(stripAgingPrefix('')).toBe('');
  });

  // BUG REPRO: stage-4 blink replaces entire title with '⚠️ Closing soon...'
  // stripAgingPrefix must handle this so graveyard stores the original title
  it('strips warning prefix from blink text', () => {
    expect(stripAgingPrefix('\u26a0\ufe0f Closing soon...')).toBe('Closing soon...');
  });

  it('strips warning prefix from blink text with original title', () => {
    expect(stripAgingPrefix('\u26a0\ufe0f My Tab')).toBe('My Tab');
  });
});

// --- capGraveyard ---

describe('capGraveyard', () => {
  it('returns entries unchanged when under limit', () => {
    const entries = [1, 2, 3];
    expect(capGraveyard(entries, 5)).toEqual([1, 2, 3]);
  });

  it('returns entries unchanged when at limit', () => {
    const entries = [1, 2, 3];
    expect(capGraveyard(entries, 3)).toEqual([1, 2, 3]);
  });

  it('truncates to maxSize, keeping newest (first)', () => {
    const entries = [1, 2, 3, 4, 5];
    expect(capGraveyard(entries, 3)).toEqual([1, 2, 3]);
  });
});

// --- expireGraveyardEntries ---

describe('expireGraveyardEntries', () => {
  const entry = (closedAt: number) => ({
    id: `id-${closedAt}`, url: 'https://x.com', title: 'X',
    faviconUrl: '', closedAt, domain: 'x.com',
  });

  const DAY = 86_400_000;

  it('returns all entries when maxAgeDays is 0 (disabled)', () => {
    const entries = [entry(100), entry(200)];
    expect(expireGraveyardEntries(entries, 0, 1000)).toBe(entries); // same ref
  });

  it('returns all entries when maxAgeDays is negative', () => {
    const entries = [entry(100)];
    expect(expireGraveyardEntries(entries, -1, 1000)).toBe(entries);
  });

  it('removes entries older than maxAgeDays', () => {
    const now = DAY * 10;
    const entries = [
      entry(now - DAY * 2),  // 2 days old → keep (within 7 days)
      entry(now - DAY * 8),  // 8 days old → remove
      entry(now - DAY * 30), // 30 days old → remove
    ];
    const result = expireGraveyardEntries(entries, 7, now);
    expect(result).toEqual([entries[0]]);
  });

  it('keeps entries exactly at the cutoff boundary', () => {
    const now = DAY * 10;
    const entries = [entry(now - DAY * 7)]; // exactly 7 days old
    const result = expireGraveyardEntries(entries, 7, now);
    expect(result).toEqual([entries[0]]); // closedAt === cutoff → >= passes
  });

  it('returns empty array when all entries are expired', () => {
    const now = DAY * 100;
    const entries = [entry(DAY), entry(DAY * 2)];
    expect(expireGraveyardEntries(entries, 1, now)).toEqual([]);
  });

  it('handles empty array', () => {
    expect(expireGraveyardEntries([], 7, Date.now())).toEqual([]);
  });
});

// --- shiftTabTimes (pause/idle compensation) ---

describe('shiftTabTimes', () => {
  it('shifts pre-pause tabs forward by the full duration', () => {
    const now = 10_000;
    const pausedSince = 5_000;
    const shiftMs = now - pausedSince;
    const tabs = { 1: 3_000, 2: 4_500 }; // both activated before pause
    shiftTabTimes(tabs, shiftMs, now);
    expect(tabs).toEqual({ 1: 8_000, 2: 9_500 });
    // elapsed for tab 1: 10000 - 8000 = 2000 (same as pre-pause: 5000 - 3000 = 2000) ✅
  });

  it('clamps tabs activated DURING the pause to `now`', () => {
    const now = 10_000;
    const pausedSince = 5_000;
    const shiftMs = now - pausedSince;
    // Tab 3 was activated mid-pause — naive shift would put it in the future
    const tabs = { 3: 7_000 };
    shiftTabTimes(tabs, shiftMs, now);
    // 7000 + 5000 = 12000 > now → clamped to now (elapsed = 0, "fresh")
    expect(tabs[3]).toBe(10_000);
  });

  it('handles a mix of pre-pause and mid-pause tabs', () => {
    const now = 10_000;
    const shiftMs = 5_000;
    const tabs = {
      1: 2_000,   // pre-pause
      2: 6_500,   // mid-pause (6500 + 5000 = 11500 > 10000)
      3: 4_999,   // edge: just before pause (4999 + 5000 = 9999 < 10000)
    };
    shiftTabTimes(tabs, shiftMs, now);
    expect(tabs[1]).toBe(7_000);
    expect(tabs[2]).toBe(10_000); // clamped
    expect(tabs[3]).toBe(9_999);
  });

  it('is a no-op when shiftMs is 0 or negative', () => {
    const tabs = { 1: 100, 2: 200 };
    const before = { ...tabs };
    shiftTabTimes(tabs, 0, 1000);
    expect(tabs).toEqual(before);
    shiftTabTimes(tabs, -500, 1000);
    expect(tabs).toEqual(before);
  });

  it('preserves elapsed time for a pre-pause tab across the shift', () => {
    // The key property: elapsed = now - lastAccessed should be preserved
    // for tabs that were active before the pause began.
    const beforePause = 100_000;
    const lastAccessed = 85_000; // elapsed at beforePause = 15_000
    const pauseDuration = 30_000;
    const nowAfter = beforePause + pauseDuration;

    const tabs = { 1: lastAccessed };
    shiftTabTimes(tabs, pauseDuration, nowAfter);

    const elapsedAfter = nowAfter - tabs[1];
    expect(elapsedAfter).toBe(15_000); // same as before the pause
  });
});
