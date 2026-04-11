/**
 * Shared DOM builder for graveyard entry elements.
 * Used by both popup and options pages.
 */

import type { GraveyardEntry } from './types';
import { defaultFavicon } from './pure';
import { FALLBACK_FAVICON } from './constants';
import { formatTimeI18n } from './i18n';

export interface EntryElementOptions {
  /** Store entry.id in dataset.entryId (needed for delegated click handlers) */
  storeEntryId?: boolean;
  /** Show a × remove button on each entry */
  showRemoveButton?: boolean;
}

export function createEntryElement(
  entry: GraveyardEntry,
  opts: EntryElementOptions = {},
): HTMLElement {
  const item = document.createElement('div');
  item.className = 'graveyard-item';
  item.dataset.url = entry.url;
  if (opts.storeEntryId) {
    item.dataset.entryId = entry.id;
  }

  const favicon = document.createElement('img');
  favicon.className = 'favicon';
  favicon.src = entry.faviconUrl || defaultFavicon(entry.url);
  favicon.onerror = () => { favicon.src = FALLBACK_FAVICON; };

  const info = document.createElement('div');
  info.className = 'info';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'tab-title';
  titleSpan.textContent = entry.title;

  const domainSpan = document.createElement('span');
  domainSpan.className = 'tab-domain';
  domainSpan.textContent = entry.domain;

  info.appendChild(titleSpan);
  info.appendChild(domainSpan);

  const timeSpan = document.createElement('span');
  timeSpan.className = 'tab-time';
  timeSpan.textContent = formatTimeI18n(entry.closedAt);

  item.appendChild(favicon);
  item.appendChild(info);
  item.appendChild(timeSpan);

  if (opts.showRemoveButton) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove';
    removeBtn.title = 'Remove from list';
    removeBtn.textContent = '\u00d7';
    item.appendChild(removeBtn);
  }

  return item;
}
