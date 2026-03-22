import browser from 'webextension-polyfill';
import type { GraveyardEntry } from '../shared/types';
import { addToGraveyard, getGraveyard, removeFromGraveyard, clearGraveyard as storageClearGraveyard } from '../shared/storage';
import { stripAgingPrefix } from '../shared/pure';

export async function buryTab(
  tab: browser.Tabs.Tab,
  maxSize: number
): Promise<void> {
  const entry: GraveyardEntry = {
    url: tab.url || '',
    title: stripAgingPrefix(tab.title || 'Untitled'),
    faviconUrl: tab.favIconUrl || '',
    closedAt: Date.now(),
    domain: extractDomain(tab.url),
  };

  const graveyard = await addToGraveyard(entry, maxSize);
  await updateBadge(graveyard.length);
}

export async function restoreTab(url: string): Promise<void> {
  await browser.tabs.create({ url, active: true });
}

export async function removeEntry(closedAt: number): Promise<void> {
  const graveyard = await removeFromGraveyard(closedAt);
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
    await browser.action.setBadgeBackgroundColor({ color: '#6b7280' }); // gray-500
  }
}

function extractDomain(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
