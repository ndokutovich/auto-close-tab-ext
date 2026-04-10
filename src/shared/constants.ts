import type { Settings, AgingStage } from './types';

export const DEFAULT_SETTINGS: Settings = {
  timeoutMinutes: 30,
  faviconDimming: true,
  titlePrefix: false,
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
} as const;

// Number of aging stages (0-4)
export const MAX_STAGE: AgingStage = 4;

// Stage-4 blink replacement text (original title is unrecoverable from this)
export const BLINK_CLOSING_TEXT = 'Closing soon...';

// Fallback favicon for tabs with no or broken favicon
export const FALLBACK_FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect fill="#3f3f46" width="16" height="16" rx="2"/></svg>'
);
