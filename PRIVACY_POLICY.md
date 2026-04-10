# Privacy Policy — Aging Tabs

**Last updated:** April 10, 2026

## Overview

Aging Tabs is a browser extension that auto-closes inactive tabs. It operates entirely within your browser and does not collect, transmit, or share any data.

## Data Collection

**Aging Tabs does not collect any data.** Specifically:

- No personal information is collected
- No browsing history is transmitted
- No analytics or telemetry is sent
- No cookies are set
- No third-party services are used
- No network requests are made by the extension

## Data Storage

The extension stores the following data **locally in your browser** using the browser's built-in `storage.local` API:

- **Tab activity timestamps** — when each tab was last accessed (used to calculate aging)
- **Graveyard entries** — URL, title, and favicon of auto-closed tabs (for recovery)
- **Settings** — your preferences (timeout duration, whitelist, visual options)

This data:
- Never leaves your browser
- Is not accessible to any website or third party
- Is automatically deleted if you uninstall the extension
- Can be cleared at any time via the extension's options page

## Permissions

The extension requires these browser permissions:

| Permission | Why |
|-----------|-----|
| `tabs` | Track tab activity and detect pinned/audible state |
| `alarms` | Run periodic checks for inactive tabs |
| `storage` | Save settings and graveyard locally |
| `scripting` | Inject content scripts for visual aging effects |
| `notifications` | Show browser notification when a tab is auto-closed (with undo) |
| `idle` | Pause aging timer when user is away from the computer |
| `contextMenus` | Right-click "Lock tab" menu item |
| Host permissions (`<all_urls>`) | Apply favicon dimming to any website |

## Changes

If this policy changes, the update will be published here and in the extension's store listing.

## Contact

Questions or concerns: ndokutovich@gmail.com
