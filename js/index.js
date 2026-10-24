// row-picker: filter and sort a Google Sheet, see the matching rows live, and keep the query as a link.
//
//     import { startApp } from '<row-picker>/js/index.js';
//     startApp({ name: 'plant-picker', storagePrefix: 'plant-picker', linksTitle: 'plant-picker links',
//                locale: 'hu', strings: { hu: { startTitle: '…' } }, google: { clientId, apiKey, appId } });
//
// See settings.js for every option and its default.

import { boot } from './app.js';
import { setTextLocale } from './profile.js';
import { configure, settings } from './settings.js';
import { mountShell } from './shell.js';

export { DEFAULTS } from './settings.js';

export async function startApp(config = {}) {
    configure(config);
    setTextLocale(settings.locale || navigator.language);
    await mountShell();
    await boot();
}
