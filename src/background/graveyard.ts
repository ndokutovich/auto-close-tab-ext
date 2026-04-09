import browser from 'webextension-polyfill';
import type { GraveyardEntry } from '../shared/types';
import { addToGraveyard, getGraveyard, removeFromGraveyard, clearGraveyard as storageClearGraveyard } from '../shared/storage';
import { stripAgingPrefix, extractDomain } from '../shared/pure';
import { BLINK_CLOSING_TEXT } from '../shared/constants';
import { isPaused } from './tab-tracker';

let idCounter = 0;

function generateId(): string {
  return `${Date.now()}-${++idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function buryTab(
  tab: browser.Tabs.Tab,
  maxSize: number
): Promise<GraveyardEntry> {
  const domain = extractDomain(tab.url);
  let title = stripAgingPrefix(tab.title || 'Untitled');
  // Stage-4 blink replaces the entire title — original is unrecoverable
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
