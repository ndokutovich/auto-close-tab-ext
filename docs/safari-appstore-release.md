# Safari / Mac App Store — release runbook

Restored 2026-11-07. State of play and the exact steps to finish the submission.

## Where we left it

| When | What |
|---|---|
| 2026-04-10 | Build **1.0 (1)** uploaded to App Store Connect via Xcode Organizer. Apple Distribution cert reissued (old one revoked). `LSApplicationCategoryType` fixed. |
| 2026-04-12 | `STORE_LISTING.safari.md` generator, `screenshots/store/icon-1024.png`, 7 screenshots @ 1280×800. |
| — | **"Submit for Review" was never pressed.** The app sat in **Prepare for Submission** for seven months. |
| 2026-11-07 | **Submitted for review** — version 1.5.0, build 1005000, macOS. First submission of this app. |
| 2026-11-19 | **Approved — status Ready for Distribution.** Live on the Mac App Store. |
| 2026-04-12 → 08-17 | 1.1.1 … 1.5.0 shipped to Chrome / AMO / GitHub. Safari project version bumped by `npm run sync:safari` on every release — **no new build was ever uploaded to Apple** until 1.5.0. |

The App Store record was a virgin first release for seven months; it is now approved and live.

## What is already in the repo

| Item | Path | State |
|---|---|---|
| Xcode project | `safari-ext/Aging tabs/Aging tabs.xcodeproj` | `MARKETING_VERSION = 1.5.0`, `CURRENT_PROJECT_VERSION = 1005000` |
| Safari manifest | `src/manifests/manifest.safari.json` | 1.5.0 |
| Listing copy (EN + RU) | `STORE_LISTING.safari.md` | regenerated via `npm run gen:store` |
| App icon | `safari-ext/Aging tabs/Shared (App)/Assets.xcassets/AppIcon.appiconset/` | full macOS set incl. `mac-icon-512@2x.png` (1024×1024), RGBA — normal for macOS |
| Screenshots | `screenshots/store/*.png`, `screenshots/store/ru/*.png` | 1280×800, 7 + RU set |
| Privacy policy | `PRIVACY_POLICY.md` | linked from listing |
| Bundle IDs | `com.ndokutovich.aging-tabs` / `.Extension` | team `BA59RA8CF9` |

**The Xcode project does not copy extension files.** `project.pbxproj` points at `../../../dist/safari/*` (options, popup, icons, `_locales`, `background.js`, `content.js`, `browser-polyfill.js`, `manifest.json`). `dist/` is gitignored. So the Mac must build the extension before archiving — otherwise Xcode bundles whatever stale `dist/safari` happens to be there.

## Preflight on the Mac

```bash
cd auto-close-tab-ext
git pull
npm ci
npm run build:safari
grep '"version"' dist/safari/manifest.json   # must print 1.5.0
```

Check signing material still valid (cert was issued 2026-04-10, valid ~1 year):
- Xcode → Settings → Accounts → Manage Certificates → **Apple Distribution** present, not revoked
- developer.apple.com → Certificates: status Active
- developer.apple.com → Profiles: Mac App Store profiles exist for both bundle IDs (or let Xcode manage automatically)

Open `safari-ext/Aging tabs/Aging tabs.xcodeproj`. Select the **Aging tabs (macOS)** app scheme, destination **My Mac**. Signing & Capabilities → Automatic, team `BA59RA8CF9`.

## Archive and upload

1. `Product → Archive`.
2. Organizer → **Distribute App → App Store Connect → Upload**. Wait for "uploaded"; Apple processing takes 5–30 min.
3. In App Store Connect, the build appears under the macOS platform → **TestFlight / Builds** as `1.5.0 (1005000)`.

## Xcode vs App Store Connect — what lives where

Xcode does exactly one thing: `Archive → Distribute App → App Store Connect → Upload`. It has no privacy questionnaire and no submit-for-review button. Everything below happens at <https://appstoreconnect.apple.com> in a browser.

Left sidebar, after selecting the app:

```
Aging Tabs
├── App Information        ← name, subtitle, category, Content Rights, Age Rating
├── Pricing and Availability
├── App Privacy            ← the privacy questionnaire
├── macOS
│   └── 1.5.0              ← screenshots, description, build, review notes, Submit for Review
└── TestFlight
```

