import browser from 'webextension-polyfill';
import type { BgToContentMsg, ContentToBgMsg } from '../shared/types';
import { handleFaviconAging, resetFavicon } from './favicon-aging';
import { handleTitleAging, resetTitle } from './title-aging';

// Prevent double-injection (manifest + scripting.executeScript)
if ((window as any).__agingTabsInjected) {
  // Already running — don't register duplicate listeners
} else {
(window as any).__agingTabsInjected = true;

function applyAging(message: Extract<BgToContentMsg, { type: 'UPDATE_AGING' }>): void {
  // Each effect is gated by its own setting. Reset rather than skip when a
  // setting is off, otherwise turning it off would freeze the page with
  // whatever aging was already painted on it.
  if (message.faviconDimming) {
    handleFaviconAging(message.stage, message.timeRemainingMs);
  } else {
    resetFavicon();
  }

  // Prefix and blink are independent: prefix shows a static emoji, blink pulses
  // the last stages. Either one on means the title is in play; both off leaves
  // it untouched. (Blink used to be reachable only with prefix on — a dead
  // checkbox on the default settings.)
  if (message.titlePrefix || message.titleBlink) {
    handleTitleAging(message.stage, {
      prefix: message.titlePrefix,
      blink: message.titleBlink,
    });
  } else {
    resetTitle();
  }
}

browser.runtime.onMessage.addListener((rawMessage: unknown) => {
  const message = rawMessage as BgToContentMsg;
  switch (message.type) {
    case 'UPDATE_AGING':
      applyAging(message);
      break;

    case 'RESET_AGING':
      resetFavicon();
      resetTitle();
      break;

    case 'FETCH_FAVICON_RESULT':
      // Handled by favicon-aging via pending request resolution
      break;
  }
});

// Announce readiness and paint from the snapshot the background returns — a
// content script injected mid-life (first load or post-update replacement)
// would otherwise show nothing until the next stage transition.
browser.runtime
  .sendMessage({ type: 'CONTENT_READY' } satisfies ContentToBgMsg)
  .then((snapshot: unknown) => {
    const msg = snapshot as BgToContentMsg | null;
    if (msg && msg.type === 'UPDATE_AGING') applyAging(msg);
  })
  .catch(() => {});

} // end of double-injection guard
