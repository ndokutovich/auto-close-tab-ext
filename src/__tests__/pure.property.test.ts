import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  computeAgingStage,
  shouldClose,
  isDomainWhitelisted,
  extractDomain,
  isRestrictedUrl,
  isTabImmune,
  stripAgingPrefix,
  capGraveyard,
  formatTime,
  defaultFavicon,
  sortGraveyard,
} from '../shared/pure';
import type { GraveyardEntry } from '../shared/types';

// --- Custom generators ---

const posFloat = fc.double({ min: 0.001, max: 1e9, noNaN: true, noDefaultInfinity: true });
const nonNegFloat = fc.double({ min: 0, max: 1e9, noNaN: true, noDefaultInfinity: true });

const domainLabel = fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/);
// Force at least 2 labels to avoid single-label hostnames being resolved to IPs (e.g., "0" → "0.0.0.0")
const hostname = fc.tuple(domainLabel, domainLabel).map(([a, b]) => `${a}.${b}`);

const KNOWN_PREFIXES = ['\u23f3 ', '\ud83d\udca4 ', '\ud83d\udc7b '];
const plainTitle = fc.string({ minLength: 0, maxLength: 50 }).filter(
  s => !KNOWN_PREFIXES.some(p => s.startsWith(p))
);
const agingPrefix = fc.constantFrom(...KNOWN_PREFIXES);

// ============================================================
// computeAgingStage
// ============================================================
describe('computeAgingStage properties', () => {
  it('always returns a valid stage (0-4)', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        (elapsed, timeout) => {
          const stage = computeAgingStage(elapsed, timeout);
          expect([0, 1, 2, 3, 4]).toContain(stage);
        }
      )
    );
  });

  it('is monotonic: more elapsed time => higher or equal stage', () => {
    fc.assert(
      fc.property(posFloat, nonNegFloat, nonNegFloat, (timeout, a, b) => {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        expect(computeAgingStage(lo, timeout)).toBeLessThanOrEqual(
          computeAgingStage(hi, timeout)
        );
      })
    );
  });

  it('returns 0 for non-positive elapsed or timeout', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e9, max: 0, noNaN: true, noDefaultInfinity: true }),
        posFloat,
        (nonPos, pos) => {
          expect(computeAgingStage(nonPos, pos)).toBe(0);
          expect(computeAgingStage(pos, nonPos)).toBe(0);
        }
      )
    );
  });

  it('returns 4 when elapsed >= timeout (both positive)', () => {
    fc.assert(
      fc.property(posFloat, posFloat, (base, extra) => {
        const timeout = base;
        const elapsed = base + extra;
        expect(computeAgingStage(elapsed, timeout)).toBe(4);
      })
    );
  });

  it('returns 4 when elapsed EXACTLY equals timeout', () => {
    fc.assert(
      fc.property(posFloat, (timeout) => {
        expect(computeAgingStage(timeout, timeout)).toBe(4);
      })
    );
  });

  it('matches oracle: stage = min(4, floor(ratio * 5))', () => {
    // Use a ratio-based approach to avoid min>max constraint issues
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1e9, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: 0.99, noNaN: true, noDefaultInfinity: true }),
        (timeout, ratio) => {
          const elapsed = timeout * ratio;
          if (elapsed <= 0 || elapsed >= timeout) return;
          const expected = Math.min(4, Math.floor((elapsed / timeout) * 5));
          expect(computeAgingStage(elapsed, timeout)).toBe(expected);
        }
      )
    );
  });
});

// ============================================================
// shouldClose
// ============================================================
describe('shouldClose properties', () => {
  it('agrees with computeAgingStage at the boundary', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        posFloat,
        (elapsed, timeout) => {
          if (shouldClose(elapsed, timeout)) {
            // Stage must be 4 if both inputs are positive
            if (elapsed > 0 && timeout > 0) {
              expect(computeAgingStage(elapsed, timeout)).toBe(4);
            }
          }
          if (elapsed > 0 && timeout > 0 && computeAgingStage(elapsed, timeout) < 4) {
            expect(shouldClose(elapsed, timeout)).toBe(false);
          }
        }
      )
    );
  });

  it('is a threshold: once true, stays true with more time', () => {
    fc.assert(
      fc.property(posFloat, nonNegFloat, nonNegFloat, (timeout, elapsed, delta) => {
        if (shouldClose(elapsed, timeout)) {
          expect(shouldClose(elapsed + delta, timeout)).toBe(true);
        }
      })
    );
  });

  it('boundary: exactly at timeout is true, one ms before is false', () => {
    fc.assert(
      fc.property(fc.nat({ max: 1_000_000_000 }).filter(t => t > 1), (timeout) => {
        expect(shouldClose(timeout, timeout)).toBe(true);
        expect(shouldClose(timeout - 1, timeout)).toBe(false);
      })
    );
  });
});

