// UI strings: row-picker's own tables (i18n/*.js), overridden per app by settings.strings. Sheet content is
// never translated.

import en from '../i18n/en.js';
import hu from '../i18n/hu.js';
import { settings, storageKey } from './settings.js';
import { storage } from './util.js';

const TABLES = { en, hu };
const LABELS = { en: 'English', hu: 'Magyar' };

let current = null;

function offered() {
    const codes = (settings.languages || []).filter(code => TABLES[code]);
    return codes.length ? codes : ['en'];
}

export function languages() {
    return offered().map(code => ({ code, label: LABELS[code] || code }));
}

// The saved choice, else the browser's language if offered, else the first offered one.
export function getLanguage() {
    if (!current) {
        const codes = offered();
        const saved = storage.get(storageKey('lang'));
        const browser = (navigator.language || '').toLowerCase().slice(0, 2);
        current = codes.includes(saved) ? saved : codes.includes(browser) ? browser : codes[0];
    }
    return current;
}

export function setLanguage(code) {
    if (!offered().includes(code)) return;
    current = code;
    storage.set(storageKey('lang'), code);
    document.documentElement.lang = code;
    applyTranslations(document);
}

// t('key', { name: 'A' }) → string with {name} placeholders filled in ({app}: the app's name). Looks in the app's overrides, then
// row-picker's table, for the current language, then the first offered language, then English, then the key.
export function t(key, params = {}) {
    params = { app: settings.name, ...params };
    const lang = getLanguage();
    const fallback = offered()[0];
    const template = settings.strings?.[lang]?.[key] ?? TABLES[lang]?.[key]
        ?? settings.strings?.[fallback]?.[key] ?? TABLES[fallback]?.[key] ?? en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? `{${k}}`));
}

export function applyTranslations(root) {
    root.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.title = t(el.dataset.i18nTitle);
    });
}
