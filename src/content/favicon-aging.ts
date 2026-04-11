import browser from 'webextension-polyfill';
import type { AgingStage } from '../shared/types';
import { STAGE_GRAYSCALE } from '../shared/constants';

let originalFaviconUrl: string | null = null;
let lastAppliedDataUrl: string | null = null;
let canvas: HTMLCanvasElement | null = null;

function getOrCreateCanvas(): HTMLCanvasElement {
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
  }
  return canvas;
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

function applyGrayscale(img: HTMLImageElement, percentage: number): string {
  const c = getOrCreateCanvas();
  const ctx = c.getContext('2d')!;

  const w = img.naturalWidth || 32;
  const h = img.naturalHeight || 32;
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.filter = `grayscale(${percentage}%)`;
  ctx.globalAlpha = 1 - (percentage / 100) * 0.3; // slight fade at full grayscale
  ctx.drawImage(img, 0, 0, c.width, c.height);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;

  return c.toDataURL('image/png');
}

export function handleFaviconAging(stage: AgingStage, _timeRemainingMs: number): void {
  if (stage === 0) {
    resetFavicon();
    return;
  }

  // Capture original on first aging, re-capture if the page changed its favicon
  // (e.g. notification badges, dynamic favicons). We compare against what we
  // last applied to distinguish page-initiated changes from our own grayscale.
  const currentUrl = getCurrentFaviconUrl();
  if (originalFaviconUrl === null) {
    originalFaviconUrl = currentUrl;
  } else if (currentUrl !== lastAppliedDataUrl && currentUrl !== originalFaviconUrl) {
    originalFaviconUrl = currentUrl;
  }

  const percentage = STAGE_GRAYSCALE[stage];
  const img = new Image();
  img.crossOrigin = 'anonymous';

  img.onload = () => {
    try {
      const dataUrl = applyGrayscale(img, percentage);
      lastAppliedDataUrl = dataUrl;
      setFavicon(dataUrl);
    } catch {
      // Canvas tainted by CORS — request background to fetch
      requestFaviconViaBackground(originalFaviconUrl!, percentage);
    }
  };

  img.onerror = () => {
    // Can't load favicon — skip visual aging for this tab
  };

  img.src = originalFaviconUrl;
}

export function resetFavicon(): void {
  if (originalFaviconUrl !== null) {
    setFavicon(originalFaviconUrl);
    originalFaviconUrl = null;
    lastAppliedDataUrl = null;
  }
}

// Fallback: ask background to fetch cross-origin favicon
async function requestFaviconViaBackground(url: string, percentage: number): Promise<void> {
  try {
    const requestId = `${Date.now()}-${Math.random()}`;

    const handler = (message: any) => {
      if (message.type === 'FETCH_FAVICON_RESULT' && message.requestId === requestId) {
        browser.runtime.onMessage.removeListener(handler);
        clearTimeout(timeoutId);
        const img = new Image();
        img.onload = () => {
          const dataUrl = applyGrayscale(img, percentage);
          lastAppliedDataUrl = dataUrl;
          setFavicon(dataUrl);
        };
        img.src = message.dataUrl;
      }
    };

    browser.runtime.onMessage.addListener(handler);
    // Remove listener after 5s if background never replies (prevents leak)
    const timeoutId = setTimeout(() => {
      browser.runtime.onMessage.removeListener(handler);
    }, 5000);

    const res = await browser.runtime.sendMessage({
      type: 'FETCH_FAVICON_REQUEST',
      url,
      requestId,
    }) as { ok?: boolean } | undefined;
    // Background returns { ok: false } when fetch fails — clean up early
    if (res && !res.ok) {
      clearTimeout(timeoutId);
      browser.runtime.onMessage.removeListener(handler);
    }
  } catch {
    // Background not available
  }
}
