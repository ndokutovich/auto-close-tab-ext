import browser from 'webextension-polyfill';
import { isTabLocked, lockTab, unlockTab } from '../shared/storage';
import { msg } from '../shared/i18n';

const MENU_ID = 'aging-tabs-lock-toggle';

export function setupContextMenu(): void {
  try {
    if (!browser.contextMenus) return;

    browser.contextMenus.create({
      id: MENU_ID,
      title: msg('menuLockTab'),
      contexts: ['tab'],
    });
  } catch {
    // contextMenus may not be available
  }

  try {
    browser.contextMenus.onClicked.addListener(async (info, tab) => {
      if (info.menuItemId !== MENU_ID || !tab?.id) return;
      const locked = await isTabLocked(tab.id);
      if (locked) {
        await unlockTab(tab.id);
      } else {
        await lockTab(tab.id);
      }
    });
  } catch {
    // listener registration may fail
  }
}

export async function toggleLockForTab(tabId: number): Promise<boolean> {
  const locked = await isTabLocked(tabId);
  if (locked) {
    await unlockTab(tabId);
    return false;
  } else {
    await lockTab(tabId);
    return true;
  }
}
