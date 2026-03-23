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

    // Dynamically update menu title to show current lock state
    try {
      if (browser.contextMenus.onShown) {
        browser.contextMenus.onShown.addListener(async (info, tab) => {
          if (!tab?.id) return;
          try {
            const locked = await isTabLocked(tab.id);
            await browser.contextMenus.update(MENU_ID, {
              title: locked ? msg('menuUnlockTab') : msg('menuLockTab'),
            });
            browser.contextMenus.refresh();
          } catch {
            // update/refresh may fail
          }
        });
      }
    } catch {
      // onShown may not be available (Chrome)
    }

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
    // contextMenus may not be available
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
