import type { Settings, AgingStage } from './types';

export const DEFAULT_SETTINGS: Settings = {
  timeoutMinutes: 30,
  faviconDimming: true,
  titlePrefix: false,
  titleBlink: false,
  stageThresholdMinutes: null,
  closeEmptyTabs: true,
  protectGroupedTabs: true,
  expireAction: 'close',
  graveyardMaxSize: 200,
  graveyardRetentionDays: 0,
  historySyncEnabled: false,
  minTabCount: 3,
  whitelistedDomains: [],
};

export const ALARM_NAME = 'aging-tabs-check';
export const CHECK_INTERVAL_SECONDS = 30;

// How long an unclassified session waits for a startup/install event before it
// classifies itself live. A genuine browser launch fires onStartup within
// seconds (well under this); an event-less start (extension re-enable) self-
// classifies after it. In-memory only — it must NOT be a persisted alarm, which
// could survive a restart and fire before onStartup, closing on stale ids.
export const SESSION_CLASSIFY_GRACE_MS = 45_000;

// Timeout bounds, in minutes. The upper bound is 30 days: machines that are
// used weekly rather than daily need timeouts far beyond one day (issue #1).
export const MIN_TIMEOUT_MINUTES = 1;
export const MAX_TIMEOUT_MINUTES = 43_200;

// Seconds of inactivity before the OS is considered idle.
export const IDLE_DETECTION_SECONDS = 60;

// Ceiling for in-session inactive-time compensation (pause, idle).
// shiftTabTimes already clamps every tab to `now`, so this only guards against
// absurd clock skew turning into a nonsense span.
export const MAX_TIME_SHIFT_MS = 365 * 24 * 60 * 60 * 1000;

// Grayscale percentage for each aging stage
export const STAGE_GRAYSCALE: Record<AgingStage, number> = {
  0: 0,
  1: 25,
  2: 50,
  3: 75,
  4: 100,
};

// Title prefix emoji for each aging stage
export const STAGE_PREFIX: Record<AgingStage, string> = {
  0: '',
  1: '\u23f3 ',    // ⏳
  2: '\u23f3 ',    // ⏳
  3: '\ud83d\udca4 ', // 💤
  4: '\ud83d\udc7b ', // 👻
};

// Storage keys
export const STORAGE_KEYS = {
  SETTINGS: 'settings',
  TAB_TIMES: 'tabTimes',
  TAB_STAGES: 'tabStages',
  GRAVEYARD: 'graveyard',
  LOCKED_TABS: 'lockedTabs',
  PAUSED_SINCE: 'pausedSince',
  IDLE_SINCE: 'idleSince',
} as const;

// storage.session key. Present == this service worker is a *recycle* inside a
// live browser (the browser clears storage.session on restart AND on extension
// update/reload). Used only to fast-path recycle detection so tab-closing is not
// deferred; the browser-restart RESET is driven by runtime.onStartup, never by
// this marker's absence.
export const SESSION_MARKER_KEY = 'swSessionAlive';

// Number of aging stages (0-4)
export const MAX_STAGE: AgingStage = 4;

// Stage-4 blink replacement text (original title is unrecoverable from this)
export const BLINK_CLOSING_TEXT = 'Closing soon...';

// Fallback favicon for tabs with no or broken favicon
export const FALLBACK_FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect fill="#3f3f46" width="16" height="16" rx="2"/></svg>'
);
