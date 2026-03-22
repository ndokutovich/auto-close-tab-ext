/**
 * Pure functions extracted for testability.
 * No browser API dependencies — these work in Node.js / vitest.
 */

import type { AgingStage, Settings } from './types';
import { MAX_STAGE } from './constants';

/**
 * Compute the aging stage (0-4) based on elapsed time and total timeout.
 */
export function computeAgingStage(elapsedMs: number, timeoutMs: number): AgingStage {
  if (timeoutMs <= 0) return 0;
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= timeoutMs) return MAX_STAGE;

  const ratio = elapsedMs / timeoutMs;
  return Math.min(MAX_STAGE, Math.floor(ratio * (MAX_STAGE + 1))) as AgingStage;
}

/**
 * Check if a tab should be closed (elapsed >= timeout).
 */
export function shouldClose(elapsedMs: number, timeoutMs: number): boolean {
  return elapsedMs >= timeoutMs;
}

/**
 * Check if a domain matches any entry in the whitelist.
 * Supports exact match and subdomain match (e.g., "github.com" matches "api.github.com").
 */
export function isDomainWhitelisted(hostname: string, whitelist: string[]): boolean {
  return whitelist.some(d => hostname === d || hostname.endsWith('.' + d));
}

/**
 * Extract hostname from a URL string. Returns empty string on failure.
 */
export function extractDomain(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Check if a URL is a restricted browser-internal URL.
 */
export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return false;
  const restricted = ['chrome://', 'about:', 'chrome-extension://', 'moz-extension://'];
  return restricted.some(prefix => url.startsWith(prefix));
}

/**
 * Pure immunity check — given tab properties, determine if it should be immune.
 * This is the logic from immunity.ts without browser API calls.
 */
export interface TabProps {
  id: number;
  pinned: boolean;
  audible: boolean;
  url?: string;
}

export function isTabImmune(
  tab: TabProps,
  activeTabId: number | undefined,
  totalTabCount: number,
  settings: Pick<Settings, 'minTabCount' | 'whitelistedDomains'>
): boolean {
  if (tab.id === activeTabId) return true;
  if (tab.pinned) return true;
  if (tab.audible) return true;
  if (totalTabCount <= settings.minTabCount) return true;

  if (tab.url && settings.whitelistedDomains.length > 0) {
    const hostname = extractDomain(tab.url);
    if (hostname && isDomainWhitelisted(hostname, settings.whitelistedDomains)) {
      return true;
    }
  }

  if (isRestrictedUrl(tab.url)) return true;

  return false;
}

/**
 * Strip any known aging prefix from a title.
 */
const KNOWN_PREFIXES = ['\u23f3 ', '\ud83d\udca4 ', '\ud83d\udc7b '];

export function stripAgingPrefix(title: string): string {
  for (const prefix of KNOWN_PREFIXES) {
    if (title.startsWith(prefix)) {
      return title.slice(prefix.length);
    }
  }
  return title;
}

/**
 * Format a timestamp as relative time (e.g., "5m ago", "2h ago").
 */
export function formatTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Build a default favicon URL from a page URL.
 */
export function defaultFavicon(url: string): string {
  try {
    return new URL(url).origin + '/favicon.ico';
  } catch {
    return '';
  }
}

/**
 * Cap graveyard entries to maxSize, evicting oldest.
 */
export function capGraveyard<T>(entries: T[], maxSize: number): T[] {
  if (entries.length <= maxSize) return entries;
  return entries.slice(0, maxSize);
}
