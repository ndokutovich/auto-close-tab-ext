import browser from 'webextension-polyfill';
import { getSettings } from '../shared/storage';
import { clearAll, removeEntriesByUrls } from './graveyard';

/**
 * Register a listener for browser history removal events. When the user
 * clears browsing history (fully or partially), matching graveyard entries
 * are removed so the extension doesn't become a shadow history.
 *
 * Must be called synchronously at module top level (MV3 requirement).
 * No-ops on Safari where browser.history is unavailable.
 */
export function setupHistorySyncListener(): void {
  try {
    if (!browser.history?.onVisitRemoved) return;

    browser.history.onVisitRemoved.addListener(async (removed) => {
      const settings = await getSettings();
      if (!settings.historySyncEnabled) return;

      if (removed.allHistory) {
        await clearAll();
      } else if (removed.urls?.length) {
        await removeEntriesByUrls(removed.urls);
      }
    });
  } catch {
    // history API unavailable (Safari, or permission not granted yet).
    // The listener registration itself doesn't require the permission —
    // it will simply never fire if the optional "history" permission
    // hasn't been granted. On browsers where the API doesn't exist at all,
    // the guard above catches it.
  }
}
