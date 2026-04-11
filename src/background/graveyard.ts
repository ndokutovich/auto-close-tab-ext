import browser from 'webextension-polyfill';
import type { GraveyardEntry } from '../shared/types';
import { addToGraveyard, getGraveyard, setGraveyard, removeFromGraveyard, clearGraveyard as storageClearGraveyard } from '../shared/storage';
import { stripAgingPrefix, extractDomain, expireGraveyardEntries } from '../shared/pure';
import { BLINK_CLOSING_TEXT } from '../shared/constants';
import { isPaused } from './tab-tracker';

let idCounter = 0;

function generateId(): string {
  return `${Date.now()}-${++idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function buryTab(
  tab: browser.Tabs.Tab,
  maxSize: number,
  cachedCleanTitle?: string,
): Promise<GraveyardEntry> {
  const domain = extractDomain(tab.url);
  // Prefer the cached clean title (captured before stage-4 blink replaced it).
  // Fall back to stripping the aging prefix from the current tab title.
  let title = cachedCleanTitle || stripAgingPrefix(tab.title || 'Untitled');
  if (title === BLINK_CLOSING_TEXT) {
    title = domain || 'Untitled';
  }

  const entry: GraveyardEntry = {
    id: generateId(),
    url: tab.url || '',
    title,
    faviconUrl: tab.favIconUrl || '',
    closedAt: Date.now(),
    domain,
  };

  const graveyard = await addToGraveyard(entry, maxSize);
  await updateBadge(graveyard.length);
  return entry;
}

export async function restoreTab(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Invalid protocol');
  }
  await browser.tabs.create({ url, active: true });
}

export async function removeEntry(id: string): Promise<void> {
  const graveyard = await removeFromGraveyard(id);
  await updateBadge(graveyard.length);
}

export async function clearAll(): Promise<void> {
  await storageClearGraveyard();
  await updateBadge(0);
}

export async function removeEntriesByUrls(urls: string[]): Promise<void> {
  const urlSet = new Set(urls);
  const graveyard = await getGraveyard();
  const filtered = graveyard.filter(e => !urlSet.has(e.url));
  if (filtered.length < graveyard.length) {
    await setGraveyard(filtered);
    await syncBadge();
  }
}

export async function pruneExpiredEntries(maxAgeDays: number): Promise<void> {
  if (maxAgeDays <= 0) return;
  const graveyard = await getGraveyard();
  const pruned = expireGraveyardEntries(graveyard, maxAgeDays, Date.now());
  if (pruned.length < graveyard.length) {
    await setGraveyard(pruned);
    await syncBadge();
  }
}

export async function syncBadge(): Promise<void> {
  const graveyard = await getGraveyard();
  await updateBadge(graveyard.length);
}

async function updateBadge(count: number): Promise<void> {
  // Pause indicator takes precedence over graveyard count — it's actionable
  // state the user needs to see immediately.
  if (isPaused()) {
    await browser.action.setBadgeText({ text: '\u2016' }); // ‖ double vertical line
    await browser.action.setBadgeBackgroundColor({ color: '#f59e0b' }); // amber
    return;
  }
  const text = count > 0 ? String(count) : '';
  await browser.action.setBadgeText({ text });
  if (count > 0) {
    await browser.action.setBadgeBackgroundColor({ color: '#6b7280' });
  }
}
