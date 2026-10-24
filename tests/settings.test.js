import test from 'node:test';
import assert from 'node:assert/strict';
import { t } from '../js/i18n.js';
import { configure, DEFAULTS, settings, storageKey } from '../js/settings.js';

test('defaults, and an app overriding them', () => {
    configure({});
    assert.equal(settings.name, DEFAULTS.name);
    assert.equal(storageKey('token'), 'row-picker:token');
    configure({ name: 'plant-picker', storagePrefix: 'plant-picker', google: { clientId: 'abc' } });
    assert.equal(storageKey('recent'), 'plant-picker:recent');
    assert.equal(settings.google.clientId, 'abc');
    assert.equal(settings.google.apiKey, '');
});

test('UI strings: the app overrides row-picker, {app} is the app name', () => {
    configure({ name: 'plant-picker', languages: ['en'], strings: { en: { startTitle: 'Pick plants with {app}' } } });
    assert.equal(t('startTitle'), 'Pick plants with plant-picker');
    assert.equal(t('signOutConfirm'), 'Sign out of Google in plant-picker?');
    assert.equal(t('open'), 'Open');
    assert.equal(t('no such key'), 'no such key');
    configure({});
});
