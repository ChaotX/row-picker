// The running app's configuration. startApp(config) sets it once, before anything reads it; every module that
// needs a name, a storage key or a Google id reads it from here, so one row-picker serves many apps (each with
// its own name, texts, storage and short-link spreadsheet).

export const DEFAULTS = {
    name: 'row-picker',                 // shown in the top bar and the page title
    icon: '',                           // top-bar icon URL; empty: row-picker's own
    storagePrefix: 'row-picker',        // browser storage keys: '<prefix>:token', '<prefix>:recent', …
    linksTitle: 'row-picker links',     // name of the short-link spreadsheet in the user's Drive
    locale: 'en',                       // for comparing and sorting cell text (e.g. 'hu' for Hungarian order)
    languages: ['en', 'hu'],            // UI languages offered; the first is the fallback
    strings: {},                        // UI text overrides per language: { hu: { startTitle: '…' } }
    google: { clientId: '', apiKey: '', appId: '' }
};

export const settings = structuredClone(DEFAULTS);

export function configure(config = {}) {
    const { google, strings, ...rest } = config;
    Object.assign(settings, rest);
    settings.google = { ...DEFAULTS.google, ...(google || {}) };
    settings.strings = strings || {};
    return settings;
}

// A browser storage key of this app.
export function storageKey(name) {
    return `${settings.storagePrefix}:${name}`;
}
