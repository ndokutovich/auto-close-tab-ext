# Aging Tabs

Browser extension that auto-closes inactive tabs with visual aging feedback. Inspired by the original Aging Tabs (Dao Gottwald, ~2008) that died with Firefox 57.

## The Problem

Growing tab count causes decision paralysis — you keep tabs open "just in case" and never close them. Hard auto-close loses information. Aging Tabs solves both: tabs visually fade as they age, then close with a safety net.

## How It Works

1. **Visual aging** — inactive tab favicons progressively desaturate. Optional title prefix shows emoji indicators. At the final stage, the title blinks as a last warning
2. **Auto-close** — tabs inactive beyond a configurable timeout (default 30 min) are closed. Alternative: discard mode unloads from memory without closing
3. **Graveyard** — every auto-closed tab is saved to a searchable list with one-click restore. Sort by recent, domain, or alphabetically. Export/import as JSON
4. **Smart immunity** — pinned tabs, locked tabs, audible tabs, grouped tabs, whitelisted domains, and the active tab are never closed
5. **Idle awareness** — aging pauses when you're away from the computer and resumes when you return
6. **Notification + undo** — browser notification on close with click-to-restore

## Features

- Favicon dimming: 5-stage progressive grayscale (0% → 25% → 50% → 75% → 100%)
- Title prefix: optional emoji indicators (off by default)
- Title blink warning before close
- Searchable graveyard popup with sort (Recent / By domain / A-Z)
- Badge count on extension icon
- Lock tab: right-click → Lock (prevent auto-close without pinning)
- Keyboard shortcut: Alt+L to lock/unlock current tab
- Domain whitelist
- Minimum tab count floor (0 = no floor, active tab always protected)
- Close empty tabs (about:blank, new tab)
- Tab groups protection (Firefox 138+ / Chrome)
- Discard mode: unload from memory instead of closing
- Grace period on fresh install
- Idle pause: aging only during active work time
- JSON export/import for graveyard backup (unlimited history with size = 0)
- Light/dark theme (follows browser)
- i18n: English + Russian
- Cross-browser: Chrome + Firefox (Manifest V3)
- Privacy-first: all data stays in browser, no external services

## Install

### From source

```bash
npm install
npm run build
```

**Chrome**: `chrome://extensions` → Developer mode → Load unpacked → select `dist/chrome/`

**Firefox**: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → select `dist/firefox/manifest.json`

### Development

```bash
npm run watch        # auto-rebuild on changes
npm test             # run unit + property-based tests
npm run package:firefox   # create .zip for AMO submission
npm run package:chrome    # create .zip for Chrome Web Store
npm run package:source    # create source .zip for AMO review
```

## Tech Stack

- TypeScript (strict mode, zero type errors)
- esbuild for bundling
- webextension-polyfill for cross-browser compat
- vitest + fast-check for testing (98 tests, 94.4% mutation score)
- Stryker for mutation testing
- Security audited (SSRF protection, message sender validation, CSP, input sanitization)

## Privacy

All data stays in your browser. No accounts, no servers, no tracking, no network requests. See [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

## License

Proprietary. See [LICENSE](LICENSE) for details.
