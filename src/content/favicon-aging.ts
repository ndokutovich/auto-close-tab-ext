import browser from 'webextension-polyfill';
import type { AgingStage } from '../shared/types';
import { STAGE_GRAYSCALE } from '../shared/constants';

let originalFaviconUrl: string | null = null;
let lastAppliedDataUrl: string | null = null;

// Bumped on every stage change and every reset. Async work (image load,
// background fetch) captures the value at request time and bails if it moved —
// so a slow load that finishes after the tab was reset or restaged can no
// longer paint a stale icon over the current one.
let generation = 0;

// A single 32x32 canvas, reused. Favicons render at 32px, so there is no reason
// to back an image's natural size — an 8192x8192 SVG favicon would otherwise
// demand ~256 MiB per draw. Reassigning `width` also resets the canvas's
// origin-clean flag, so a cross-origin draw that tainted it does not poison the
// next (clean, background-fetched) draw.
let canvas: HTMLCanvasElement | null = null;
function drawGrayscale(img: HTMLImageElement, percentage: number): string {
  if (!canvas) canvas = document.createElement('canvas');
  canvas.width = 32; // also clears any prior taint
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 32, 32);
  ctx.filter = `grayscale(${percentage}%)`;
  ctx.globalAlpha = 1 - (percentage / 100) * 0.3; // slight fade at full grayscale
  ctx.drawImage(img, 0, 0, 32, 32);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  return canvas.toDataURL('image/png');
}

function getCurrentFaviconUrl(): string {
  const link = document.querySelector<HTMLLinkElement>(
    'link[rel="icon"], link[rel="shortcut icon"]'
  );
  return link?.href || `${location.origin}/favicon.ico`;
}

function setFavicon(dataUrl: string): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = dataUrl;
}

export function handleFaviconAging(stage: AgingStage, _timeRemainingMs: number): void {
  if (stage === 0) {
    resetFavicon();
    return;
  }

  const currentUrl = getCurrentFaviconUrl();
  // Never adopt one of our own dimmed data: URLs as the "original" — doing so
  // would make resetFavicon restore a gray icon permanently.
  const currentIsOurs = currentUrl === lastAppliedDataUrl || currentUrl.startsWith('data:');
  if (originalFaviconUrl === null) {
    originalFaviconUrl = currentIsOurs ? null : currentUrl;
  } else if (!currentIsOurs && currentUrl !== originalFaviconUrl) {
    // Page changed its own favicon (badge, dynamic icon) — re-capture.
    originalFaviconUrl = currentUrl;
  }
  if (originalFaviconUrl === null) return;

  const percentage = STAGE_GRAYSCALE[stage];
  const gen = ++generation;
  const sourceUrl = originalFaviconUrl;
  const img = new Image();

  // Deliberately NOT setting img.crossOrigin. With it, a favicon served without
  // CORS headers — the common case for CDN-hosted icons — fails to load at all,
  // so onerror fired and dimming silently did nothing. Letting the load succeed
  // taints the canvas instead, toDataURL throws, and the background fetch below
  // (which has host permissions) takes over.

  img.onload = () => {
    if (gen !== generation) return; // superseded by a newer stage or a reset
    try {
      const dataUrl = drawGrayscale(img, percentage);
      lastAppliedDataUrl = dataUrl;
      setFavicon(dataUrl);
    } catch {
      requestFaviconViaBackground(sourceUrl, percentage, gen);
    }
  };

  img.onerror = () => {
    if (gen !== generation) return;
    requestFaviconViaBackground(sourceUrl, percentage, gen);
  };

  img.src = sourceUrl;
}

export function resetFavicon(): void {
  generation++; // invalidate any in-flight load/fetch
  // Forget which URLs were unfetchable so a transient failure (a one-off 503,
  // a network blip) does not permanently suppress dimming for this page.
  faviconUnfetchable.clear();
  if (originalFaviconUrl !== null) {
    setFavicon(originalFaviconUrl);
    originalFaviconUrl = null;
    lastAppliedDataUrl = null;
  }
}

// Per-origin favicon fetched once from the background, keyed by source URL, so
// aging through four stages does not re-download the same icon four times.
// Grayscale is reapplied locally from the cached raw bytes on each stage.
const rawFaviconCache = new Map<string, string>();
// A page rarely uses more than a couple of favicon origins; cap so a page that
// churns favicon URLs cannot retain unbounded ~1 MB entries.
const RAW_FAVICON_CACHE_MAX = 8;
function cacheRawFavicon(url: string, dataUrl: string): void {
  if (rawFaviconCache.size >= RAW_FAVICON_CACHE_MAX) {
    // Evict the oldest (Map preserves insertion order).
    const oldest = rawFaviconCache.keys().next().value;
    if (oldest !== undefined) rawFaviconCache.delete(oldest);
  }
  rawFaviconCache.set(url, dataUrl);
}
// Source URLs the background could not fetch (dead /favicon.ico guesses, blocked
// hosts) — remembered so every stage change does not retry a doomed request.
// Cleared on reset so a transient failure is not remembered forever.
const faviconUnfetchable = new Set<string>();

/** Redraw a cached/received raw favicon data: URL at the given grayscale. */
function drawFromRaw(rawDataUrl: string, percentage: number, gen: number): void {
  const img = new Image();
  img.onload = () => {
    if (gen !== generation) return;
    try {
      // A data: URL is same-origin, so the canvas stays clean here.
      const dataUrl = drawGrayscale(img, percentage);
      lastAppliedDataUrl = dataUrl;
      setFavicon(dataUrl);
    } catch {
      // Nothing further to try — leave the icon as the page set it.
    }
  };
  img.src = rawDataUrl;
}

// Fallback: ask the background (host permissions, not bound by page origin) to
// fetch the icon and return it as a same-origin data: URL we can redraw.
async function requestFaviconViaBackground(
  url: string,
  percentage: number,
  gen: number,
): Promise<void> {
  if (faviconUnfetchable.has(url)) return; // known dead — don't retry
  const cached = rawFaviconCache.get(url);
  if (cached) { drawFromRaw(cached, percentage, gen); return; }

  try {
    const requestId = `${gen}-${url}`;

    const handler = (message: any) => {
      if (message.type === 'FETCH_FAVICON_RESULT' && message.requestId === requestId) {
        browser.runtime.onMessage.removeListener(handler);
        clearTimeout(timeoutId);
        cacheRawFavicon(url, message.dataUrl);
        if (gen !== generation) return; // reset/restaged while we waited
        drawFromRaw(message.dataUrl, percentage, gen);
      }
    };

    browser.runtime.onMessage.addListener(handler);
    const timeoutId = setTimeout(() => {
      browser.runtime.onMessage.removeListener(handler);
    }, 5000);

    const res = await browser.runtime.sendMessage({
      type: 'FETCH_FAVICON_REQUEST',
      url,
      requestId,
    }) as { ok?: boolean } | undefined;
    if (res && !res.ok) {
      clearTimeout(timeoutId);
      browser.runtime.onMessage.removeListener(handler);
      faviconUnfetchable.add(url); // remember the failure; stop hammering it
    }
  } catch {
    // Background not available
  }
}
