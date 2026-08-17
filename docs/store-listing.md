# AMO Store Listing

## Name
Aging Tabs

## Summary (max 250 chars)
Auto-close inactive tabs with visual aging. Tabs fade as they age, then close safely to a searchable graveyard. Lock, sort, export. Pauses when you're away.

## Description

### The Problem
Too many open tabs? You keep them "just in case" but never go back. The tab bar becomes unusable.

### The Solution
Aging Tabs gradually fades inactive tab favicons from color to grayscale, giving you a visual countdown before they auto-close. Closed tabs are saved to a searchable graveyard where you can restore them with one click.

### Key Features

**Visual Aging**
Watch your inactive tabs slowly fade. The longer you don't visit a tab, the grayer its favicon becomes. Optional emoji indicators mark each stage in the title, and the title can blink at the end if you want a louder warning.

**Graveyard with Restore**
Every auto-closed tab is saved to a searchable list. Sort by recent, domain, or alphabetically. Click to restore instantly. Export/import your graveyard as JSON.

**Lock Tabs**
Right-click any tab and select "Lock" to prevent auto-close without pinning. Use Alt+L as a keyboard shortcut.

**Smart Protection**
Pinned tabs, locked tabs, tabs playing audio, grouped tabs, and whitelisted domains are never closed. Set a minimum tab count.

**Idle Awareness**
Aging only happens while you're actively working. When you step away, timers pause. When you return, everything is where you left it.

**Notification + Undo**
When a tab closes, you get a notification. Click it to instantly restore the tab.

**Discard Mode**
Don't want to close tabs? Switch to discard mode — tabs stay visible but unload from memory.

**Configurable**
- Timeout: 1 minute to 30 days
- Favicon dimming on/off
- Title prefix indicators on/off
- Title blinking on/off (off by default)
- Custom stage timings, or evenly spread across the timeout
- Domain whitelist
- Min tab count floor (set to 0 for no limit)
- Close empty tabs on/off
- Protect grouped tabs on/off
- Protect unvisited tabs — don't age a tab until you first open it (off by default)

**Privacy First**
All data stays in your browser. No accounts, no servers, no tracking, nothing sent anywhere. The only request it ever makes is re-fetching a tab's own favicon to dim it, when that icon can't be read back from the page — a cross-origin/CDN icon, or the fallback favicon. It sends no cookies and never reaches private hosts.

**Lightweight**
Pure TypeScript, no frameworks. Follows your browser's light/dark theme. Available in English and Russian.

### Inspired By
Modern successor to the original Aging Tabs by Dao Gottwald (2008), which was lost when Firefox moved to WebExtensions in 2017.

### Note
While Aging Tabs includes multiple safety nets (graveyard, notifications, lock, whitelist), we recommend pinning or locking your most important tabs. Closed tab data is stored locally and may be lost if you clear browser data or uninstall the extension.

## Categories
- Tabs

## Tags
tabs, auto-close, tab manager, productivity, tab cleanup, tab aging

## Support URL
https://github.com/nickolay-dokutovich/aging-tabs/issues

## Homepage
https://github.com/nickolay-dokutovich/aging-tabs
