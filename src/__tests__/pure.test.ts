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
