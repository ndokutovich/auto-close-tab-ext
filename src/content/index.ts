import browser from 'webextension-polyfill';
import type { BgToContentMsg, ContentToBgMsg } from '../shared/types';
import { handleFaviconAging, resetFavicon } from './favicon-aging';
import { handleTitleAging, resetTitle } from './title-aging';

// Prevent double-injection (manifest + scripting.executeScript)
if ((window as any).__agingTabsInjected) {
  // Already running — don't register duplicate listeners
} else {
(window as any).__agingTabsInjected = true;

browser.runtime.onMessage.addListener((rawMessage: unknown) => {
  const message = rawMessage as BgToContentMsg;
  switch (message.type) {
    case 'UPDATE_AGING':
      // Each effect is gated by its own setting. Reset rather than skip when a
      // setting is off, otherwise turning it off would freeze the page with
      // whatever aging was already painted on it.
      if (message.faviconDimming) {
        handleFaviconAging(message.stage, message.timeRemainingMs);
      } else {
        resetFavicon();
      }

      if (message.titlePrefix) {
        handleTitleAging(message.stage, message.titleBlink);
      } else {
        resetTitle();
      }
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

// Notify background that content script is ready
browser.runtime.sendMessage({ type: 'CONTENT_READY' } satisfies ContentToBgMsg).catch(() => {});

} // end of double-injection guard
