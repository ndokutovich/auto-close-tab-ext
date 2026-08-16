/**
 * Security of the privileged favicon fetch (background side).
 *
 * The background runs with <all_urls> host permission, so a page-controlled
 * favicon URL that reaches fetch() is an SSRF primitive. Two holes the
 * cross-origin dimming fix opened:
 *
 *   - isAllowedFaviconUrl checks only the initial URL, but fetch() follows
 *     redirects, so a public URL can bounce to a private address.
 *   - the 1 MB cap was enforced only after res.blob() buffered the whole body,
 *     so a chunked response with no Content-Length could OOM the worker.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the registered onMessage listener so we can invoke it directly.
let listener: ((msg: unknown, sender: any) => Promise<any> | undefined) | null = null;
const sentToTab: any[] = [];

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      getURL: (p: string) => `chrome-extension://self/${p}`,
      onMessage: { addListener: (fn: any) => { listener = fn; } },
    },
    tabs: {
      sendMessage: vi.fn(async (_id: number, m: any) => { sentToTab.push(m); }),
    },
  },
}));

// The message handler only needs these storage exports to exist.
vi.mock('../shared/storage', () => ({
  getSettings: vi.fn(), saveSettings: vi.fn(), getGraveyard: vi.fn(),
  getLockedTabs: vi.fn(), lockTab: vi.fn(), unlockTab: vi.fn(),
  exportAllData: vi.fn(), importData: vi.fn(),
}));
vi.mock('../background/graveyard', () => ({
  restoreTab: vi.fn(), removeEntry: vi.fn(), clearAll: vi.fn(), syncBadge: vi.fn(),
}));
vi.mock('../background/tab-tracker', () => ({
  getAllTrackedTabIds: vi.fn(() => []), getLastAccessed: vi.fn(),
  getStage: vi.fn(), ensureReady: vi.fn(async () => {}), isPaused: vi.fn(),
  setPause: vi.fn(),
}));

/** Build a Response-like object with a streamed body of `size` bytes. */
function streamingResponse(url: string, size: number, contentLength: string | null, contentType = 'image/png') {
  let sent = 0;
  return {
    ok: true,
    url,
    headers: {
      get: (h: string) =>
        h.toLowerCase() === 'content-length' ? contentLength
        : h.toLowerCase() === 'content-type' ? contentType
        : null,
    },
    body: {
      getReader() {
        return {
          read: async () => {
            if (sent >= size) return { done: true, value: undefined };
            const chunk = Math.min(64 * 1024, size - sent);
            sent += chunk;
            return { done: false, value: new Uint8Array(chunk) };
          },
          cancel: async () => {},
        };
      },
    },
    blob: async () => ({ size }),
  };
}

const TAB_SENDER = { tab: { id: 7 }, url: 'https://example.com' };

async function callFetch(url: string) {
  return listener!({ type: 'FETCH_FAVICON_REQUEST', url, requestId: 'r1' }, TAB_SENDER);
}

describe('favicon fetch security', () => {
  beforeEach(async () => {
    listener = null;
    sentToTab.length = 0;
    vi.resetModules();
    vi.clearAllMocks();
    const { setupMessageListener } = await import('../background/messaging');
    setupMessageListener();
  });

  it('does not follow redirects at all (the request must not reach the target)', async () => {
    // redirect:'error' means fetch never issues the redirected request, so a
    // bounce toward an internal endpoint is never sent in the first place.
    const spy = vi.fn(async (_url: string, init: any) => {
      if (init?.redirect === 'error') throw new TypeError('redirect');
      return streamingResponse('http://192.168.1.1/camera.jpg', 1000, '1000');
    });
    globalThis.fetch = spy as any;

    const res = await callFetch('https://cdn.example.com/redirector');
    expect(res).toEqual({ ok: false });
    expect(sentToTab).toHaveLength(0);
    expect((spy.mock.calls[0] as any[])[1].redirect).toBe('error');
  });

  it('rejects IPv6 loopback and unique-local hosts', async () => {
    globalThis.fetch = vi.fn(async () =>
      streamingResponse('http://x/', 100, '100')
    ) as any;

    for (const url of ['http://[::1]/i.png', 'http://[fd00::1]/i.png', 'http://[fc00::1]/i.png']) {
      const res = await callFetch(url);
      expect(res).toEqual({ ok: false });
    }
    expect(sentToTab).toHaveLength(0);
  });

  it('rejects .local and bare-hostname (no dot) targets', async () => {
    globalThis.fetch = vi.fn(async () =>
      streamingResponse('http://x/', 100, '100')
    ) as any;

    for (const url of ['http://printer.local/favicon.ico', 'http://router/favicon.ico']) {
      const res = await callFetch(url);
      expect(res).toEqual({ ok: false });
    }
    expect(sentToTab).toHaveLength(0);
  });

  it('aborts a fetch that never completes (request deadline)', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(async (_url: string, init: any) => {
      signal = init?.signal;
      return {
        ok: true,
        url: 'https://cdn.example.com/slow.png',
        headers: { get: () => 'image/png' },
        body: {
          getReader: () => ({
            // Never resolves on its own — only the abort signal ends it.
            read: () => new Promise((_res, rej) => {
              signal?.addEventListener('abort', () => rej(new Error('aborted')));
            }),
            cancel: async () => {},
          }),
        },
      };
    }) as any;

    const p = callFetch('https://cdn.example.com/slow.png');
    await vi.advanceTimersByTimeAsync(15000); // past the request deadline
    const res = await p;
    expect(res).toEqual({ ok: false });
    expect(signal).toBeInstanceOf(AbortSignal);
    vi.useRealTimers();
  });

  it('aborts a response that streams past the size cap without Content-Length', async () => {
    const cancel = vi.fn(async () => {});
    globalThis.fetch = vi.fn(async () => {
      const r = streamingResponse('https://cdn.example.com/huge.png', 5 * 1024 * 1024, null);
      const origReader = r.body.getReader;
      r.body.getReader = () => { const rd = origReader(); rd.cancel = cancel; return rd; };
      return r;
    }) as any;

    const res = await callFetch('https://cdn.example.com/huge.png');
    expect(res).toEqual({ ok: false });
    expect(sentToTab).toHaveLength(0);
    expect(cancel).toHaveBeenCalled();
  });

  it('rejects a non-image content-type', async () => {
    globalThis.fetch = vi.fn(async () =>
      streamingResponse('https://cdn.example.com/x', 100, '100', 'text/html')
    ) as any;

    const res = await callFetch('https://cdn.example.com/x');
    expect(res).toEqual({ ok: false });
    expect(sentToTab).toHaveLength(0);
  });

  it('does not send cookies with the background fetch', async () => {
    const spy = vi.fn(async () => streamingResponse('https://cdn.example.com/i.png', 100, '100'));
    globalThis.fetch = spy as any;

    await callFetch('https://cdn.example.com/i.png');

    const init = (spy.mock.calls[0] as any[])?.[1] as RequestInit | undefined;
    expect(init?.credentials).toBe('omit');
  });

  it('passes a clean small same-final-origin image through', async () => {
    globalThis.fetch = vi.fn(async () =>
      streamingResponse('https://cdn.example.com/ok.png', 2048, '2048')
    ) as any;

    const res = await callFetch('https://cdn.example.com/ok.png');
    expect(res).toEqual({ ok: true });
    expect(sentToTab).toHaveLength(1);
    expect(sentToTab[0].type).toBe('FETCH_FAVICON_RESULT');
    expect(String(sentToTab[0].dataUrl)).toMatch(/^data:image\/png/);
  });
});