// ============================================================
// isDomainWhitelisted
// ============================================================
describe('isDomainWhitelisted properties', () => {
  it('exact domain always matches whitelist containing it', () => {
    fc.assert(
      fc.property(hostname, fc.array(hostname, { maxLength: 5 }), (domain, others) => {
        expect(isDomainWhitelisted(domain, [...others, domain])).toBe(true);
      })
    );
  });

  it('subdomain matches parent in whitelist', () => {
    fc.assert(
      fc.property(hostname, hostname, (sub, parent) => {
        expect(isDomainWhitelisted(sub + '.' + parent, [parent])).toBe(true);
      })
    );
  });

  it('no false positive on partial suffix (no dot separator)', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{1,5}$/),
        hostname,
        (prefix, domain) => {
          // "notgithub.com" should NOT match "github.com"
          expect(isDomainWhitelisted(prefix + domain, [domain])).toBe(false);
        }
      )
    );
  });

  it('empty whitelist never matches', () => {
    fc.assert(
      fc.property(fc.string(), (h) => {
        expect(isDomainWhitelisted(h, [])).toBe(false);
      })
    );
  });

  it('adding to whitelist never revokes existing match', () => {
    fc.assert(
      fc.property(hostname, hostname, fc.array(hostname, { maxLength: 5 }), (h, extra, list) => {
        if (isDomainWhitelisted(h, list)) {
          expect(isDomainWhitelisted(h, [...list, extra])).toBe(true);
        }
      })
    );
  });
});

// ============================================================
// extractDomain
// ============================================================
describe('extractDomain properties', () => {
  it('round-trip: extracting from constructed URL gives original hostname', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('http', 'https'),
        hostname,
        (scheme, host) => {
          const url = `${scheme}://${host}/page`;
          expect(extractDomain(url)).toBe(host);
        }
      )
    );
  });

  it('never throws, always returns string', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constant(undefined)), (input) => {
        const result = extractDomain(input);
        expect(typeof result).toBe('string');
      })
    );
  });

  it('falsy input returns empty string', () => {
    fc.assert(
      fc.property(fc.constantFrom(undefined, ''), (input) => {
        expect(extractDomain(input)).toBe('');
      })
    );
  });

  it('undefined always returns empty (mutation killer)', () => {
    // Directly targets: if (!url) return '' → if (false) return ''
    expect(extractDomain(undefined)).toBe('');
    expect(extractDomain('')).toBe('');
  });
});

// ============================================================
// isRestrictedUrl
// ============================================================
describe('isRestrictedUrl properties', () => {
  it('all restricted prefixes with any suffix are restricted', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('chrome://', 'about:', 'chrome-extension://', 'moz-extension://'),
        fc.string(),
        (prefix, suffix) => {
          expect(isRestrictedUrl(prefix + suffix)).toBe(true);
        }
      )
    );
  });

  it('http/https URLs are never restricted', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('http://', 'https://'),
        fc.string(),
        (scheme, rest) => {
          expect(isRestrictedUrl(scheme + rest)).toBe(false);
        }
      )
    );
  });

  it('undefined returns false', () => {
    expect(isRestrictedUrl(undefined)).toBe(false);
  });
});

