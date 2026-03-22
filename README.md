# Aging Tabs

Browser extension that auto-closes inactive tabs with visual aging feedback. Inspired by the original Aging Tabs (Dao Gottwald, ~2008) that died with Firefox 57.

## The Problem

Growing tab count causes decision paralysis — you keep tabs open "just in case" and never close them. Hard auto-close loses information. Aging Tabs solves both: tabs visually fade as they age, then close with a safety net.

## How It Works

1. **Visual aging** — inactive tab favicons progressively desaturate (grayscale). Optional title prefix shows emoji indicators
2. **Auto-close** — tabs inactive beyond a configurable timeout (default 30 min) are closed
3. **Graveyard** — every auto-closed tab is saved to a searchable list with one-click restore
4. **Immunity** — pinned tabs, tabs playing audio, whitelisted domains, and the active tab are never closed

## Features

- Favicon dimming: 5-stage progressive grayscale (0% → 25% → 50% → 75% → 100%)
- Optional title prefix: tab titles show aging emoji indicators
- Searchable graveyard popup with restore
- Badge count on extension icon
- Domain whitelist
- Minimum tab count floor
- Grace period on fresh install (won't kill existing tabs)
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
npm run watch    # auto-rebuild on changes
npm test         # run unit + property-based tests
```

## Tech Stack

- TypeScript, vanilla (no framework)
- esbuild for bundling
- webextension-polyfill for cross-browser compat
- vitest + fast-check for testing
- Stryker for mutation testing (92.93% score)

## License

Proprietary. See [LICENSE](LICENSE) for details.
