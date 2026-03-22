import type { AgingStage } from '../shared/types';
import { STAGE_PREFIX } from '../shared/constants';

let originalTitle: string | null = null;
let currentStage: AgingStage = 0;
let observer: MutationObserver | null = null;
let ignoreNextMutation = false;

function getPrefix(stage: AgingStage): string {
  return STAGE_PREFIX[stage];
}

function stripPrefix(title: string): string {
  // Remove any known prefix pattern
  for (const prefix of Object.values(STAGE_PREFIX)) {
    if (prefix && title.startsWith(prefix)) {
      return title.slice(prefix.length);
    }
  }
  return title;
}

function applyPrefix(stage: AgingStage): void {
  const prefix = getPrefix(stage);
  const baseTitle = originalTitle ?? stripPrefix(document.title);

  ignoreNextMutation = true;
  if (prefix) {
    document.title = prefix + baseTitle;
  } else {
    document.title = baseTitle;
  }
}

function setupObserver(): void {
  if (observer) return;

  const titleEl = document.querySelector('title');
  if (!titleEl) return;

  observer = new MutationObserver(() => {
    if (ignoreNextMutation) {
      ignoreNextMutation = false;
      return;
    }

    // SPA changed the title — update our original and re-apply prefix
    const rawTitle = stripPrefix(document.title);
    originalTitle = rawTitle;

    if (currentStage > 0) {
      applyPrefix(currentStage);
    }
  });

  observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
}

export function handleTitleAging(stage: AgingStage): void {
  currentStage = stage;

  if (stage === 0) {
    resetTitle();
    return;
  }

  // Capture original on first aging
  if (originalTitle === null) {
    originalTitle = stripPrefix(document.title);
  }

  setupObserver();
  applyPrefix(stage);
}

export function resetTitle(): void {
  currentStage = 0;
  if (originalTitle !== null) {
    ignoreNextMutation = true;
    document.title = originalTitle;
    originalTitle = null;
  }
}
