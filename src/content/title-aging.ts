import type { AgingStage } from '../shared/types';
import { STAGE_PREFIX, BLINK_CLOSING_TEXT } from '../shared/constants';
import { stripAgingPrefix } from '../shared/pure';

let originalTitle: string | null = null;
let currentStage: AgingStage = 0;
let observer: MutationObserver | null = null;
let ignoreNextMutation = false;
let blinkInterval: ReturnType<typeof setInterval> | null = null;
let blinkState = false;
// Whether the static emoji prefix is currently wanted. Tracked so the title
// MutationObserver reapplies the prefix only when it was actually enabled.
let prefixEnabled = false;

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

  // Only reassert a static prefix; while blinking, the interval owns the title.
  if (currentStage > 0 && prefixEnabled && !blinkInterval) {
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

export function handleTitleAging(
  stage: AgingStage,
  opts: { prefix: boolean; blink: boolean } = { prefix: true, blink: false },
): void {
  currentStage = stage;
  prefixEnabled = opts.prefix;

  if (stage === 0) {
    resetTitle();
    return;
  }

  if (originalTitle === null) {
    originalTitle = stripAgingPrefix(document.title);
  }

  setupObserver();

  // Blink owns stages 3-4 when enabled — even without a static prefix, so the
  // pulse is its own opt-in and not smuggled in behind titlePrefix.
  if (opts.blink && stage >= 3 && BLINK_SPEED[stage]) {
    startBlink(stage);
  } else {
    stopBlink();
    // With no prefix and no blink at this stage there is nothing to show; make
    // sure any earlier prefix is cleared rather than left frozen.
    if (opts.prefix) {
      applyPrefix(stage);
    } else if (originalTitle !== null) {
      ignoreNextMutation = true;
      document.title = originalTitle;
    }
  }
}

export function resetTitle(): void {
  currentStage = 0;
  prefixEnabled = false;
  stopBlink();
  if (originalTitle !== null) {
    ignoreNextMutation = true;
    document.title = originalTitle;
    originalTitle = null;
  }
}
