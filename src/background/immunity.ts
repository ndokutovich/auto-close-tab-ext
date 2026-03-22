import type browser from 'webextension-polyfill';
import type { Settings } from '../shared/types';
import { extractDomain, isDomainWhitelisted, isRestrictedUrl } from '../shared/pure';

export interface ImmunityContext {
  settings: Settings;
  activeTabId: number | undefined;
  totalTabCount: number;
  lockedTabIds: Set<number>;
}

const EMPTY_TAB_URLS = ['about:blank', 'about:newtab', 'chrome://newtab/'];

export function buildImmunityContext(
  settings: Settings,
  tabs: browser.Tabs.Tab[],
  lockedTabIds: number[] = []
): ImmunityContext {
  const activeTab = tabs.find(t => t.active);
  return {
    settings,
    activeTabId: activeTab?.id,
    totalTabCount: tabs.length,
    lockedTabIds: new Set(lockedTabIds),
  };
}

export function isImmune(
  tab: browser.Tabs.Tab,
  ctx: ImmunityContext
): boolean {
  if (tab.id === ctx.activeTabId) return true;
  if (tab.pinned) return true;
  if (tab.audible) return true;
  if (tab.id !== undefined && ctx.lockedTabIds.has(tab.id)) return true;
  if (ctx.totalTabCount <= ctx.settings.minTabCount) return true;

  // Tab groups protection (FF 138+ / Chrome)
  if (ctx.settings.protectGroupedTabs && (tab as any).groupId !== undefined && (tab as any).groupId !== -1) {
    return true;
  }

  if (tab.url && ctx.settings.whitelistedDomains.length > 0) {
    const hostname = extractDomain(tab.url);
    if (hostname && isDomainWhitelisted(hostname, ctx.settings.whitelistedDomains)) {
      return true;
    }
  }

  if (tab.url && EMPTY_TAB_URLS.includes(tab.url)) {
    return !ctx.settings.closeEmptyTabs;
  }

  if (isRestrictedUrl(tab.url)) return true;

  return false;
}
