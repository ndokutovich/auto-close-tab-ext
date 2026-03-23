import browser from 'webextension-polyfill';
import type { Settings, GraveyardEntry, AgingStage } from './types';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from './constants';
import { capGraveyard } from './pure';

// --- Settings ---

export async function getSettings(): Promise<Settings> {
  try {
    const result = await browser.storage.local.get(STORAGE_KEYS.SETTINGS);
    const stored = result[STORAGE_KEYS.SETTINGS] as Partial<Settings> | undefined;
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(partial: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const merged = { ...current, ...partial };

  // Enforce bounds to prevent abuse via crafted messages
  const updated: Settings = {
    ...merged,
    timeoutMinutes: Math.max(1, Math.min(1440, Number(merged.timeoutMinutes) || current.timeoutMinutes)),
    minTabCount: Math.max(0, Math.min(100, Number(merged.minTabCount) ?? current.minTabCount)),
    graveyardMaxSize: Math.max(0, Math.min(10000, Number(merged.graveyardMaxSize) ?? current.graveyardMaxSize)),
    faviconDimming: !!merged.faviconDimming,
    titlePrefix: !!merged.titlePrefix,
    closeEmptyTabs: !!merged.closeEmptyTabs,
    protectGroupedTabs: !!merged.protectGroupedTabs,
    expireAction: merged.expireAction === 'discard' ? 'discard' : 'close',
    whitelistedDomains: Array.isArray(merged.whitelistedDomains)
      ? merged.whitelistedDomains.filter((d): d is string => typeof d === 'string').slice(0, 100)
      : current.whitelistedDomains,
  };

  await browser.storage.local.set({ [STORAGE_KEYS.SETTINGS]: updated });
  return updated;
}

// --- Tab times ---

export async function getTabTimes(): Promise<Record<number, number>> {
  try {
    const result = await browser.storage.local.get(STORAGE_KEYS.TAB_TIMES);
    return (result[STORAGE_KEYS.TAB_TIMES] as Record<number, number> | undefined) ?? {};
  } catch {
    return {};
  }
}

export async function setTabTimes(times: Record<number, number>): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.TAB_TIMES]: times });
}

// --- Tab stages ---

export async function getTabStages(): Promise<Record<number, AgingStage>> {
  try {
    const result = await browser.storage.local.get(STORAGE_KEYS.TAB_STAGES);
    return (result[STORAGE_KEYS.TAB_STAGES] as Record<number, AgingStage> | undefined) ?? {};
  } catch {
    return {};
  }
}

export async function setTabStages(stages: Record<number, AgingStage>): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.TAB_STAGES]: stages });
}

// --- Graveyard ---

export async function getGraveyard(): Promise<GraveyardEntry[]> {
  try {
    const result = await browser.storage.local.get(STORAGE_KEYS.GRAVEYARD);
    const data = result[STORAGE_KEYS.GRAVEYARD];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function addToGraveyard(entry: GraveyardEntry, maxSize: number): Promise<GraveyardEntry[]> {
  const graveyard = await getGraveyard();
  graveyard.unshift(entry);
  const capped = capGraveyard(graveyard, maxSize);
  await browser.storage.local.set({ [STORAGE_KEYS.GRAVEYARD]: capped });
  return capped;
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

// --- Locked tabs ---

export async function getLockedTabs(): Promise<number[]> {
  try {
    const result = await browser.storage.local.get(STORAGE_KEYS.LOCKED_TABS);
    const data = result[STORAGE_KEYS.LOCKED_TABS];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function setLockedTabs(tabIds: number[]): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.LOCKED_TABS]: tabIds });
}

export async function lockTab(tabId: number): Promise<number[]> {
  const locked = await getLockedTabs();
  if (!locked.includes(tabId)) {
    locked.push(tabId);
    await setLockedTabs(locked);
  }
  return locked;
}

export async function unlockTab(tabId: number): Promise<number[]> {
  let locked = await getLockedTabs();
  locked = locked.filter(id => id !== tabId);
  await setLockedTabs(locked);
  return locked;
}

export async function isTabLocked(tabId: number): Promise<boolean> {
  const locked = await getLockedTabs();
  return locked.includes(tabId);
}

// --- Full export/import ---

export async function exportAllData(): Promise<string> {
  const data = await browser.storage.local.get(null);
  return JSON.stringify(data, null, 2);
}

export async function importData(jsonString: string): Promise<void> {
  const data = JSON.parse(jsonString);
  if (typeof data !== 'object' || data === null) throw new Error('Invalid data');
  // Only import known keys
  const allowed = Object.values(STORAGE_KEYS);
  const filtered: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in data) filtered[key] = data[key];
  }
  await browser.storage.local.set(filtered);
}
