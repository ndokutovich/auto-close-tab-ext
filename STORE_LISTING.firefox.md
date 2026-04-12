# Firefox Add-ons (AMO) Listing — Aging Tabs

Auto-generated from `store-listing/copy.*.json`. Edit the source — re-run `npm run gen:store`.

**Submission target:** addons.mozilla.org Developer Hub


---

# English

## Basic info

- **Name:** Aging Tabs
- **Category:** Productivity
- **Language:** English

## Summary (123/250 chars)

> Auto-close inactive tabs with visual aging feedback. Favicons fade, titles warn, and a graveyard lets you restore anything.


## Full description (2674/15000 chars)

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
• Protect tab groups
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


## URLs

- **Privacy policy:** https://github.com/ndokutovich/auto-close-tab-ext/blob/main/PRIVACY_POLICY.md
- **Homepage:** https://github.com/ndokutovich/auto-close-tab-ext
- **Support:** https://github.com/ndokutovich/auto-close-tab-ext/issues
- **Marketing:** https://github.com/ndokutovich/auto-close-tab-ext



---

# Русский

## Basic info

- **Name:** Aging Tabs
- **Category:** Продуктивность
- **Language:** Русский

## Summary (113/250 chars)

> Автозакрытие неактивных вкладок с визуальным затуханием. Закрытые вкладки попадают в кладбище для восстановления.


## Full description (3079/15000 chars)

```
Aging Tabs автоматически закрывает неактивные вкладки — но не грубо, без предупреждения, а плавно: вкладки визуально блёкнут, и вы видите, что время на исходе. Все закрытые вкладки попадают в поисковое «кладбище», откуда любую можно вернуть в один клик.

Расширение вдохновлено оригинальным Aging Tabs (Dao Gottwald, ~2008), который умер вместе с Firefox 57. Полностью переписано с нуля под Manifest V3, с современными функциями и без каких-либо внешних сервисов.

━━━━━━━━━━━━━━━━━━━━━━━
ЧТО ДЕЛАЕТ
━━━━━━━━━━━━━━━━━━━━━━━

• Визуальное старение — фавиконы постепенно обесцвечиваются в 5 этапов (0% → 100% серого), пока вкладка не используется. Опциональный префикс-эмодзи в заголовке (⏳ 💤 👻 ⚠️) делает таймер заметным с одного взгляда.

• Автозакрытие со страховкой — вкладки, неактивные дольше заданного таймаута (по умолчанию 30 минут), закрываются. Каждая закрытая вкладка сохраняется в поисковое «кладбище» с одноклик-восстановлением.

• Умный иммунитет — активная, закреплённая, заблокированная, звучащая, сгруппированная и вкладки из белого списка никогда не закрываются. Минимальное количество вкладок защищает от закрытия, если открыто совсем мало.

• Глобальная пауза — нажмите кнопку паузы в попапе, чтобы заморозить все таймеры на время активной работы с вкладками. После снятия паузы счётчики продолжают с того же момента, заблокированные вкладки остаются заблокированными.

• Учёт простоя — старение автоматически приостанавливается, когда вы отошли от компьютера, и возобновляется при возвращении.

• Блокировка отдельных вкладок — кликните правой кнопкой или нажмите Alt+L, чтобы защитить конкретную вкладку от автозакрытия. Заблокированные вкладки исключаются из автозакрытия, пока не разблокируете.

━━━━━━━━━━━━━━━━━━━━━━━
КЛАДБИЩЕ
━━━━━━━━━━━━━━━━━━━━━━━

Каждая автозакрытая вкладка сохраняется в локальное кладбище:
• Мгновенный поиск по заголовку, URL и домену
• Сортировка по времени, домену или алфавиту
• Восстановление в один клик
• Экспорт/импорт в JSON для бэкапа
• Настраиваемый лимит истории — поставьте 0 для неограниченного

━━━━━━━━━━━━━━━━━━━━━━━
НАСТРАИВАЕТСЯ ВСЁ
━━━━━━━━━━━━━━━━━━━━━━━

• Таймаут: любая длительность в минутах
• Минимум вкладок: порог, ниже которого ничего не закрывается
• Действие при истечении: закрыть или выгрузить из памяти (discard) без закрытия
• Затухание фавиконов: вкл/выкл
• Префикс заголовка: вкл/выкл
• Мигание перед закрытием: вкл/выкл
• Закрытие пустых вкладок (about:blank, новые вкладки)
• Защита групп вкладок
• Белый список доменов
• Браузерные уведомления с кликом для восстановления

━━━━━━━━━━━━━━━━━━━━━━━
СНАЧАЛА ПРИВАТНОСТЬ
━━━━━━━━━━━━━━━━━━━━━━━

• Данные не покидают браузер
• Никакой аналитики, телеметрии, удалённых серверов
• Аккаунт не требуется
• Всё состояние хранится в browser.storage.local
• Открытый исходный код (MIT) — проверьте код сами

Политика конфиденциальности: https://github.com/ndokutovich/auto-close-tab-ext/blob/main/PRIVACY_POLICY.md
Исходный код: https://github.com/ndokutovich/auto-close-tab-ext

━━━━━━━━━━━━━━━━━━━━━━━
ЯЗЫКИ
━━━━━━━━━━━━━━━━━━━━━━━

English, Русский
```


## URLs

- **Privacy policy:** https://github.com/ndokutovich/auto-close-tab-ext/blob/main/PRIVACY_POLICY.md
- **Homepage:** https://github.com/ndokutovich/auto-close-tab-ext
- **Support:** https://github.com/ndokutovich/auto-close-tab-ext/issues
- **Marketing:** https://github.com/ndokutovich/auto-close-tab-ext



---


## Screenshots


All at 1280×800, generated via `node scripts/screenshot-store.mjs`.

1. `screenshots/store/01-popup-dark.png` — Popup — dark mode, graveyard populated
2. `screenshots/store/02-popup-light.png` — Popup — light mode
3. `screenshots/store/03-popup-sorted-domain.png` — Popup — sorted by domain
4. `screenshots/store/04-popup-search.png` — Popup — active search filter
5. `screenshots/store/05-popup-paused.png` — Popup — global pause
6. `screenshots/store/06-options-dark.png` — Settings — dark mode
7. `screenshots/store/07-options-light.png` — Settings — light mode

**Icon:** 128x128

## Package to upload

`dist/aging-tabs-firefox.zip` — produced by `npm run build`.


## Platform notes

- AMO uses summary (250 chars) instead of short description — the same text works.
- No permission-justification form like Chrome; permissions are shown from manifest.json.
- Source code upload required for review (link to GitHub repo works).

