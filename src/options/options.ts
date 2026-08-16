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
const titleBlinkToggle = document.getElementById('titleBlink') as HTMLInputElement;
const customStagesToggle = document.getElementById('customStages') as HTMLInputElement;
const stageField = document.getElementById('stage-thresholds-field')!;
const stageErrorEl = document.getElementById('stage-error')!;
const stageInputs = [1, 2, 3, 4].map(
  n => document.getElementById(`stage${n}`) as HTMLInputElement,
);
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

function applySettingsToForm(settings: Settings): void {
  timeoutInput.value = String(settings.timeoutMinutes);
  minTabsInput.value = String(settings.minTabCount);
  expireActionSelect.value = settings.expireAction;
  closeEmptyToggle.checked = settings.closeEmptyTabs;
  protectGroupsToggle.checked = settings.protectGroupedTabs;
  faviconToggle.checked = settings.faviconDimming;
  titleToggle.checked = settings.titlePrefix;
  titleBlinkToggle.checked = settings.titleBlink;
  applyStageSettings(settings);
  whitelistArea.value = settings.whitelistedDomains.join('\n');
  graveyardSizeInput.value = String(settings.graveyardMaxSize);
  graveyardRetentionSelect.value = String(settings.graveyardRetentionDays);
  historySyncToggle.checked = settings.historySyncEnabled;
}

// Four distinct integer stages need a timeout of at least 5 minutes to fit
// below it (marks must be < timeout and strictly ascending). Custom stage
// timings are offered only at or above this.
const MIN_TIMEOUT_FOR_CUSTOM_STAGES = 5;

/**
 * Strictly-ascending default marks, all below the timeout. Built to be valid by
 * construction so enabling custom stages and saving without edits never trips
 * validation with the extension's own prefill.
 */
function evenStages(timeoutMinutes: number): number[] {
  const out: number[] = [];
  for (let n = 1; n <= 4; n++) {
    const even = Math.round((timeoutMinutes * n) / 5);
    // Keep each at least one above the previous, and at least one below timeout.
    const floor = (out[n - 2] ?? 0) + 1;
    out.push(Math.min(timeoutMinutes - 1, Math.max(floor, even)));
  }
  return out;
}

function customStagesSupported(timeoutMinutes: number): boolean {
  return timeoutMinutes >= MIN_TIMEOUT_FOR_CUSTOM_STAGES;
}

function refreshCustomStageAvailability(): void {
  const timeout = Number(timeoutInput.value) || 30;
  const supported = customStagesSupported(timeout);
  customStagesToggle.disabled = !supported;
  if (!supported) {
    customStagesToggle.checked = false;
    stageField.hidden = true;
  }
}

function applyStageSettings(settings: Settings): void {
  const custom = settings.stageThresholdMinutes;
  customStagesToggle.checked = custom !== null;
  stageField.hidden = custom === null;
  const values = custom ?? evenStages(settings.timeoutMinutes);
  stageInputs.forEach((input, i) => { input.value = String(values[i]); });
  stageErrorEl.hidden = true;
  refreshCustomStageAvailability();
}

/** null means "use even fractions"; otherwise the raw numbers typed. */
function readStageInputs(): number[] | null {
  if (!customStagesToggle.checked) return null;
  return stageInputs.map(input => Number(input.value));
}

/**
 * Mirror of normalizeStageThresholds' rule, including the timeout ceiling, so
 * the form blocks with a visible error instead of letting the backend silently
 * discard the schedule to null under a "Saved" message.
 */
function stageInputsValid(): boolean {
  if (!customStagesToggle.checked) return true;
  const values = readStageInputs()!;
  // Compare against the timeout as it will actually be stored — clamped to the
  // 30-day maximum — so a huge typed timeout can't wave through a stage mark
  // that the backend then rejects as unreachable.
  const timeout = Math.min(43200, Number(timeoutInput.value) || 30);
  return values.every((v, i) =>
    Number.isFinite(v) && v > 0 && v < timeout && (i === 0 || v > values[i - 1]),
  );
}

customStagesToggle.addEventListener('change', () => {
  stageField.hidden = !customStagesToggle.checked;
  if (customStagesToggle.checked) {
    const timeout = Number(timeoutInput.value) || 30;
    evenStages(timeout).forEach((v, i) => { stageInputs[i].value = String(v); });
  }
  stageErrorEl.hidden = true;
});

// A timeout change can make custom stages unavailable, or move the ceiling the
// stage values must sit under.
timeoutInput.addEventListener('input', refreshCustomStageAvailability);

async function loadSettings(): Promise<void> {
  applySettingsToForm(await browser.runtime.sendMessage({ type: 'GET_SETTINGS' }));
}

async function saveSettings(): Promise<void> {
  if (!stageInputsValid()) {
    stageErrorEl.hidden = false;
    saveStatusEl.textContent = msg('statusStageOrder');
    return;
  }
  stageErrorEl.hidden = true;

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
    titleBlink: titleBlinkToggle.checked,
    stageThresholdMinutes: readStageInputs(),
    whitelistedDomains: domains,
    graveyardMaxSize: Number(graveyardSizeInput.value) ?? 200,
    graveyardRetentionDays: Number(graveyardRetentionSelect.value) || 0,
    historySyncEnabled: historySyncToggle.checked,
  };

  // SAVE_SETTINGS returns what was actually stored after bounds enforcement.
  // Reflect it back into the form, otherwise "Saved" confirms a value the
  // backend silently clamped and the user never learns their input was capped.
  const stored: Settings = await browser.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });
  if (stored && typeof stored.timeoutMinutes === 'number') applySettingsToForm(stored);

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
