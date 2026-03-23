import browser from 'webextension-polyfill';
import type { GraveyardEntry } from '../shared/types';
import { addToGraveyard, getGraveyard, removeFromGraveyard, clearGraveyard as storageClearGraveyard } from '../shared/storage';
import { stripAgingPrefix, extractDomain } from '../shared/pure';

let idCounter = 0;

function generateId(): string {
  return `${Date.now()}-${++idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function buryTab(
  tab: browser.Tabs.Tab,
  maxSize: number
): Promise<GraveyardEntry> {
  const entry: GraveyardEntry = {
    id: generateId(),
    url: tab.url || '',
    title: stripAgingPrefix(tab.title || 'Untitled'),
    faviconUrl: tab.favIconUrl || '',
    closedAt: Date.now(),
    domain: extractDomain(tab.url),
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
  const text = count > 0 ? String(count) : '';
  await browser.action.setBadgeText({ text });
  if (count > 0) {
    await browser.action.setBadgeBackgroundColor({ color: '#6b7280' });
  }
}
