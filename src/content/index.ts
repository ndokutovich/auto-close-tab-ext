import browser from 'webextension-polyfill';
import type { BgToContentMsg, ContentToBgMsg } from '../shared/types';
import { handleFaviconAging, resetFavicon } from './favicon-aging';
import { handleTitleAging, resetTitle } from './title-aging';

browser.runtime.onMessage.addListener((message: BgToContentMsg) => {
  switch (message.type) {
    case 'UPDATE_AGING':
      handleFaviconAging(message.stage, message.timeRemainingMs);
      handleTitleAging(message.stage);
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
browser.runtime.sendMessage({ type: 'CONTENT_READY' } satisfies ContentToBgMsg).catch(() => {
  // Background might not be listening yet, that's fine
});