// ============================================================
// isTabImmune
// ============================================================
describe('isTabImmune properties', () => {
  const emptySettings = { minTabCount: 0, whitelistedDomains: [] as string[] };

  it('pinned tab is always immune', () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), hostname, (id, activeId, host) => {
        const tab = { id, pinned: true, audible: false, url: `https://${host}/` };
        expect(isTabImmune(tab, activeId + 1000, 100, emptySettings)).toBe(true);
      })
    );
  });

  it('audible tab is always immune', () => {
    fc.assert(
      fc.property(fc.nat(), hostname, (id, host) => {
        const tab = { id, pinned: false, audible: true, url: `https://${host}/` };
        expect(isTabImmune(tab, id + 1, 100, emptySettings)).toBe(true);
      })
    );
  });

  it('active tab is always immune', () => {
    fc.assert(
      fc.property(fc.nat(), hostname, (id, host) => {
        const tab = { id, pinned: false, audible: false, url: `https://${host}/` };
        expect(isTabImmune(tab, id, 100, emptySettings)).toBe(true);
      })
    );
  });

  it('below minTabCount is always immune', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 50 }),
        hostname,
        (minCount, host) => {
          const tab = { id: 999, pinned: false, audible: false, url: `https://${host}/` };
          // totalTabCount <= minTabCount
          expect(isTabImmune(tab, 0, minCount, { minTabCount: minCount, whitelistedDomains: [] })).toBe(true);
        }
      )
    );
  });

  it('whitelisted domain tab is immune', () => {
    fc.assert(
      fc.property(hostname, (domain) => {
        const tab = { id: 999, pinned: false, audible: false, url: `https://${domain}/page` };
        expect(isTabImmune(tab, 0, 100, { minTabCount: 0, whitelistedDomains: [domain] })).toBe(true);
      })
    );
  });

  it('restricted URL tab is immune', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('chrome://settings', 'about:blank', 'chrome-extension://x/y', 'moz-extension://z/w'),
        (url) => {
          const tab = { id: 999, pinned: false, audible: false, url };
          expect(isTabImmune(tab, 0, 100, emptySettings)).toBe(true);
        }
      )
    );
  });

  it('tab with URL but empty whitelist is NOT immune (kills guard mutation)', () => {
    // Targets: if (tab.url && domains.length > 0) mutated to if (true) or if (tab.url || ...)
    // When whitelist is empty, even with a valid URL, tab should not be immune via whitelist path
    fc.assert(
      fc.property(hostname, (host) => {
        const tab = { id: 999, pinned: false, audible: false, url: `https://${host}.test/page` };
        expect(isTabImmune(tab, 0, 100, { minTabCount: 0, whitelistedDomains: [] })).toBe(false);
      })
    );
  });

  it('tab with no URL but non-empty whitelist is NOT immune', () => {
    // Targets: if (tab.url && domains.length > 0) mutated to if (true) or (... || ...)
    fc.assert(
      fc.property(hostname, (domain) => {
        const tab = { id: 999, pinned: false, audible: false }; // no url
        expect(isTabImmune(tab, 0, 100, { minTabCount: 0, whitelistedDomains: [domain] })).toBe(false);
      })
    );
  });

  it('normal tab with no privileges is NOT immune', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1000 }),
        fc.integer({ min: 2, max: 50 }),
        hostname,
        (tabId, minCount, host) => {
          const tab = {
            id: tabId,
            pinned: false,
            audible: false,
            url: `https://${host}.notlisted.test/page`,
          };
          const activeId = tabId + 1; // different from tab
          const totalTabs = minCount + 1; // above floor
          expect(isTabImmune(tab, activeId, totalTabs, {
            minTabCount: minCount,
            whitelistedDomains: ['unrelated.example'],
          })).toBe(false);
        }
      )
    );
  });
});

// ============================================================
// stripAgingPrefix
// ============================================================
describe('stripAgingPrefix properties', () => {
  it('round-trip: prefix + plainTitle strips back to plainTitle', () => {
    fc.assert(
      fc.property(agingPrefix, plainTitle, (prefix, title) => {
        expect(stripAgingPrefix(prefix + title)).toBe(title);
      })
    );
  });

  it('idempotent on plain titles', () => {
    fc.assert(
      fc.property(plainTitle, (title) => {
        const once = stripAgingPrefix(title);
        const twice = stripAgingPrefix(once);
        expect(twice).toBe(once);
      })
    );
  });

  it('reaches fixpoint within 3 applications on any input', () => {
    fc.assert(
      fc.property(fc.string(), (title) => {
        const s1 = stripAgingPrefix(title);
        const s2 = stripAgingPrefix(s1);
        const s3 = stripAgingPrefix(s2);
        const s4 = stripAgingPrefix(s3);
        expect(s3).toBe(s4);
      })
    );
  });

  it('result of prefix+plainTitle never starts with known prefix', () => {
    fc.assert(
      fc.property(agingPrefix, plainTitle, (prefix, title) => {
        const result = stripAgingPrefix(prefix + title);
        for (const p of KNOWN_PREFIXES) {
          expect(result.startsWith(p)).toBe(false);
        }
      })
    );
  });
});

