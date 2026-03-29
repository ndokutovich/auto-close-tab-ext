import type { AgingStage } from '../shared/types';
import { STAGE_PREFIX, BLINK_CLOSING_TEXT } from '../shared/constants';
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

// Blink speed by stage — slower = gentle notice, faster = urgent
const BLINK_SPEED: Partial<Record<AgingStage, number>> = {
  3: 2000,  // slow pulse — "hey, this tab is getting old"
  4: 400,   // fast heartbeat — "about to die"
};

function startBlink(stage: AgingStage): void {
  const speed = BLINK_SPEED[stage];
  if (!speed) return;

  const baseTitle = originalTitle ?? stripAgingPrefix(document.title);

  // If already blinking at different speed, restart
  if (blinkInterval) {
    clearInterval(blinkInterval);
  }

  blinkState = false;
  blinkInterval = setInterval(() => {
    ignoreNextMutation = true;
    blinkState = !blinkState;
    if (stage === 4) {
      document.title = blinkState ? '\u26a0\ufe0f ' + BLINK_CLOSING_TEXT : baseTitle;
    } else {
      // Stage 3: subtle — blink between prefix and no prefix
      const prefix = STAGE_PREFIX[stage];
      document.title = blinkState ? prefix + baseTitle : baseTitle;
    }
  }, speed);
}

function stopBlink(): void {
  if (blinkInterval) {
    clearInterval(blinkInterval);
    blinkInterval = null;
    blinkState = false;
  }
}

function onTitleMutation(): void {
  if (ignoreNextMutation) {
    ignoreNextMutation = false;
    return;
  }

  const rawTitle = stripAgingPrefix(document.title);
  originalTitle = rawTitle;

  if (currentStage > 0) {
    applyPrefix(currentStage);
  }
}

function observeTitleElement(titleEl: Element): void {
  if (observer) observer.disconnect();
  observer = new MutationObserver(onTitleMutation);
  observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
}

let headObserver: MutationObserver | null = null;

function setupObserver(): void {
  const titleEl = document.querySelector('title');
  if (titleEl) {
    observeTitleElement(titleEl);
    return;
  }

  // No <title> yet — watch <head> for its appearance
  if (headObserver) return;
  const head = document.head || document.documentElement;
  headObserver = new MutationObserver(() => {
    const el = document.querySelector('title');
    if (el) {
      headObserver!.disconnect();
      headObserver = null;
      observeTitleElement(el);
    }
  });
  headObserver.observe(head, { childList: true });
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

  // Stages 3-4: blink with increasing urgency
  if (stage >= 3 && BLINK_SPEED[stage]) {
    startBlink(stage);
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
