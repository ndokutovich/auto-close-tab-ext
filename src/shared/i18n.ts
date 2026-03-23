import browser from 'webextension-polyfill';

/**
 * Get a localized message. Falls back to the key itself if not found.
 */
export function msg(key: string, ...substitutions: string[]): string {
  try {
    const result = browser.i18n.getMessage(key, substitutions);
    return result || key;
  } catch {
    return key;
  }
}

/**
 * Apply i18n to all elements with data-i18n attributes in the document.
 * - data-i18n="key" → textContent
 * - data-i18n-placeholder="key" → placeholder attribute
 * - data-i18n-title="key" → title attribute
 */
/**
 * Localized relative time formatting.
 * Uses i18n message keys: timeJustNow, timeMinutesAgo, timeHoursAgo, timeDaysAgo.
 */
export function formatTimeI18n(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return msg('timeJustNow');
  if (minutes < 60) return msg('timeMinutesAgo', String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return msg('timeHoursAgo', String(hours));
  const days = Math.floor(hours / 24);
  return msg('timeDaysAgo', String(days));
}

export function applyI18n(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n!;
    el.textContent = msg(key);
  }
  for (const el of document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
    el.placeholder = msg(el.dataset.i18nPlaceholder!);
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    el.title = msg(el.dataset.i18nTitle!);
  }
}
