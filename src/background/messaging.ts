import browser from 'webextension-polyfill';
import type { ExtensionMessage } from '../shared/types';
import { getSettings, saveSettings, getGraveyard } from '../shared/storage';
import { restoreTab, removeEntry, clearAll } from './graveyard';
import { getAllTrackedTabIds, getLastAccessed, getStage } from './tab-tracker';

function isExtensionSender(sender: browser.Runtime.MessageSender): boolean {
  const extOrigin = browser.runtime.getURL('');
  return !!sender.url?.startsWith(extOrigin);
}

function isAllowedFaviconUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Only allow http/https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  // Block private/internal IPs
  const host = parsed.hostname;
  if (
    host === 'localhost' ||
    host === '::1' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('0.') ||
    host.startsWith('169.254.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return false;
  }

  return true;
}

export function setupMessageListener(): void {
  browser.runtime.onMessage.addListener(
    (message: ExtensionMessage, sender): Promise<any> | undefined => {
      switch (message.type) {
        // --- Content script messages (any sender) ---

        case 'CONTENT_READY':
          return undefined;

        case 'FETCH_FAVICON_REQUEST': {
          const { url, requestId } = message;
          if (!isAllowedFaviconUrl(url)) {
            return Promise.resolve({ ok: false });
          }
          return fetch(url)
            .then(res => res.blob())
            .then(blob => new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            }))
            .then(dataUrl => {
              if (sender.tab?.id) {
                browser.tabs.sendMessage(sender.tab.id, {
                  type: 'FETCH_FAVICON_RESULT',
                  dataUrl,
                  requestId,
                });
              }
              return { ok: true };
            })
            .catch(() => ({ ok: false }));
        }

        // --- Read-only queries (safe from any sender) ---

        case 'GET_GRAVEYARD':
          return getGraveyard();

        case 'GET_SETTINGS':
          return getSettings();

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

        // --- Privileged operations (extension pages only) ---

        case 'RESTORE_TAB':
          if (!isExtensionSender(sender)) return Promise.resolve({ ok: false });
          return restoreTab(message.url).then(() => ({ ok: true }));

        case 'REMOVE_GRAVEYARD_ENTRY':
          if (!isExtensionSender(sender)) return Promise.resolve({ ok: false });
          return removeEntry(message.closedAt).then(() => ({ ok: true }));

        case 'CLEAR_GRAVEYARD':
          if (!isExtensionSender(sender)) return Promise.resolve({ ok: false });
          return clearAll().then(() => ({ ok: true }));

        case 'SAVE_SETTINGS':
          if (!isExtensionSender(sender)) return Promise.resolve({ ok: false });
          return saveSettings(message.settings);

        default:
          return undefined;
      }
    }
  );
}
