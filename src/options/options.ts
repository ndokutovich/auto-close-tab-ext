import browser from 'webextension-polyfill';
import type { Settings, GraveyardEntry } from '../shared/types';

const timeoutInput = document.getElementById('timeout') as HTMLInputElement;
const minTabsInput = document.getElementById('minTabs') as HTMLInputElement;
const faviconToggle = document.getElementById('faviconDimming') as HTMLInputElement;
const titleToggle = document.getElementById('titlePrefix') as HTMLInputElement;
const whitelistArea = document.getElementById('whitelist') as HTMLTextAreaElement;
const graveyardSizeInput = document.getElementById('graveyardSize') as HTMLInputElement;
const graveyardCountEl = document.getElementById('graveyard-count')!;
const graveyardListEl = document.getElementById('graveyard-list')!;
const btnClear = document.getElementById('btn-clear')!;
const btnSave = document.getElementById('btn-save')!;
const saveStatusEl = document.getElementById('save-status')!;

async function loadSettings(): Promise<void> {
  const settings: Settings = await browser.runtime.sendMessage({ type: 'GET_SETTINGS' });

  timeoutInput.value = String(settings.timeoutMinutes);
  minTabsInput.value = String(settings.minTabCount);
  faviconToggle.checked = settings.faviconDimming;
  titleToggle.checked = settings.titlePrefix;
  whitelistArea.value = settings.whitelistedDomains.join('\n');
  graveyardSizeInput.value = String(settings.graveyardMaxSize);
}

async function saveSettings(): Promise<void> {
  const domains = whitelistArea.value
    .split('\n')
    .map(d => d.trim().toLowerCase())
    .filter(d => d.length > 0);

  const settings: Partial<Settings> = {
    timeoutMinutes: Math.max(1, Number(timeoutInput.value) || 30),
    minTabCount: Math.max(1, Number(minTabsInput.value) || 3),
    faviconDimming: faviconToggle.checked,
    titlePrefix: titleToggle.checked,
    whitelistedDomains: domains,
    graveyardMaxSize: Math.max(10, Number(graveyardSizeInput.value) || 200),
  };

  await browser.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });

  saveStatusEl.textContent = 'Saved';
  setTimeout(() => { saveStatusEl.textContent = ''; }, 2000);
}

async function loadGraveyard(): Promise<void> {
  const entries: GraveyardEntry[] = await browser.runtime.sendMessage({ type: 'GET_GRAVEYARD' }) || [];
  graveyardCountEl.textContent = `${entries.length} tab${entries.length !== 1 ? 's' : ''} in graveyard`;

  // Clear previous
  while (graveyardListEl.firstChild) {
    graveyardListEl.removeChild(graveyardListEl.firstChild);
  }

  if (entries.length === 0) return;

  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    fragment.appendChild(createEntryElement(entry));
  }
  graveyardListEl.appendChild(fragment);
}

function createEntryElement(entry: GraveyardEntry): HTMLElement {
  const item = document.createElement('div');
  item.className = 'graveyard-item';
  item.dataset.url = entry.url;

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

  item.appendChild(favicon);
  item.appendChild(info);
  item.appendChild(timeSpan);

  item.addEventListener('click', async () => {
    await browser.runtime.sendMessage({ type: 'RESTORE_TAB', url: entry.url });
    await loadGraveyard();
  });

  return item;
}

function defaultFavicon(url: string): string {
  try {
    return new URL(url).origin + '/favicon.ico';
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

btnSave.addEventListener('click', saveSettings);
btnClear.addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'CLEAR_GRAVEYARD' });
  await loadGraveyard();
});

// Load on page open
loadSettings();
loadGraveyard();
