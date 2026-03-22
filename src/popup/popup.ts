import browser from 'webextension-polyfill';
import type { GraveyardEntry } from '../shared/types';

const searchInput = document.getElementById('search') as HTMLInputElement;
const listEl = document.getElementById('graveyard-list')!;
const countEl = document.getElementById('graveyard-count')!;
const btnClear = document.getElementById('btn-clear')!;
const btnOptions = document.getElementById('btn-options')!;

let allEntries: GraveyardEntry[] = [];

async function loadGraveyard(): Promise<void> {
  allEntries = await browser.runtime.sendMessage({ type: 'GET_GRAVEYARD' }) || [];
  render(allEntries);
}

function createEntryElement(entry: GraveyardEntry): HTMLElement {
  const item = document.createElement('div');
  item.className = 'graveyard-item';
  item.dataset.url = entry.url;
  item.dataset.closedAt = String(entry.closedAt);

  const favicon = document.createElement('img');
  favicon.className = 'favicon';
  favicon.src = entry.faviconUrl || defaultFavicon(entry.url);
  favicon.onerror = () => {
    favicon.src = 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect fill="#3f3f46" width="16" height="16" rx="2"/></svg>'
    );
  };

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
  timeSpan.textContent = formatTime(entry.closedAt);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-remove';
  removeBtn.title = 'Remove from list';
  removeBtn.textContent = '\u00d7';

  item.appendChild(favicon);
  item.appendChild(info);
  item.appendChild(timeSpan);
  item.appendChild(removeBtn);

  return item;
}

function render(entries: GraveyardEntry[]): void {
  countEl.textContent = `${entries.length} tab${entries.length !== 1 ? 's' : ''}`;

  // Clear previous content
  while (listEl.firstChild) {
    listEl.removeChild(listEl.firstChild);
  }

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No closed tabs yet';
    listEl.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    fragment.appendChild(createEntryElement(entry));
  }
  listEl.appendChild(fragment);
}

function defaultFavicon(url: string): string {
  try {
    const origin = new URL(url).origin;
    return `${origin}/favicon.ico`;
  } catch {
    return '';
  }
}

function formatTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// --- Event handlers ---

listEl.addEventListener('click', async (e) => {
  const target = e.target as HTMLElement;
  const item = target.closest('.graveyard-item') as HTMLElement | null;
  if (!item) return;

  // Remove button
  if (target.classList.contains('btn-remove')) {
    e.stopPropagation();
    const closedAt = Number(item.dataset.closedAt);
    await browser.runtime.sendMessage({ type: 'REMOVE_GRAVEYARD_ENTRY', closedAt });
    await loadGraveyard();
    return;
  }

  // Restore tab
  const url = item.dataset.url;
  if (url) {
    await browser.runtime.sendMessage({ type: 'RESTORE_TAB', url });
    await loadGraveyard();
  }
});

searchInput.addEventListener('input', () => {
  const query = searchInput.value.toLowerCase().trim();
  if (!query) {
    render(allEntries);
    return;
  }

  const filtered = allEntries.filter(e =>
    e.title.toLowerCase().includes(query) ||
    e.url.toLowerCase().includes(query) ||
    e.domain.toLowerCase().includes(query)
  );
  render(filtered);
});

btnClear.addEventListener('click', async () => {
  if (allEntries.length === 0) return;
  await browser.runtime.sendMessage({ type: 'CLEAR_GRAVEYARD' });
  await loadGraveyard();
});

btnOptions.addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});

// Load on popup open
loadGraveyard();
