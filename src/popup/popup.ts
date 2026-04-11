import browser from 'webextension-polyfill';
import type { GraveyardEntry } from '../shared/types';
import { sortGraveyard, type GraveyardSortMode } from '../shared/pure';
import { createEntryElement } from '../shared/graveyard-ui';
import { msg, applyI18n } from '../shared/i18n';

applyI18n();

const searchInput = document.getElementById('search') as HTMLInputElement;
const sortSelect = document.getElementById('sort-mode') as HTMLSelectElement;
const listEl = document.getElementById('graveyard-list')!;
const countEl = document.getElementById('graveyard-count')!;
const btnClear = document.getElementById('btn-clear')!;
const btnOptions = document.getElementById('btn-options')!;
const btnPause = document.getElementById('btn-pause') as HTMLButtonElement;
const pauseBanner = document.getElementById('pause-banner')!;

let allEntries: GraveyardEntry[] = [];

async function loadGraveyard(): Promise<void> {
  allEntries = await browser.runtime.sendMessage({ type: 'GET_GRAVEYARD' }) || [];
  applyFilters();
}

function applyFilters(): void {
  const sortMode = sortSelect.value as GraveyardSortMode;
  let entries = sortGraveyard(allEntries, sortMode);

  const query = searchInput.value.toLowerCase().trim();
  if (query) {
    entries = entries.filter(e =>
      e.title.toLowerCase().includes(query) ||
      e.url.toLowerCase().includes(query) ||
      e.domain.toLowerCase().includes(query)
    );
  }

  render(entries);
}

function createPopupEntry(entry: GraveyardEntry): HTMLElement {
  return createEntryElement(entry, { storeEntryId: true, showRemoveButton: true });
}

function render(entries: GraveyardEntry[]): void {
  const plural = entries.length !== 1 ? 's' : '';
  countEl.textContent = msg('tabCount', String(entries.length), plural);

  while (listEl.firstChild) {
    listEl.removeChild(listEl.firstChild);
  }

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = msg('noClosedTabs');
    listEl.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    fragment.appendChild(createPopupEntry(entry));
  }
  listEl.appendChild(fragment);
}

// --- Event handlers ---

listEl.addEventListener('click', async (e) => {
  const target = e.target as HTMLElement;
  const item = target.closest('.graveyard-item') as HTMLElement | null;
  if (!item) return;

  if (target.classList.contains('btn-remove')) {
    e.stopPropagation();
    const id = item.dataset.entryId!;
    await browser.runtime.sendMessage({ type: 'REMOVE_GRAVEYARD_ENTRY', id });
    await loadGraveyard();
    return;
  }

  const url = item.dataset.url;
  const id = item.dataset.entryId!;
  if (url) {
    await browser.runtime.sendMessage({ type: 'RESTORE_TAB', url });
    await browser.runtime.sendMessage({ type: 'REMOVE_GRAVEYARD_ENTRY', id });
    window.close();
  }
});

searchInput.addEventListener('input', applyFilters);
sortSelect.addEventListener('change', applyFilters);

btnClear.addEventListener('click', async () => {
  if (allEntries.length === 0) return;
  await browser.runtime.sendMessage({ type: 'CLEAR_GRAVEYARD' });
  await loadGraveyard();
});

btnOptions.addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});

// --- Pause toggle ---

function applyPauseState(paused: boolean): void {
  btnPause.classList.toggle('is-paused', paused);
  btnPause.setAttribute('aria-pressed', paused ? 'true' : 'false');
  btnPause.title = msg(paused ? 'resumeAging' : 'pauseAging');
  if (paused) {
    pauseBanner.removeAttribute('hidden');
  } else {
    pauseBanner.setAttribute('hidden', '');
  }
}

async function loadPauseState(): Promise<void> {
  try {
    const state = await browser.runtime.sendMessage({ type: 'GET_PAUSE_STATE' }) as { paused?: boolean } | undefined;
    applyPauseState(!!state?.paused);
  } catch {
    applyPauseState(false);
  }
}

btnPause.addEventListener('click', async () => {
  const currentlyPaused = btnPause.classList.contains('is-paused');
  const next = !currentlyPaused;
  // Optimistic UI update
  applyPauseState(next);
  try {
    const res = await browser.runtime.sendMessage({
      type: 'SET_PAUSE_STATE',
      paused: next,
    }) as { ok?: boolean; paused?: boolean } | undefined;
    // Reconcile with server-reported state (in case of error)
    if (res && typeof res.paused === 'boolean') {
      applyPauseState(res.paused);
    }
  } catch {
    // Revert on error
    applyPauseState(currentlyPaused);
  }
});

loadGraveyard();
loadPauseState();