// ============================================================
// capGraveyard
// ============================================================
describe('capGraveyard properties', () => {
  it('output length = min(input.length, maxSize), 0 = unlimited', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { maxLength: 100 }),
        fc.nat({ max: 100 }),
        (entries, maxSize) => {
          const result = capGraveyard(entries, maxSize);
          if (maxSize === 0) {
            expect(result.length).toBe(entries.length);
          } else {
            expect(result.length).toBe(Math.min(entries.length, maxSize));
          }
        }
      )
    );
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { maxLength: 50 }),
        fc.nat({ max: 50 }),
        (entries, maxSize) => {
          const once = capGraveyard(entries, maxSize);
          const twice = capGraveyard(once, maxSize);
          expect(twice).toEqual(once);
        }
      )
    );
  });

  it('result is a prefix of input (order preserved)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { maxLength: 50 }),
        fc.nat({ max: 50 }),
        (entries, maxSize) => {
          const result = capGraveyard(entries, maxSize);
          for (let i = 0; i < result.length; i++) {
            expect(result[i]).toBe(entries[i]);
          }
        }
      )
    );
  });

  it('exact boundary: length == maxSize returns same reference (kills <= vs < mutation)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { minLength: 1, maxLength: 50 }),
        (entries) => {
          // When entries.length exactly equals maxSize, should return same reference (no slicing)
          const result = capGraveyard(entries, entries.length);
          expect(result).toBe(entries); // reference equality
          expect(result.length).toBe(entries.length);
        }
      )
    );
  });

  it('returns same reference when within limit', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { maxLength: 20 }),
        (entries) => {
          const maxSize = entries.length + 10;
          const result = capGraveyard(entries, maxSize);
          expect(result).toBe(entries);
        }
      )
    );
  });

  it('monotonic in maxSize: bigger limit => more entries (excluding 0=unlimited)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { maxLength: 50 }),
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        (entries, a, b) => {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          expect(capGraveyard(entries, lo).length).toBeLessThanOrEqual(
            capGraveyard(entries, hi).length
          );
        }
      )
    );
  });
});

// ============================================================
// formatTime
// ============================================================
describe('formatTime properties', () => {
  it('always returns a non-empty string', () => {
    fc.assert(
      fc.property(fc.nat({ max: 2_000_000_000 }), (offset) => {
        const timestamp = Date.now() - offset;
        const result = formatTime(timestamp);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      })
    );
  });

  it('returns "just now" for timestamps less than 1 minute ago', () => {
    const now = Date.now();
    expect(formatTime(now)).toBe('just now');
    expect(formatTime(now - 30_000)).toBe('just now');
    // Skip 59999 — timing-sensitive near boundary
  });

  it('returns minutes for timestamps 1-59 minutes ago', () => {
    const now = Date.now();
    for (const mins of [1, 5, 30, 59]) {
      const result = formatTime(now - mins * 60_000);
      expect(result).toBe(`${mins}m ago`);
    }
  });

  it('returns hours for timestamps 1-23 hours ago', () => {
    const now = Date.now();
    for (const hrs of [1, 6, 12, 23]) {
      const result = formatTime(now - hrs * 3_600_000);
      expect(result).toBe(`${hrs}h ago`);
    }
  });

  it('returns days for timestamps 24+ hours ago', () => {
    const now = Date.now();
    for (const days of [1, 7, 30]) {
      const result = formatTime(now - days * 86_400_000);
      expect(result).toBe(`${days}d ago`);
    }
  });

  it('output matches one of the valid patterns', () => {
    fc.assert(
      fc.property(fc.nat({ max: 100_000_000 }), (offset) => {
        const result = formatTime(Date.now() - offset);
        const validPattern = /^(just now|\d+m ago|\d+h ago|\d+d ago)$/;
        expect(result).toMatch(validPattern);
      })
    );
  });

  it('monotonic: older timestamps produce higher or equal numeric values', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 100_000_000 }),
        fc.nat({ max: 100_000_000 }),
        (a, b) => {
          const now = Date.now();
          const newer = formatTime(now - Math.min(a, b));
          const older = formatTime(now - Math.max(a, b));
          // Extract numeric part (0 for "just now")
          const numOf = (s: string) => {
            if (s === 'just now') return 0;
            return parseInt(s);
          };
          const unitOf = (s: string) => {
            if (s === 'just now') return 0;
            if (s.includes('m ago')) return 1;
            if (s.includes('h ago')) return 2;
            return 3; // d ago
          };
          const olderUnit = unitOf(older);
          const newerUnit = unitOf(newer);
          if (olderUnit !== newerUnit) {
            expect(olderUnit).toBeGreaterThanOrEqual(newerUnit);
          } else {
            expect(numOf(older)).toBeGreaterThanOrEqual(numOf(newer));
          }
        }
      )
    );
  });
});

