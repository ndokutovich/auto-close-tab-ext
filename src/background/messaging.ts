import browser from 'webextension-polyfill';
import type { ExtensionMessage } from '../shared/types';
import { getSettings, saveSettings, getGraveyard } from '../shared/storage';
import { restoreTab, removeEntry, clearAll } from './graveyard';
import { getAllTrackedTabIds, getLastAccessed, getStage } from './tab-tracker';

export function setupMessageListener(): void {
  browser.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender): Promise<any> | undefined => {
      switch (message.type) {
        case 'GET_GRAVEYARD':
          return getGraveyard();

        case 'RESTORE_TAB':
          return restoreTab(message.url).then(() => ({ ok: true }));

        case 'REMOVE_GRAVEYARD_ENTRY':
          return removeEntry(message.closedAt).then(() => ({ ok: true }));

        case 'CLEAR_GRAVEYARD':
          return clearAll().then(() => ({ ok: true }));

        case 'GET_SETTINGS':
          return getSettings();

        case 'SAVE_SETTINGS':
          return saveSettings(message.settings);

        case 'GET_TAB_STATES': {
          const ids = getAllTrackedTabIds();
          const states: Record<number, { lastAccessed: number; stage: number }> = {};
          for (const id of ids) {
            const lastAccessed = getLastAccessed(id);
            if (lastAccessed !== undefined) {
              states[id] = { lastAccessed, stage: getStage(id) };
            }
          }
          return Promise.resolve(states);
        }

        case 'FETCH_FAVICON_REQUEST': {
          // Content script needs us to fetch a cross-origin favicon
          const { url, requestId } = message;
          return fetch(url)
            .then(res => res.blob())
            .then(blob => new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            }))
            .then(dataUrl => {
              // Send result back to the content script in the sender tab
              if (_sender.tab?.id) {
                browser.tabs.sendMessage(_sender.tab.id, {
                  type: 'FETCH_FAVICON_RESULT',
                  dataUrl,
                  requestId,
                });
              }
              return { ok: true };
            })
            .catch(() => ({ ok: false }));
        }

        case 'CONTENT_READY':
          // Content script loaded, nothing to do
          return undefined;

        default:
          return undefined;
      }
    }
  );
}
