# Aging Tabs — Browser Extension Plan

## Context

Growing tab count causes decision paralysis — you keep tabs open "just in case" and never close them. Hard auto-close loses information. The original **Aging Tabs** (Dao Gottwald, ~2008, XUL) solved this with progressive visual fading + auto-bookmark before close. It died with Firefox 57. No modern extension combines visual aging countdown with auto-close + graveyard. This fills that gap.

## Core Formula

```
Visual countdown (favicon dimming + optional title prefix)
+ Filtered graveyard (not bookmarks, not history — own searchable list)
+ Pinned/audible/whitelist immunity
+ Configurable timer
+ One-click restore
```

## Tech Stack

- **TypeScript**, vanilla (no framework for popup/options — UI is simple)
- **esbuild** for bundling
- **webextension-polyfill** for cross-browser compat
- **Manifest V3** for both Chrome and Firefox
- Dual build output: `dist/chrome/` and `dist/firefox/`

## File Structure

```
aging-tabs/
  package.json
  tsconfig.json
  build.mjs                          # esbuild dual-browser build
  src/
    manifests/
      manifest.chrome.json           # service_worker, favicon permission
      manifest.firefox.json          # scripts[], gecko settings
    background/
      index.ts                       # Entry: wire tracker + timer + messaging
      timer-manager.ts               # Alarm loop, stage computation, close logic
      tab-tracker.ts                 # Track lastAccessed via tabs events
      graveyard.ts                   # Closed-tab archive, badge count
      immunity.ts                    # Pinned/audible/active/whitelist/floor checks
      messaging.ts                   # Message router bg <-> content/popup
    content/
      index.ts                       # Content script entry, message dispatch
      favicon-aging.ts               # Canvas grayscale overlay on favicon
      title-aging.ts                 # Title prefix with MutationObserver
    popup/
      popup.html / popup.ts / popup.css   # Quick graveyard list + search + restore
    options/
      options.html / options.ts / options.css  # Full settings + graveyard + whitelist
    shared/
      types.ts                       # Interfaces, message protocol, AgingStage
      constants.ts                   # Defaults, stage thresholds
      storage.ts                     # Typed async storage wrappers
    icons/
      icon-16.png, icon-32.png, icon-48.png, icon-128.png
  dist/
    chrome/
    firefox/
```

## Architecture

### Aging Cycle Data Flow

```
tabs.onActivated / onUpdated
        │
  [tab-tracker.ts] → records lastAccessed in memory + storage.local
        │
  [timer-manager.ts] ← alarms.onAlarm every 30s
        │ for each tracked tab:
        │   skip if immune (pinned/audible/active/whitelist/floor)
        │   compute stage = elapsed / timeout * 4 (clamped 0-4)
        │   if stage changed → send UPDATE_AGING to content script
        │   if elapsed >= timeout → close tab, add to graveyard
        │
  tabs.sendMessage(tabId, { type: 'UPDATE_AGING', stage })
        │
  [content/index.ts]
    ├─ favicon-aging.ts → canvas grayscale: 0%→25%→50%→75%→100%
    └─ title-aging.ts   → prefix: [⏳]→[💤]→[👻] (optional)
```

### Tab Activation → Reset

```
tabs.onActivated → tab-tracker resets lastAccessed
                 → sends RESET_AGING to content script
                 → content restores original favicon + removes title prefix
```

### CORS Favicon Fallback

Content script can't draw cross-origin favicons on canvas. Fallback:
1. Content sends `FETCH_FAVICON_REQUEST` to background
2. Background fetches via `fetch()` (has host permissions), converts to data URL
3. Background sends data URL back to content script
4. Content draws data URL on canvas without tainting

## Storage Schema

```typescript
interface Settings {
  timeoutMinutes: number;        // default: 30
  faviconDimming: boolean;       // default: true
  titlePrefix: boolean;          // default: false
  graveyardMaxSize: number;      // default: 200
  minTabCount: number;           // default: 3
  whitelistedDomains: string[];  // default: []
}

interface GraveyardEntry {
  url: string;
  title: string;
  faviconUrl: string;
  closedAt: number;
  domain: string;
}

// storage.local keys:
// "settings"   → Settings
// "tabTimes"   → Record<number, number>  (tabId → timestamp)
// "tabStages"  → Record<number, AgingStage>
// "graveyard"  → GraveyardEntry[]
```

## Manifest Differences

| | Chrome | Firefox |
|---|---|---|
| Background | `service_worker: "background.js"` | `scripts: ["browser-polyfill.js", "background.js"]` |
| Extra permission | `"favicon"` | — |
| Gecko settings | — | `browser_specific_settings.gecko` with ID + min version 121 |

## Implementation Phases

### Phase 1: Skeleton + Timer
Build system, manifests, shared types, tab tracking, immunity checks, alarm-based close loop. **Testable**: set timeout to 1 min, watch tab close.

### Phase 2: Graveyard + Popup
Store closed tabs, popup UI with search + restore, badge count on extension icon.

### Phase 3: Favicon Aging
Content script canvas rendering, progressive grayscale, CORS fallback relay. **Testable**: open tabs, watch favicons dim over time.

### Phase 4: Title Prefix
Optional title prefix with MutationObserver for SPA compat.

### Phase 5: Options Page
Full settings form, whitelist domain editor, full graveyard with pagination.

### Phase 6: Cross-Browser Polish
Firefox testing, service worker lifecycle edge cases, icons, `onInstalled` sweep for existing tabs.

## Key Edge Cases

- **Service worker death (Chrome)**: All state recoverable from `storage.local`. Timer reads storage on every alarm if memory cache is empty.
- **Restricted tabs** (`chrome://`, `about:`): Can't inject content scripts → track and close, but no visual aging. Catch "no receiving end" errors.
- **SPA title changes**: MutationObserver on `<title>`, temporarily disconnect while applying prefix to avoid loops.
- **Min alarm period**: Chrome enforces 30s minimum for `alarms` API. UI enforces this floor.
- **Browser restart**: `runtime.onStartup` reconciles stored tabTimes with actual open tabs.

## Verification

1. Load unpacked in Chrome (`dist/chrome/`) and Firefox (`dist/firefox/`)
2. Open 5+ tabs, verify favicon dimming progresses through stages
3. Let a tab auto-close, verify it appears in popup graveyard
4. Click restore in popup, verify tab reopens
5. Pin a tab, verify it never closes
6. Play audio in a tab, verify it's immune while playing
7. Add a domain to whitelist, verify tabs from that domain don't close
8. Set min tab count = 3, verify closing stops at 3 tabs
9. Restart browser, verify tab timers resume from correct state
