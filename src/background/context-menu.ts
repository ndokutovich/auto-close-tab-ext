import browser from 'webextension-polyfill';
import { isTabLocked, lockTab, unlockTab } from '../shared/storage';
import { msg } from '../shared/i18n';

const MENU_ID = 'aging-tabs-lock-toggle';

// Per-tab serialization of lock/unlock ops to avoid check-then-act races
// when users rapid-click the menu item or press the hotkey quickly.
const lockOps = new Map<number, Promise<unknown>>();

function serializePerTab<T>(tabId: number, op: () => Promise<T>): Promise<T> {
  const prev = lockOps.get(tabId) ?? Promise.resolve();
  const next = prev.then(op, op);
  lockOps.set(tabId, next.catch(() => {}));
  return next;
}

// Register listeners synchronously — must happen at module load for MV3 wake-ups.
export function setupContextMenuListeners(): void {
  try {
    if (!browser.contextMenus) return;

    // Firefox: onShown fires right before the menu renders — show lock state.
    // Chrome: onShown is unavailable and there's no reliable way to show
    // per-tab state (right-clicking a background tab doesn't activate it),
    // so we leave the neutral static title from createContextMenuItems.
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
      // onShown may not be available
    }

    browser.contextMenus.onClicked.addListener(async (info, tab) => {
      if (info.menuItemId !== MENU_ID || !tab?.id) return;
      await toggleLockForTab(tab.id);
    });
  } catch {
    // contextMenus may not be available
  }
}

// Called only once on install/update to avoid "duplicate ID" errors on wake-up.
export function createContextMenuItems(): void {
  try {
    if (!browser.contextMenus) return;
    browser.contextMenus.removeAll().then(() => {
      // Neutral toggle wording for Chrome (no onShown to show per-tab state).
      // Firefox overrides dynamically via onShown before rendering the menu.
      browser.contextMenus.create({
        id: MENU_ID,
        title: msg('cmdLockTab'),
        contexts: ['tab'],
      });
    }).catch(() => {});
  } catch {
    // contextMenus may not be available
  }
}

export async function toggleLockForTab(tabId: number): Promise<boolean> {
  return serializePerTab(tabId, async () => {
    const locked = await isTabLocked(tabId);
    if (locked) {
      await unlockTab(tabId);
      return false;
    }
    await lockTab(tabId);
    return true;
  });
}
