import browser from 'webextension-polyfill';
import { isTabLocked, lockTab, unlockTab } from '../shared/storage';

const MENU_ID = 'aging-tabs-lock-toggle';

export function setupContextMenu(): void {
  // Create the menu item once
  browser.contextMenus.create({
    id: MENU_ID,
    title: 'Lock tab (prevent auto-close)',
    contexts: ['tab'],
  }, () => {
    // Ignore "already exists" error on re-init
    if (browser.runtime.lastError) { /* ok */ }
  });

  // Update title dynamically when menu is shown
  if (browser.contextMenus.onShown) {
    browser.contextMenus.onShown.addListener(async (info, tab) => {
      if (!tab?.id) return;
      const locked = await isTabLocked(tab.id);
      browser.contextMenus.update(MENU_ID, {
        title: locked ? 'Unlock tab (allow auto-close)' : 'Lock tab (prevent auto-close)',
      });
      browser.contextMenus.refresh();
    });
  }

  // Handle click
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== MENU_ID || !tab?.id) return;
    const locked = await isTabLocked(tab.id);
    if (locked) {
      await unlockTab(tab.id);
    } else {
      await lockTab(tab.id);
    }
  });
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
