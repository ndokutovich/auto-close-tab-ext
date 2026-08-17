# Plan — "Protect unvisited tabs" (opt-in), targeting v1.5.0

## Context

A user reported that tabs opened in bulk ("open all in new tabs", a link dump) can
expire and close before they ever look at them — losing content they never saw,
with a poor graveyard entry (an un-loaded tab's title is often just the URL).
Aging semantically means "you stopped caring about this tab," but a *never-visited*
tab hasn't had a chance to be cared about yet — the clock currently starts at open,
not at first engagement.

The fix: an **opt-in** setting that makes a tab **immune while it has never been
focused**, and starts its timer only on the first visit (activation resets the timer
today — that behaviour is reused as-is). It must be opt-in / default-off, because the
extension's core value ("you open tabs 'just in case' and never go back") targets
exactly the never-visited class for hoarders; freezing them by default would invert
the product for the majority.

A second, related choice — what to do with **restored tabs after a browser restart**
— is itself made a setting (per user request): age them normally (default) vs.
re-protect until re-clicked.

## Design

Two new boolean settings (mirror the `protectGroupedTabs` chain exactly):

- **`protectUnvisited`** (default `false`): a tracked tab that has never been the
  active tab this session is immune.
- **`reprotectRestoredTabs`** (default `false`): only meaningful when `protectUnvisited`
  is on. `false` → tabs open at browser restart/install are seeded "visited" (age
  normally). `true` → restart clears the visited set, so restored tabs are protected
  until each is clicked. Progressive-disclosure in the UI (shown only when
  `protectUnvisited` is checked), like the custom-stage-timings block.

**"Visited" = has received `onActivated` at least once this session.** Marked ONLY in
the `onActivated` listener — never in `recordActivation`/`onUpdated`, because
`onUpdated(changeInfo.url)` fires on background self-navigation (redirect, meta-refresh)
and would silently un-protect a tab the user never saw. (Confirmed: `onUpdated` calls
`recordActivation` at `tab-tracker.ts:402-408`; the sole focus signal is `onActivated`
at `tab-tracker.ts:373-385`.)

**State:** a persisted `visitedTabs: number[]` mirroring `lockedTabs` exactly. In-memory
`Set<number>`; absence-from-set = unvisited.

**Lifecycle (mirrors `lockedTabs`/`tabStages`):**
- `onActivated` → `markVisited(tabId)` (+ dirty + flush). New tab from `onCreated`
  (`recordNewTab`) is unvisited by default (no add).
- `onRemoved` → drop from the set (alongside `removeTab`/`unlockTab`).
- `initTracker` reconcile → prune visited ids not in `openIds` (mirror the lock prune at
  `tab-tracker.ts:121-126`). Preserved on SW recycle (never reset there).
- **Seeding / reset choke point = `resetTimersForNewSession()`** (`tab-tracker.ts:245-267`),
  which runs on fresh install and genuine restart only (never recycle), and where
  `Object.keys(tabTimes)` already equals "all open tabs":
  - `seedVisited = freshInstall || !settings.reprotectRestoredTabs`
  - `seedVisited` → `visitedTabs = new Set(all open ids)`; else → `visitedTabs = empty`.
  - Force-write alongside the existing `tabTimes`/`tabStages` force-write there.
- A tab that first appears during a recycle-gap reconcile (`tab-tracker.ts:113-118`) is
  left unvisited-by-absence; acceptable (rare ~30s window, and a genuinely new tab goes
  through `recordNewTab` anyway). Documented, not special-cased.

**Immunity gate** (`immunity.ts`): add `visitedTabIds: Set<number>` to `ImmunityContext`,
thread it through `buildImmunityContext(settings, tabs, lockedTabIds, visitedTabIds)`, and
add one check in `isImmune` right after the locked-tab check (mirrors the
`protectGroupedTabs` block):
```ts
if (ctx.settings.protectUnvisited && tab.id !== undefined && !ctx.visitedTabIds.has(tab.id)) return true;
```
Thread the set through all three call sites in `timer-manager.ts`: `applyAging` (L151-152),
`repaintFrozenVisuals` (L274), `currentAgingMessageFor` (L304) — each already builds a fresh
`allTabs`; add `getVisitedTabs()` from tab-tracker next to `getLockedTabs()`.

An unvisited tab hits the existing immune branch → stage 0 / clean repaint, never enters
`tabsToClose`, and the CONTENT_READY path returns null — so no aging visuals show. On first
activation, `recordActivation` resets the timer to now AND `markVisited` runs → next pass it
ages from the visit. No content-script changes needed.

**Testability message:** add `GET_VISITED_TABS` (read-only, any sender), a trivial mirror of
`GET_LOCKED_TABS` (`messaging.ts:225-226`), returning `number[]`. Lets the e2e assert
protection directly instead of only via the stage-0 proxy.

**Badge:** no interaction — the badge reflects only graveyard length
(`graveyard.ts:79-100`), and an immune tab never enters the graveyard.

## Files to modify (by pattern)

Settings chain (mirror `protectGroupedTabs`), two booleans:
- `src/shared/types.ts` (Settings), `src/shared/constants.ts` (DEFAULT_SETTINGS + `STORAGE_KEYS.VISITED_TABS`), `src/shared/storage.ts` (`!!merged.x` coercion ×2; `getVisitedTabs`/`setVisitedTabs`; import validation for `visitedTabs` as `number[]`, mirror `lockedTabs` at L207-212).
- `src/options/options.html` (two `.field.toggle`s in the Behavior section; the reprotect one in a `hidden` wrapper), `src/options/options.ts` (query, `applySettingsToForm`, `saveSettings` Partial, and a `change` listener on `protectUnvisited` to show/hide the reprotect toggle — mirror the customStages disclosure).
- `src/_locales/en/messages.json` + `src/_locales/ru/messages.json` (`labelProtectUnvisited`/`hintProtectUnvisited`, `labelReprotectRestored`/`hintReprotectRestored`).

Behaviour:
- `src/background/tab-tracker.ts` — `visitedTabs` state + load/prune/flush; `markVisited` (called from `onActivated` only); drop-on-remove; seed/clear in `resetTimersForNewSession(freshInstall)` reading `reprotectRestoredTabs`; export `getVisitedTabs`.
- `src/background/immunity.ts` — `ImmunityContext.visitedTabIds`, `buildImmunityContext` param, the `isImmune` gate.
- `src/background/timer-manager.ts` — thread `getVisitedTabs()` into the three `buildImmunityContext` calls.
- `src/background/messaging.ts` + `src/shared/types.ts` — `GET_VISITED_TABS`.

Tests:
- New `src/__tests__/immunity.test.ts` — `isImmune` visited gate (on/off, visited/unvisited, and that it does not fire when `protectUnvisited` is false).
- New `src/__tests__/visited-tabs.test.ts` (browser-downtime mocking style) — `markVisited` on activation, unvisited-on-create, prune-on-remove, and the two reset policies (seed vs clear) driven by `reprotectRestoredTabs` + `freshInstall`.
- `scenarios/aging-tabs.spec.mjs` — one scenario: open a background tab (never activate), enable `protectUnvisited`, park elsewhere, assert `GET_VISITED_TABS` excludes it AND `GET_TAB_STATES` stage stays 0 past a timeout; then activate it and assert it becomes visited and begins aging (stage > 0). Mirror the `'Restricted URLs survive past timeout'` + lock scenarios; use input-jiggle like the blink scenario to avoid idle stalls.

## Risks / decisions (locked)

- **Inverts core behaviour for hoarders** → opt-in, default off; label must state it plainly ("Don't age tabs until you first open them").
- **"Aging stopped after restart" surprise** → resolved by making restart behaviour a user setting; default (`reprotectRestoredTabs=false`) ages restored tabs normally.
- **Fresh install must not protect all existing tabs** → install always seeds visited regardless of `reprotectRestoredTabs` (the reprotect option is restart-only).
- **Background self-navigation** → mark visited on `onActivated` only, never `recordActivation`/`onUpdated`.
- **Never-closing accumulation** when the user opens many tabs and never visits → by design when opted in; the label sets the expectation.
- **Persistence** → visited flushed with the existing `dirty`/`flush` and force-written in the reset, exactly as `tabStages`; Set ops are synchronous, so no new serialization race (immunity snapshots are built per-pass).
- Property/pure `isTabImmune` in `pure.ts` is a reduced subset; the visited gate is added to the real `immunity.ts#isImmune` and covered by the new unit test rather than forcing the pure subset to mirror it.

## Verification

1. `npx tsc --noEmit` clean; `npm test` (adds immunity + visited-tabs specs) green.
2. `npm run build`; `node scenarios/aging-tabs.spec.mjs` → 26/26 (new scenario).
3. Manual smoke (chrome://extensions, load `dist/chrome`): timeout 2 min, minTabs 0,
   `protectUnvisited` on. Ctrl-click a link (background, never focus it) → it must NOT
   dim/age while a focused sibling does. Click it → it starts aging from that moment.
   Toggle `reprotectRestoredTabs`, restart the browser, confirm restored tabs either age
   (off) or stay protected until clicked (on).
4. Version bump to 1.5.0 across manifests + package.json + `sync-safari-version`, tag
   `v1.5.0` to publish — separate release from 1.4.0.
