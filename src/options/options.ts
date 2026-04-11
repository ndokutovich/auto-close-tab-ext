import browser from 'webextension-polyfill';
import type { Settings, GraveyardEntry } from '../shared/types';
import { createEntryElement } from '../shared/graveyard-ui';
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
const graveyardRetentionSelect = document.getElementById('graveyardRetention') as HTMLSelectElement;
const historySyncToggle = document.getElementById('historySyncEnabled') as HTMLInputElement;
const historySyncField = document.getElementById('history-sync-field')!;
const welcomeBanner = document.getElementById('welcome-banner')!;
const btnWelcomeDismiss = document.getElementById('btn-welcome-dismiss')!;
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
  graveyardRetentionSelect.value = String(settings.graveyardRetentionDays);
  historySyncToggle.checked = settings.historySyncEnabled;
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
    graveyardRetentionDays: Number(graveyardRetentionSelect.value) || 0,
    historySyncEnabled: historySyncToggle.checked,
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
    fragment.appendChild(createOptionsEntry(entry));
  }
  graveyardListEl.appendChild(fragment);
}

function createOptionsEntry(entry: GraveyardEntry): HTMLElement {
  const item = createEntryElement(entry);
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

// --- History sync permission flow ---

// Hide history sync toggle on browsers without history API (Safari)
try {
  if (!browser.history?.onVisitRemoved) {
    historySyncField.hidden = true;
  }
} catch {
  historySyncField.hidden = true;
}

historySyncToggle.addEventListener('change', async () => {
  if (historySyncToggle.checked) {
    try {
      const granted = await browser.permissions.request({ permissions: ['history'] });
      if (!granted) {
        historySyncToggle.checked = false;
        return;
      }
    } catch {
      historySyncToggle.checked = false;
      return;
    }
  }
  saveSettings();
});

// --- Welcome banner ---

if (new URLSearchParams(window.location.search).has('welcome')) {
  welcomeBanner.removeAttribute('hidden');
}

btnWelcomeDismiss.addEventListener('click', () => {
  welcomeBanner.setAttribute('hidden', '');
});

loadSettings();
loadGraveyard();