// ============================================================
// defaultFavicon
// ============================================================
describe('defaultFavicon properties', () => {
  it('returns URL ending with /favicon.ico for valid URLs', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('http', 'https'),
        hostname,
        (scheme, host) => {
          const result = defaultFavicon(`${scheme}://${host}/page`);
          expect(result).toMatch(/\/favicon\.ico$/);
          expect(result).toContain(host);
        }
      )
    );
  });

  it('returns empty string for invalid URLs', () => {
    fc.assert(
      fc.property(
        fc.string().filter(s => {
          try { new URL(s); return false; } catch { return true; }
        }),
        (invalid) => {
          expect(defaultFavicon(invalid)).toBe('');
        }
      )
    );
  });

  it('never throws', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = defaultFavicon(input);
        expect(typeof result).toBe('string');
      })
    );
  });
});

// ============================================================
// sortGraveyard
// ============================================================

const graveyardEntry = fc.record<GraveyardEntry>({
  id: fc.string({ minLength: 1, maxLength: 10 }),
  url: fc.constantFrom('https://a.com', 'https://b.com', 'https://c.com', 'https://z.com'),
  title: fc.constantFrom('Alpha', 'Beta', 'Gamma', 'Zeta', 'Omega'),
  faviconUrl: fc.constant(''),
  closedAt: fc.nat({ max: 2_000_000_000 }),
  domain: fc.constantFrom('a.com', 'b.com', 'c.com', 'z.com'),
});

describe('sortGraveyard properties', () => {
  it('preserves length', () => {
    fc.assert(
      fc.property(
        fc.array(graveyardEntry, { maxLength: 20 }),
        fc.constantFrom('recent' as const, 'domain' as const, 'alpha' as const),
        (entries, mode) => {
          expect(sortGraveyard(entries, mode).length).toBe(entries.length);
        }
      )
    );
  });

  it('does not mutate original array', () => {
    fc.assert(
      fc.property(
        fc.array(graveyardEntry, { minLength: 1, maxLength: 20 }),
        fc.constantFrom('recent' as const, 'domain' as const, 'alpha' as const),
        (entries, mode) => {
          const copy = [...entries];
          sortGraveyard(entries, mode);
          expect(entries).toEqual(copy);
        }
      )
    );
  });

  it('recent: sorted by closedAt descending', () => {
    fc.assert(
      fc.property(
        fc.array(graveyardEntry, { minLength: 2, maxLength: 20 }),
        (entries) => {
          const sorted = sortGraveyard(entries, 'recent');
          for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i - 1].closedAt).toBeGreaterThanOrEqual(sorted[i].closedAt);
          }
        }
      )
    );
  });

  it('alpha: sorted by title ascending', () => {
    fc.assert(
      fc.property(
        fc.array(graveyardEntry, { minLength: 2, maxLength: 20 }),
        (entries) => {
          const sorted = sortGraveyard(entries, 'alpha');
          for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i - 1].title.localeCompare(sorted[i].title)).toBeLessThanOrEqual(0);
          }
        }
      )
    );
  });

  it('domain: sorted by domain ascending, then closedAt descending within same domain', () => {
    fc.assert(
      fc.property(
        fc.array(graveyardEntry, { minLength: 2, maxLength: 20 }),
        (entries) => {
          const sorted = sortGraveyard(entries, 'domain');
          for (let i = 1; i < sorted.length; i++) {
            const cmp = sorted[i - 1].domain.localeCompare(sorted[i].domain);
            expect(cmp).toBeLessThanOrEqual(0);
            if (cmp === 0) {
              expect(sorted[i - 1].closedAt).toBeGreaterThanOrEqual(sorted[i].closedAt);
            }
          }
        }
      )
    );
  });

  it('idempotent: sorting twice gives same result', () => {
    fc.assert(
      fc.property(
        fc.array(graveyardEntry, { maxLength: 20 }),
        fc.constantFrom('recent' as const, 'domain' as const, 'alpha' as const),
        (entries, mode) => {
          const once = sortGraveyard(entries, mode);
          const twice = sortGraveyard(once, mode);
          expect(twice).toEqual(once);
        }
      )
    );
  });
});
