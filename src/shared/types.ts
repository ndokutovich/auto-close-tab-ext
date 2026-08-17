// Aging stages: 0 = fresh, 4 = about to close
export type AgingStage = 0 | 1 | 2 | 3 | 4;

// --- Settings ---

export interface Settings {
  timeoutMinutes: number;
  faviconDimming: boolean;
  titlePrefix: boolean;
  // Pulse the title at stages 3-4. Opt-in: a blinking tab title is distracting,
  // and the static stage emoji already carries the same information.
  titleBlink: boolean;
  // Explicit minute marks at which stages 1..4 begin. null = derive them from
  // the timeout as even fractions, which is the original behaviour.
  stageThresholdMinutes: number[] | null;
  closeEmptyTabs: boolean;
  protectGroupedTabs: boolean;
  // Opt-in: a tab never focused this session is immune (its timer starts only on
  // the first visit), so a not-yet-triaged tab is not closed before you see it.
  protectUnvisited: boolean;
  // Only meaningful with protectUnvisited. false = tabs open at a browser restart
  // age normally; true = restored tabs are re-protected until each is clicked.
  reprotectRestoredTabs: boolean;
  expireAction: 'close' | 'discard';
  graveyardMaxSize: number;
  graveyardRetentionDays: number;
  historySyncEnabled: boolean;
  minTabCount: number;
  whitelistedDomains: string[];
}

// --- Graveyard ---

export interface GraveyardEntry {
  id: string;
  url: string;
  title: string;
  faviconUrl: string;
  closedAt: number;
  domain: string;
}

// --- Tab state tracked in background ---

export interface TrackedTab {
  lastAccessed: number;
  stage: AgingStage;
}

// --- Messages: Background -> Content Script ---

export type BgToContentMsg =
  // The visual flags ride along with every update: the content script holds no
  // settings of its own, so whatever the background sends is authoritative.
  | {
      type: 'UPDATE_AGING';
      stage: AgingStage;
      timeRemainingMs: number;
      faviconDimming: boolean;
      titlePrefix: boolean;
      titleBlink: boolean;
    }
  | { type: 'RESET_AGING' }
  | { type: 'FETCH_FAVICON_RESULT'; dataUrl: string; requestId: string };

// --- Messages: Content Script -> Background ---

export type ContentToBgMsg =
  | { type: 'CONTENT_READY' }
  | { type: 'FETCH_FAVICON_REQUEST'; url: string; requestId: string };

// --- Messages: Popup/Options -> Background ---

export type UiToBgMsg =
  | { type: 'GET_GRAVEYARD' }
  | { type: 'RESTORE_TAB'; url: string }
  | { type: 'REMOVE_GRAVEYARD_ENTRY'; id: string }
  | { type: 'CLEAR_GRAVEYARD' }
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; settings: Partial<Settings> }
  | { type: 'GET_TAB_STATES' }
  | { type: 'LOCK_TAB'; tabId: number }
  | { type: 'UNLOCK_TAB'; tabId: number }
  | { type: 'GET_LOCKED_TABS' }
  | { type: 'GET_VISITED_TABS' }
  | { type: 'GET_PAUSE_STATE' }
  | { type: 'SET_PAUSE_STATE'; paused: boolean }
  | { type: 'EXPORT_DATA' }
  | { type: 'IMPORT_DATA'; data: string };

// --- Messages: Background -> Popup/Options ---

export type BgToUiMsg =
  | { type: 'GRAVEYARD_UPDATED'; count: number }
  | { type: 'SETTINGS_UPDATED'; settings: Settings }
  | { type: 'PAUSE_STATE_CHANGED'; paused: boolean };

// --- Union for runtime.onMessage ---

export type ExtensionMessage = BgToContentMsg | ContentToBgMsg | UiToBgMsg;

// --- Storage schema keys ---

export interface StorageSchema {
  settings: Settings;
  tabTimes: Record<number, number>;
  tabStages: Record<number, AgingStage>;
  graveyard: GraveyardEntry[];
  lockedTabs: number[];
  // Timestamp when aging was globally paused. null = not paused.
  // On unpause, all tabTimes are shifted forward by (now - pausedSince),
  // capped at `now` for tabs activated during the pause.
  pausedSince: number | null;
}
