# Chrome Web Store Listing — Aging Tabs

Copy-paste ready content for the CWS Developer Console submission.

## Basic info

- **Name:** Aging Tabs
- **Category:** Productivity
- **Language:** English
- **Visibility:** Public

## Short description (≤132 chars)

> Auto-close inactive tabs with visual aging feedback. Favicons fade, titles warn, and a graveyard lets you restore anything.

(128 characters)

## Detailed description

```
Aging Tabs auto-closes inactive tabs — but instead of ripping them away without warning, it fades them out so you can see it coming and a searchable graveyard lets you bring anything back with one click.

Inspired by the original Aging Tabs (Dao Gottwald, ~2008) that died with Firefox 57. Rebuilt from scratch for Manifest V3, with modern features and zero external services.

━━━━━━━━━━━━━━━━━━━━━━━
WHAT IT DOES
━━━━━━━━━━━━━━━━━━━━━━━

• Visual aging — favicons progressively desaturate across 5 stages (0% → 100% grayscale) as tabs sit untouched. Optional emoji title prefix (⏳ 💤 👻 ⚠️) makes the timer visible at a glance.

• Auto-close with a safety net — tabs inactive beyond the configured timeout (default 30 min) are closed. Every closed tab is saved to a searchable graveyard with one-click restore.

• Smart immunity — active, pinned, locked, audible, grouped, and whitelisted tabs are always protected. Minimum-tab-count floor prevents closing when you only have a few tabs open.

• Global pause — click the pause button in the popup to freeze all aging timers while you work intensively with a set of tabs. Resume continues exactly where you left off, locked tabs stay locked.

• Idle-aware — aging pauses automatically when you're away from the computer and resumes when you return.

• Lock individual tabs — right-click any tab or press Alt+L to lock it. Locked tabs are excluded from auto-close until you unlock.

━━━━━━━━━━━━━━━━━━━━━━━
THE GRAVEYARD
━━━━━━━━━━━━━━━━━━━━━━━

Every auto-closed tab is saved to a local graveyard:
• Instant text search across title, URL, domain
• Sort by recent, by domain, or A-Z
• One-click restore
• JSON export/import for backup
• Capped history (configurable) — set to 0 for unlimited

━━━━━━━━━━━━━━━━━━━━━━━
CUSTOMIZE EVERYTHING
━━━━━━━━━━━━━━━━━━━━━━━

• Timeout: any duration in minutes
• Minimum tab count: floor below which nothing closes
• Action on expire: close or discard (unload from memory without closing)
• Favicon dimming: on/off
• Title prefix: on/off
• Close warning blink: on/off
• Close empty tabs (about:blank, new tab pages)
• Protect tab groups (Chrome / Firefox 138+)
• Domain whitelist
• Browser notifications with click-to-restore

━━━━━━━━━━━━━━━━━━━━━━━
PRIVACY FIRST
━━━━━━━━━━━━━━━━━━━━━━━

• No data leaves your browser
• No analytics, no telemetry, no remote servers
• No account required
• All state lives in browser.storage.local
• Open source (MIT) — audit the code yourself

Privacy policy: https://github.com/ndokutovich/auto-close-tab-ext/blob/main/PRIVACY_POLICY.md
Source code: https://github.com/ndokutovich/auto-close-tab-ext

━━━━━━━━━━━━━━━━━━━━━━━
LANGUAGES
━━━━━━━━━━━━━━━━━━━━━━━

English, Русский
```

## Single purpose

> Auto-close inactive browser tabs with progressive visual aging feedback and a restoreable graveyard.

## Permission justifications

Copy these into the "Privacy practices" form in the Developer Console, one per permission.

**tabs**
> Read tab metadata (last access time, pinned state, audible state, URL, title) to detect inactivity and apply per-tab protection rules. No tab content is accessed; only metadata visible via chrome.tabs.

**alarms**
> Schedule periodic aging checks so the service worker wakes up on schedule to evaluate and close inactive tabs. Required for MV3 background scheduling.

**storage**
> Persist tab activity timestamps, user settings, and the graveyard locally in browser.storage.local. All data stays on the user's device.

**scripting**
> Inject a small content script that applies the visual aging effects (favicon dimming, title prefix, blink warning) to tabs the user has opened.

**notifications**
> Show a local browser notification when a tab is auto-closed so the user can restore it with a click. Notifications are local only; no remote push service is used.

**idle**
> Detect when the user becomes idle or locks the screen, so aging timers pause while the user is away and resume on return. Without this, tabs would age during lunch breaks or overnight.

**contextMenus**
> Add a "Lock tab" entry to the browser right-click menu, so the user can protect individual tabs from auto-close without pinning them.

**host_permissions: <all_urls>**
> The content script that renders the visual aging feedback (favicon dim, title prefix, blink warning) must run on every tab the user opens, since we cannot predict in advance which tabs the user will want feedback on. The script reads no page content and makes no network requests — it only updates the tab's favicon and title via the DOM. No data is ever transmitted off-device.

## Data usage disclosure

- ☑ Does not collect personally identifiable information
- ☑ Does not collect health information
- ☑ Does not collect financial/payment information
- ☑ Does not collect authentication information
- ☑ Does not collect personal communications
- ☑ Does not collect location
- ☑ Does not collect web history
- ☑ Does not collect user activity
- ☑ Does not collect website content

Certify:
- ☑ I do not sell or transfer user data to third parties, except in the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

## Privacy policy URL

```
https://github.com/ndokutovich/auto-close-tab-ext/blob/main/PRIVACY_POLICY.md
```

## Support / Homepage URLs

- **Homepage:** https://github.com/ndokutovich/auto-close-tab-ext
- **Support:** https://github.com/ndokutovich/auto-close-tab-ext/issues

## Screenshots to upload

All at 1280×800, generated via `node scripts/screenshot-store.mjs`:

1. `screenshots/store/01-popup-dark.png` — popup, dark mode, graveyard populated
2. `screenshots/store/02-popup-light.png` — popup, light mode
3. `screenshots/store/03-popup-sorted-domain.png` — popup sorted by domain
4. `screenshots/store/04-popup-search.png` — popup with active search filter
5. `screenshots/store/05-popup-paused.png` — global pause feature
6. `screenshots/store/06-options-dark.png` — settings page, dark mode
7. `screenshots/store/07-options-light.png` — settings page, light mode

## Store icon

`src/icons/icon-128.png` — 128×128 PNG.

## Promo images (optional)

Small promo tile: 440×280 PNG — not generated yet, optional.

## Zip to upload

`dist/aging-tabs-chrome.zip` — produced by `npm run build && npm run package:chrome`.