- **App Privacy** → `Get Started` (or `Edit`) → the data-collection questionnaire → `No, we do not collect data from this app` → `Publish`. Only the published state counts for review.
- **Submit for Review** is the button in the **top-right corner of the version page** (`macOS → 1.5.0`), not in Xcode. It stays greyed out until every required field is filled and a build is attached — hovering it usually lists what is missing.
- **Age Rating** is not on the version page: `App Information` → `Age Rating` → `Edit`.
- If the whole record is read-only or the button never enables, check `Business` (top nav) → agreements still pending acceptance.

## App Store Connect — fill and submit

Open the app record and the version page.

1. **Version string.** It currently says `1.0` and was never submitted, so it is still editable. Set it to **1.5.0** — it must equal `MARKETING_VERSION`, otherwise the uploaded build will not attach. If ASC refuses to edit, use "+ Version or Platform" to create a new `1.5.0`.
2. **Attach the build**: Build section → `1.5.0 (1005000)` → Done.
3. **Metadata** — copy from `STORE_LISTING.safari.md`, both EN and RU localizations:

| Field | EN | RU |
|---|---|---|
| Name | Aging Tabs | Aging Tabs |
| Subtitle (30) | Auto-close tabs, gently | Мягкое автозакрытие вкладок |
| Promotional text (170) | see listing | see listing |
| Keywords (100) | `tabs,productivity,auto close,tab manager,focus,memory,session` | `вкладки,продуктивность,автозакрытие,менеджер вкладок,фокус,память,сессия` |
| Description (4000) | see listing | see listing |
| Copyright | © 2026 Nikita Dokutovich | © 2026 Никита Докутович |
| Support URL | `https://github.com/ndokutovich/auto-close-tab-ext/issues` | same |
| Marketing URL | `https://github.com/ndokutovich/auto-close-tab-ext` | same |

4. **Screenshots**: upload 7 × 1280×800 for EN, the `ru/` set for RU. Order: popup dark → popup light → sorted by domain → search → paused → settings dark → settings light.
5. **App Information**: Category **Productivity**, secondary category optional. Privacy Policy URL → `PRIVACY_POLICY.md` on GitHub.
6. **Pricing and Availability**: Free, all territories.
7. **App Privacy**: Data Not Collected. (No analytics, no servers, everything in `browser.storage.local`.)
8. **Age Rating**: questionnaire — all "None" → **4+**.
9. **Export Compliance**: app does not use encryption beyond OS-provided HTTPS → "No" / exempt.
10. **Content Rights**: does not contain third-party content.
11. **App Review Information**: no demo account needed. Note in Review Notes that this is a Safari web extension: after installing, enable it in Safari → Settings → Extensions → Aging Tabs, and grant access.
12. **Submit for Review.**

"What's New in This Version" is not required for a first release.

## Known gotchas

- **Version mismatch** is the #1 failure: ASC version page string ≠ build's `MARKETING_VERSION` → build never appears in the Build section.
- **`MACOSX_DEPLOYMENT_TARGET = 10.14`** — set by the converter. If ASC or the upload validator complains about the minimum, raise it to 11.0 (Safari web extensions need macOS 11 anyway) and re-sync with `npm run sync:safari`.
- **Do not re-run `xcrun safari-web-extension-converter`** — it overwrites the customized project (signing team, category, storyboards).
- **Archive the macOS scheme only.** The project also contains iOS app/extension targets; they are not part of this submission.
- **Screenshots predate 1.5.0** (generated 2026-04-10). They are valid, but the options screenshots do not show the new "Don't age tabs until first opened" toggle. Regenerate with `node scripts/screenshot-store.mjs --all` if you want them current.
- **There is no icon upload in App Store Connect.** The Mac App Store icon is read from the bundle's `Assets.xcassets/AppIcon.appiconset` (`mac-icon-512@2x.png` = 1024×1024). Alpha is allowed on macOS icons. If ASC ever complains about the icon, the fix is in Xcode's asset catalog, not in the web UI.

## Future Safari releases

```bash
npm version patch            # bumps package.json + manifests
npm run sync:safari          # MARKETING_VERSION / CURRENT_PROJECT_VERSION in pbxproj
git push --follow-tags
# on the Mac:
git pull && npm ci && npm run build:safari
# Xcode → Archive → Distribute → App Store Connect
# ASC → new version → attach build → Submit for Review
```
