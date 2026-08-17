import browser from 'webextension-polyfill';
import type { ExtensionMessage } from '../shared/types';
import { getSettings, saveSettings, getGraveyard, getLockedTabs, lockTab, unlockTab, exportAllData, importData } from '../shared/storage';
import { restoreTab, removeEntry, clearAll } from './graveyard';
import { getAllTrackedTabIds, getLastAccessed, getStage, ensureReady, isPaused, setPause, getVisitedTabIds } from './tab-tracker';
import { refreshVisualsForAllTabs, currentAgingMessageFor } from './timer-manager';
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

  // URL.hostname lower-cases and, for IPv6, wraps in brackets: `[::1]`.
  const host = parsed.hostname.toLowerCase();

  // IPv6: loopback and unique-local (fc00::/7 -> fc.. / fd..). Bracketed form.
  if (host.startsWith('[')) {
    const inner = host.slice(1, -1);
    if (inner === '::1' || inner.startsWith('fc') || inner.startsWith('fd') ||
        inner.startsWith('fe80') /* link-local */) {
      return false;
    }
  }

  // Named hosts that never point at the public internet.
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return false;
  }

  // A bare hostname with no dot (e.g. "router", "nas") resolves only on the
  // local network — reject it; a real public favicon host is always dotted.
  const isIpLiteral = host.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(host);
  if (!isIpLiteral && !host.includes('.')) {
    return false;
  }

  // Private / internal IPv4 ranges.
  if (
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('0.') ||
    host.startsWith('169.254.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return false;
  }

  // NOTE: a public hostname that resolves (via DNS) to a private address is not
  // caught here — that needs resolution we cannot do in-page. Following no
  // redirects (below) removes the redirect-based rebinding vector; the DNS-name
  // vector is a documented residual limitation.
  return true;
}

const MAX_FAVICON_BYTES = 1024 * 1024; // 1 MB

/**
 * Fetch a favicon from the privileged background context and return it as a
 * data: URL, or null if anything about the response is untrustworthy.
 *
 * Security-relevant choices, all because the URL is page-controlled and this
 * context holds <all_urls>:
 *   - redirects are followed but the FINAL url is re-validated, so a public URL
 *     cannot bounce the fetch onto a private address (SSRF).
 *   - credentials are omitted, so the request carries no cookies.
 *   - the body is read through a reader with a hard byte cap, so a response
 *     with no/By-lying Content-Length cannot buffer unbounded memory.
 *   - only image/* content types are accepted, so arbitrary bytes are never
 *     handed back to be set as an <img> source.
 */
const FAVICON_FETCH_TIMEOUT_MS = 10_000;

async function fetchFaviconDataUrl(url: string): Promise<string | null> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), FAVICON_FETCH_TIMEOUT_MS);
  try {
    // redirect:'error' — do NOT follow redirects. Following them would issue a
    // second, privileged request to a page-chosen location (an internal host,
    // a router endpoint) before any re-validation could run. A favicon that
    // 30x-redirects simply isn't dimmed; correctness costs nothing here.
    const res = await fetch(url, { redirect: 'error', credentials: 'omit', signal: controller.signal });
    if (!res.ok) return null;

    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) return null;

    const declared = res.headers.get('content-length');
    if (declared && Number(declared) > MAX_FAVICON_BYTES) return null;

    const reader = res.body?.getReader();
    if (!reader) return null;

    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_FAVICON_BYTES) {
          await reader.cancel().catch(() => {});
          return null;
        }
        chunks.push(value);
      }
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }

    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return `data:${contentType};base64,${btoa(binary)}`;
  } finally {
    clearTimeout(deadline);
  }
}

export function setupMessageListener(): void {
  browser.runtime.onMessage.addListener(
    (message: unknown, sender: browser.Runtime.MessageSender): Promise<any> | undefined => {
      const msg = message as ExtensionMessage;
      switch (msg.type) {
        // --- Content script messages (any sender) ---

        case 'CONTENT_READY':
          // A freshly injected content script (first load, or replacing an old
          // one after an extension update) holds no state. Hand it the tab's
          // current aging so it paints correctly at once, rather than waiting
          // for the next stage transition — which at stage 4 never comes.
          if (sender.tab?.id === undefined) return Promise.resolve(null);
          return currentAgingMessageFor(sender.tab.id).catch(() => null);

        case 'FETCH_FAVICON_REQUEST': {
          const { url, requestId } = msg;
          if (!isAllowedFaviconUrl(url)) {
            return Promise.resolve({ ok: false });
          }
          return fetchFaviconDataUrl(url)
            .then(dataUrl => {
              if (dataUrl && sender.tab?.id) {
                browser.tabs.sendMessage(sender.tab.id, {
                  type: 'FETCH_FAVICON_RESULT',
                  dataUrl,
                  requestId,
                });
                return { ok: true };
              }
              return { ok: false };
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

        case 'SAVE_SETTINGS': {
          if (!isExtensionSender(sender)) return Promise.resolve({ ok: false });
          return saveSettings(msg.settings).then(stored => {
            // Push the new visuals to every tab now — stage-delta gating would
            // otherwise never repaint tabs already showing an effect the user
            // just turned off. Fire-and-forget; the caller only needs `stored`.
            refreshVisualsForAllTabs().catch(() => {});
            return stored;
          });
        }

        case 'LOCK_TAB':
          if (!isExtensionSender(sender)) return Promise.resolve({ ok: false });
          return lockTab(msg.tabId).then(() => ({ ok: true }));

        case 'UNLOCK_TAB':
          if (!isExtensionSender(sender)) return Promise.resolve({ ok: false });
          return unlockTab(msg.tabId).then(() => ({ ok: true }));

        case 'GET_LOCKED_TABS':
          return getLockedTabs();

        case 'GET_VISITED_TABS':
          return ensureReady().then(() => getVisitedTabIds());

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
