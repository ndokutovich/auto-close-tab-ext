import type { AgingStage } from '../shared/types';
import { STAGE_PREFIX } from '../shared/constants';
import { stripAgingPrefix } from '../shared/pure';

let originalTitle: string | null = null;
let currentStage: AgingStage = 0;
let observer: MutationObserver | null = null;
let ignoreNextMutation = false;
let blinkInterval: ReturnType<typeof setInterval> | null = null;
let blinkState = false;

function applyPrefix(stage: AgingStage): void {
  const prefix = STAGE_PREFIX[stage];
  const baseTitle = originalTitle ?? stripAgingPrefix(document.title);

  ignoreNextMutation = true;
  if (prefix) {
    document.title = prefix + baseTitle;
  } else {
    document.title = baseTitle;
  }
}

function startBlink(): void {
  if (blinkInterval) return;
  const baseTitle = originalTitle ?? stripAgingPrefix(document.title);

  blinkInterval = setInterval(() => {
    ignoreNextMutation = true;
    blinkState = !blinkState;
    document.title = blinkState ? '\u26a0\ufe0f Closing soon...' : baseTitle;
  }, 700);
}

function stopBlink(): void {
  if (blinkInterval) {
    clearInterval(blinkInterval);
    blinkInterval = null;
    blinkState = false;
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

    const rawTitle = stripAgingPrefix(document.title);
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

  if (originalTitle === null) {
    originalTitle = stripAgingPrefix(document.title);
  }

  setupObserver();

  // Stage 4: blink title as final warning
  if (stage >= 4) {
    startBlink();
  } else {
    stopBlink();
    applyPrefix(stage);
  }
}

export function resetTitle(): void {
  currentStage = 0;
  stopBlink();
  if (originalTitle !== null) {
    ignoreNextMutation = true;
    document.title = originalTitle;
    originalTitle = null;
  }
}
