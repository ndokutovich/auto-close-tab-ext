import browser from 'webextension-polyfill';
import type { Settings } from '../shared/types';

export interface ImmunityContext {
  settings: Settings;
  activeTabId: number | undefined;
  totalTabCount: number;
}

export async function buildImmunityContext(settings: Settings): Promise<ImmunityContext> {
  const tabs = await browser.tabs.query({ currentWindow: true });
  const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });

  return {
    settings,
    activeTabId: activeTabs[0]?.id,
    totalTabCount: tabs.length,
  };
}

export function isImmune(
  tab: browser.Tabs.Tab,
  ctx: ImmunityContext
): boolean {
  // Active tab is always immune
  if (tab.id === ctx.activeTabId) return true;

  // Pinned tabs never close
  if (tab.pinned) return true;

  // Tabs playing audio are immune
  if (tab.audible) return true;

  // Don't close below minimum tab count
  if (ctx.totalTabCount <= ctx.settings.minTabCount) return true;

  // Whitelisted domains
  if (tab.url && ctx.settings.whitelistedDomains.length > 0) {
    try {
      const domain = new URL(tab.url).hostname;
      if (ctx.settings.whitelistedDomains.some(d => domain === d || domain.endsWith('.' + d))) {
        return true;
      }
    } catch {
      // Invalid URL, don't protect
    }
  }

  // Empty/new tabs — close them if setting is on (skip restricted URL protection)
  const emptyUrls = ['about:blank', 'about:newtab', 'chrome://newtab/'];
  if (tab.url && emptyUrls.includes(tab.url)) {
    return !ctx.settings.closeEmptyTabs;
  }

  // Restricted URLs that we can't control — protect them since user can't recover context
  if (tab.url) {
    const restricted = ['chrome://', 'about:', 'chrome-extension://', 'moz-extension://'];
    if (restricted.some(prefix => tab.url!.startsWith(prefix))) {
      return true;
    }
  }

  return false;
}
