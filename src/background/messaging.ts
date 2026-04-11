import browser from 'webextension-polyfill';
import type { ExtensionMessage } from '../shared/types';
import { getSettings, saveSettings, getGraveyard, getLockedTabs, lockTab, unlockTab, exportAllData, importData } from '../shared/storage';
import { restoreTab, removeEntry, clearAll } from './graveyard';
import { getAllTrackedTabIds, getLastAccessed, getStage, ensureReady, isPaused, setPause } from './tab-tracker';
import { syncBadge } from './graveyard';

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
    (message: unknown, sender: browser.Runtime.MessageSender): Promise<any> | undefined => {
      const msg = message as ExtensionMessage;
      switch (msg.type) {
        // --- Content script messages (any sender) ---

        case 'CONTENT_READY':
          return undefined;

        case 'FETCH_FAVICON_REQUEST': {
          const { url, requestId } = msg;
          if (!isAllowedFaviconUrl(url)) {
            return Promise.resolve({ ok: false });
          }
          const MAX_FAVICON_BYTES = 1024 * 1024; // 1 MB
          return fetch(url)
            .then(res => {
              if (!res.ok) throw new Error(`favicon fetch ${res.status}`);
              const len = res.headers.get('content-length');
              if (len && Number(len) > MAX_FAVICON_BYTES) {
                throw new Error('favicon too large');
              }
              return res.blob();
            })
            .then(blob => {
              if (blob.size > MAX_FAVICON_BYTES) {
                throw new Error('favicon too large');
              }
              return new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
              });
            })
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

        case 'GET_TAB_STATES':
          // Wait for tracker init — popup might open during SW cold start
          return ensureReady().then(() => {
            const ids = getAllTrackedTabIds();
            const states: Record<number, { lastAccessed: number; stage: number }> = {};
            for (const id of ids) {
              const lastAccessed = getLastAccessed(id);
              if (lastAccessed !== undefined) {
                states[id] = { lastAccessed, stage: getStage(id) };
              }
            }
            return states;
          });

        // --- Privileged operations (extension pages only) ---

        case 'RESTORE_TAB':
          if (!isExtensionSender(sender)) return Promise.resolve({ ok: false });
          return restoreTab(msg.url).then(() => ({ ok: true }));

        case 'REMOVE_GRAVEYARD_ENTRY':
          if (!isExtensionSender(sender)) return Promise.resolve({ ok: false });
          return removeEntry(msg.id).then(() => ({ ok: true }));

        case 'CLEAR_GRAVEYARD':
          if (!isExtensionSender(sender)) return Promise.resolve({ ok: false });
          return clearAll().then(() => ({ ok: true }));

        case 'SAVE_SETTINGS':
          if (!isExtensionSender(sender)) return Promise.resolve({ ok: false });
          return saveSettings(msg.settings);

        case 'LOCK_TAB':
          if (!isExtensionSender(sender)) return Promise.resolve({ ok: false });
          return lockTab(msg.tabId).then(() => ({ ok: true }));

        case 'UNLOCK_TAB':
          if (!isExtensionSender(sender)) return Promise.resolve({ ok: false });
          return unlockTab(msg.tabId).then(() => ({ ok: true }));

        case 'GET_LOCKED_TABS':
          return getLockedTabs();

        case 'GET_PAUSE_STATE':
          return ensureReady().then(() => ({ paused: isPaused() }));

        case 'SET_PAUSE_STATE':
          if (!isExtensionSender(sender)) return Promise.resolve({ ok: false });
          return setPause(!!msg.paused)
            .then(() => syncBadge())
            .then(() => ({ ok: true, paused: isPaused() }));

        case 'EXPORT_DATA':
          if (!isExtensionSender(sender)) return Promise.resolve({ ok: false });
          return exportAllData();

        case 'IMPORT_DATA':
          if (!isExtensionSender(sender)) return Promise.resolve({ ok: false });
          return importData(msg.data).then(() => ({ ok: true }));

        default:
          return undefined;
      }
    }
  );
}
