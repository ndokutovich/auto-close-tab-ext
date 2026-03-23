import browser from 'webextension-polyfill';
import type { Settings, GraveyardEntry } from '../shared/types';
import { formatTime, defaultFavicon } from '../shared/pure';
import { FALLBACK_FAVICON } from '../shared/constants';
import { msg, applyI18n } from '../shared/i18n';

applyI18n();

const timeoutInput = document.getElementById('timeout') as HTMLInputElement;
const minTabsInput = document.getElementById('minTabs') as HTMLInputElement;
const expireActionSelect = document.getElementById('expireAction') as HTMLSelectElement;
const closeEmptyToggle = document.getElementById('closeEmptyTabs') as HTMLInputElement;
const protectGroupsToggle = document.getElementById('protectGroupedTabs') as HTMLInputElement;
const faviconToggle = document.getElementById('faviconDimming') as HTMLInputElement;
const titleToggle = document.getElementById('titlePrefix') as HTMLInputElement;
const whitelistArea = document.getElementById('whitelist') as HTMLTextAreaElement;
const graveyardSizeInput = document.getElementById('graveyardSize') as HTMLInputElement;
const graveyardCountEl = document.getElementById('graveyard-count')!;
const graveyardListEl = document.getElementById('graveyard-list')!;
const btnExport = document.getElementById('btn-export')!;
const btnImport = document.getElementById('btn-import') as HTMLInputElement;
const btnClear = document.getElementById('btn-clear')!;
const btnSave = document.getElementById('btn-save')!;
const saveStatusEl = document.getElementById('save-status')!;

async function loadSettings(): Promise<void> {
  const settings: Settings = await browser.runtime.sendMessage({ type: 'GET_SETTINGS' });

  timeoutInput.value = String(settings.timeoutMinutes);
  minTabsInput.value = String(settings.minTabCount);
  expireActionSelect.value = settings.expireAction;
  closeEmptyToggle.checked = settings.closeEmptyTabs;
  protectGroupsToggle.checked = settings.protectGroupedTabs;
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

  // Bounds enforced in saveSettings — don't duplicate here
  const settings: Partial<Settings> = {
    timeoutMinutes: Number(timeoutInput.value) || 30,
    minTabCount: Number(minTabsInput.value) ?? 3,
    expireAction: expireActionSelect.value as 'close' | 'discard',
    closeEmptyTabs: closeEmptyToggle.checked,
    protectGroupedTabs: protectGroupsToggle.checked,
    faviconDimming: faviconToggle.checked,
    titlePrefix: titleToggle.checked,
    whitelistedDomains: domains,
    graveyardMaxSize: Number(graveyardSizeInput.value) ?? 200,
  };

  await browser.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });

  saveStatusEl.textContent = msg('statusSaved');
  setTimeout(() => { saveStatusEl.textContent = ''; }, 2000);
}

async function loadGraveyard(): Promise<void> {
  const entries: GraveyardEntry[] = await browser.runtime.sendMessage({ type: 'GET_GRAVEYARD' }) || [];
  const plural = entries.length !== 1 ? 's' : '';
  graveyardCountEl.textContent = msg('graveyardCount', String(entries.length), plural);

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

async function exportData(): Promise<void> {
  const data: string = await browser.runtime.sendMessage({ type: 'EXPORT_DATA' });
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aging-tabs-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importDataFromFile(file: File): Promise<void> {
  const text = await file.text();
  try {
    await browser.runtime.sendMessage({ type: 'IMPORT_DATA', data: text });
    await loadSettings();
    await loadGraveyard();
    saveStatusEl.textContent = msg('statusImported');
    setTimeout(() => { saveStatusEl.textContent = ''; }, 2000);
  } catch {
    saveStatusEl.textContent = msg('statusImportFailed');
    setTimeout(() => { saveStatusEl.textContent = ''; }, 3000);
  }
}

// --- Event handlers ---

btnSave.addEventListener('click', saveSettings);
btnClear.addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'CLEAR_GRAVEYARD' });
  await loadGraveyard();
});
btnExport.addEventListener('click', exportData);
btnImport.addEventListener('change', () => {
  const file = btnImport.files?.[0];
  if (file) {
    importDataFromFile(file);
    btnImport.value = '';
  }
});

loadSettings();
loadGraveyard();
