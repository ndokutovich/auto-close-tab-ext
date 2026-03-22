# Aging Tabs — Feature Expansion Plan

## Context

Core extension is complete (auto-close + visual aging + graveyard + idle pause + notifications). Competitive analysis shows 7 features that competitors have and we don't. Adding all of them to reach feature parity with Tab Wrangler while keeping our unique UX advantages.

## Features to Add

### 1. Lock Tab (context menu + messaging)

**What**: Right-click tab → "Lock this tab" / "Unlock this tab". Locked tabs are immune to auto-close without needing to pin them. Lock state shown in popup.

**Files to modify**:
- `src/shared/types.ts` — add `LOCK_TAB` / `UNLOCK_TAB` / `GET_LOCKED_TABS` to `UiToBgMsg`
- `src/shared/storage.ts` — add `getLockedTabs()` / `setLockedTabs()` for `Set<number>` stored as array
- `src/shared/constants.ts` — add `STORAGE_KEYS.LOCKED_TABS`
- `src/background/immunity.ts` — add locked tab check in `isImmune()`
- `src/background/messaging.ts` — handle lock/unlock messages
- **New**: `src/background/context-menu.ts` — create/update context menu items
- `src/background/index.ts` — register context menu setup
- `src/manifests/*.json` — add `"contextMenus"` permission

### 2. Graveyard Sort/Filter by Domain

**What**: Popup gets a sort dropdown: "Recent" (default), "By domain", "A-Z". Options page graveyard gets the same.

**Files to modify**:
- `src/popup/popup.html` — add sort selector in header
- `src/popup/popup.ts` — sort logic before render
- `src/popup/popup.css` — style for sort control
- `src/options/options.ts` — same sort logic (extract to shared)
- `src/shared/pure.ts` — add `sortGraveyard(entries, mode)` pure function

### 3. JSON Export/Import Graveyard

**What**: Options page gets "Export" button (downloads JSON) and "Import" button (file picker, merges).

**Files to modify**:
- `src/options/options.html` — add Export/Import buttons in Graveyard section
- `src/options/options.ts` — export: `JSON.stringify` + download blob; import: file input + merge
- `src/shared/types.ts` — add `EXPORT_DATA` / `IMPORT_DATA` message types
- `src/background/messaging.ts` — handle export (return full storage) / import (merge + validate)

### 4. Keyboard Shortcut (lock current tab)

**What**: `Alt+L` locks/unlocks the current tab. Configurable in browser's shortcut settings.

**Files to modify**:
- `src/manifests/*.json` — add `"commands"` key with `"lock-current-tab"` command
- `src/background/index.ts` — add `browser.commands.onCommand` listener

### 5. i18n (EN + RU)

**What**: All UI strings externalized to `_locales/en/messages.json` and `_locales/ru/messages.json`.

**Files to create**:
- `src/_locales/en/messages.json`
- `src/_locales/ru/messages.json`
- `src/manifests/*.json` — add `"default_locale": "en"`

**Files to modify**:
- `src/popup/popup.html` — replace hardcoded text with `__MSG_key__` or `browser.i18n.getMessage()`
- `src/options/options.html` — same
- All `.ts` UI files — use `browser.i18n.getMessage()` for dynamic strings

### 6. Tab Groups Protection (FF 138+)

**What**: Tabs in a named group are immune to auto-close. Graceful fallback if API unavailable.

**Files to modify**:
- `src/background/immunity.ts` — check `tab.groupId !== undefined && tab.groupId !== -1`
- `src/shared/types.ts` — add `protectGroupedTabs: boolean` to `Settings`
- `src/shared/constants.ts` — default `true`
- `src/options/options.html` — add toggle
- `src/options/options.ts` — wire toggle

### 7. Discard Mode (alternative to close)

**What**: New setting "When tab expires: Close / Discard". Discard keeps tab in bar but unloads from memory. Graveyard not needed for discarded tabs.

**Files to modify**:
- `src/shared/types.ts` — add `expireAction: 'close' | 'discard'` to `Settings`
- `src/shared/constants.ts` — default `'close'`
- `src/background/timer-manager.ts` — in close loop: if discard mode, call `browser.tabs.discard(tabId)` instead of `tabs.remove()`
- `src/options/options.html` — add radio/select
- `src/options/options.ts` — wire setting

## Implementation Order

Grouped by dependency and blast radius (smallest first):

| Phase | Features | Why this order |
|-------|----------|---------------|
| A | 4 (shortcuts) + 1 (lock + context menu) | Lock is the most requested, shortcuts depend on it |
| B | 2 (sort) + 3 (export) | Graveyard improvements, independent of each other |
| C | 6 (groups) + 7 (discard) | New immunity/timer behaviors |
| D | 5 (i18n) | Touches every UI file, do last |

## Key Files Summary

| File | Features touching it |
|------|---------------------|
| `src/shared/types.ts` | 1, 2, 3, 5, 6, 7 |
| `src/shared/constants.ts` | 1, 6, 7 |
| `src/shared/storage.ts` | 1 |
| `src/shared/pure.ts` | 2 |
| `src/background/immunity.ts` | 1, 6 |
| `src/background/messaging.ts` | 1, 3 |
| `src/background/timer-manager.ts` | 7 |
| `src/background/index.ts` | 1, 4 |
| `src/popup/popup.html` | 2, 5 |
| `src/popup/popup.ts` | 2, 5 |
| `src/options/options.html` | 3, 5, 6, 7 |
| `src/options/options.ts` | 3, 5, 6, 7 |
| Both manifests | 1, 4, 5, 6 |
| **New**: `src/background/context-menu.ts` | 1 |
| **New**: `src/_locales/en/messages.json` | 5 |
| **New**: `src/_locales/ru/messages.json` | 5 |

## Verification

After each phase:
1. `npm run build` — both targets succeed
2. `npx tsc --noEmit` — zero type errors
3. `npx vitest run` — all tests pass
4. Load in Firefox `about:debugging` — background stays running
5. Manual test of each new feature

After all phases:
- Run `/simplify` for code review
- Run Stryker for mutation score (add property tests for new pure functions)
