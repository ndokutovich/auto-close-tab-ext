// Aging stages: 0 = fresh, 4 = about to close
export type AgingStage = 0 | 1 | 2 | 3 | 4;

// --- Settings ---

export interface Settings {
  timeoutMinutes: number;
  faviconDimming: boolean;
  titlePrefix: boolean;
  closeEmptyTabs: boolean;
  protectGroupedTabs: boolean;
  expireAction: 'close' | 'discard';
  graveyardMaxSize: number;
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
  | { type: 'UPDATE_AGING'; stage: AgingStage; timeRemainingMs: number }
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
  | { type: 'EXPORT_DATA' }
  | { type: 'IMPORT_DATA'; data: string };

// --- Messages: Background -> Popup/Options ---

export type BgToUiMsg =
  | { type: 'GRAVEYARD_UPDATED'; count: number }
  | { type: 'SETTINGS_UPDATED'; settings: Settings };

// --- Union for runtime.onMessage ---

export type ExtensionMessage = BgToContentMsg | ContentToBgMsg | UiToBgMsg;

// --- Storage schema keys ---

export interface StorageSchema {
  settings: Settings;
  tabTimes: Record<number, number>;
  tabStages: Record<number, AgingStage>;
  graveyard: GraveyardEntry[];
  lockedTabs: number[];
}
