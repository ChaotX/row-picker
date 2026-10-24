import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTable, filterKindsFor, isSet, parseNumber, parseRange, splitList, splitParts } from '../js/profile.js';
import { header, raw, text } from './fixtures/sample-plants.js';

const table = buildTable(header, raw, text);
const kindOf = name => table.profiles[table.headers.indexOf(name)].kind;

test('numbers with decimal commas, thousands separators and dots', () => {
    assert.equal(parseNumber('1,5'), 1.5);
    assert.equal(parseNumber('0.5'), 0.5);
    assert.equal(parseNumber('1 540'), 1540);
    assert.equal(parseNumber('1.234,5'), 1234.5);
    assert.equal(parseNumber('1,234.5'), 1234.5);
    assert.equal(parseNumber('1,540'), 1540);
    assert.equal(parseNumber('0,750'), 0.75);
    assert.equal(parseNumber('abc'), null);
});

test('ranges with en dash, hyphen and units', () => {
    assert.deepEqual(parseRange('15–20'), [15, 20]);
    assert.deepEqual(parseRange('1,5–2'), [1.5, 2]);
    assert.deepEqual(parseRange('0,3-0,4 m'), [0.3, 0.4]);
    assert.deepEqual(parseRange(1540), [1540, 1540]);
    assert.deepEqual(parseRange('995 Ft'), [995, 995]);
    assert.deepEqual(parseRange('20–15'), [15, 20]);
    assert.equal(parseRange('Napos'), null);
    assert.equal(parseRange(''), null);
    assert.equal(parseRange('2 db 3'), null);
});

test('lists split outside parentheses and decimal numbers; scales split on dashes', () => {
    assert.deepEqual(splitList('Sövény, szoliter (kicsi, nagy); sziklakert'), ['Sövény', 'szoliter (kicsi, nagy)', 'sziklakert']);
    assert.deepEqual(splitList('1,5–2'), ['1,5–2']);
    assert.deepEqual(splitParts('Napos–félárnyék'), ['Napos', 'félárnyék']);
});

test('flags: any value but a no counts as set', () => {
    assert.equal(isSet('●'), true);
    assert.equal(isSet('Igen'), true);
    assert.equal(isSet('Nem'), false);
    assert.equal(isSet(''), false);
    assert.equal(isSet(false), false);
});

test('column kinds of the plant sheet', () => {
    assert.equal(kindOf('Típus'), 'enum');
    assert.equal(kindOf('Lombozat'), 'enum');
    assert.equal(kindOf('Fényigény'), 'enum');
    assert.equal(kindOf('Magasság (m)'), 'range');
    assert.equal(kindOf('Max. magasság (m)'), 'range');
    assert.equal(kindOf('Ár (Ft)'), 'range');
    assert.equal(kindOf('Mérgező'), 'flag');
    assert.equal(kindOf('Máj'), 'flag');
    assert.equal(kindOf('Felhasználás'), 'list');
    assert.equal(kindOf('Megjegyzés'), 'text');
    assert.equal(kindOf('Név'), 'text');
});

test('scale parts and list items are offered, capitalized', () => {
    const light = table.profiles[table.headers.indexOf('Fényigény')];
    assert.ok(light.parts.some(p => p.value === 'Félárnyék'));
    const use = table.profiles[table.headers.indexOf('Felhasználás')];
    assert.ok(use.tokens.some(t => t.value === 'Szoliter'));
    assert.deepEqual(filterKindsFor(light).slice(0, 1), ['in']);
    assert.deepEqual(filterKindsFor(use).slice(0, 1), ['has']);
});

test('headers: empty ones are named, repeated ones numbered; blank rows dropped', () => {
    const t = buildTable(['A', '', 'A'], [['1', '2', '3'], [], ['', '', '']], [['1', '2', '3'], [], ['', '', '']], 'Column');
    assert.deepEqual(t.headers, ['A', 'Column 2', 'A (2)']);
    assert.equal(t.text.length, 1);
    assert.deepEqual(t.rowNumbers, [2]);
});
