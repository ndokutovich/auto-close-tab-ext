import browser from 'webextension-polyfill';
import type { Settings, GraveyardEntry, AgingStage } from './types';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from './constants';

// --- Settings ---

export async function getSettings(): Promise<Settings> {
  const result = await browser.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.SETTINGS] };
}

export async function saveSettings(partial: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const updated = { ...current, ...partial };
  await browser.storage.local.set({ [STORAGE_KEYS.SETTINGS]: updated });
  return updated;
}

// --- Tab times ---

export async function getTabTimes(): Promise<Record<number, number>> {
  const result = await browser.storage.local.get(STORAGE_KEYS.TAB_TIMES);
  return result[STORAGE_KEYS.TAB_TIMES] || {};
}

export async function setTabTimes(times: Record<number, number>): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.TAB_TIMES]: times });
}

// --- Tab stages ---

export async function getTabStages(): Promise<Record<number, AgingStage>> {
  const result = await browser.storage.local.get(STORAGE_KEYS.TAB_STAGES);
  return result[STORAGE_KEYS.TAB_STAGES] || {};
}

export async function setTabStages(stages: Record<number, AgingStage>): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.TAB_STAGES]: stages });
}

// --- Graveyard ---

export async function getGraveyard(): Promise<GraveyardEntry[]> {
  const result = await browser.storage.local.get(STORAGE_KEYS.GRAVEYARD);
  return result[STORAGE_KEYS.GRAVEYARD] || [];
}

export async function addToGraveyard(entry: GraveyardEntry, maxSize: number): Promise<GraveyardEntry[]> {
  const graveyard = await getGraveyard();
  graveyard.unshift(entry);
  // Evict oldest if over limit
  while (graveyard.length > maxSize) {
    graveyard.pop();
  }
  await browser.storage.local.set({ [STORAGE_KEYS.GRAVEYARD]: graveyard });
  return graveyard;
}

export async function removeFromGraveyard(closedAt: number): Promise<GraveyardEntry[]> {
  let graveyard = await getGraveyard();
  graveyard = graveyard.filter(e => e.closedAt !== closedAt);
  await browser.storage.local.set({ [STORAGE_KEYS.GRAVEYARD]: graveyard });
  return graveyard;
}

export async function clearGraveyard(): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.GRAVEYARD]: [] });
}
