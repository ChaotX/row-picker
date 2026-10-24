import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTable, countValues } from '../js/profile.js';
import { emptyQuery, newFilter, runQuery } from '../js/query.js';
import { header, raw, text } from './fixtures/sample-plants.js';

const table = buildTable(header, raw, text);
const col = name => table.headers.indexOf(name);
const cell = (r, name) => table.text[r][col(name)];

function query(items, op = 'and', extra = {}) {
    return { ...emptyQuery('sheet', 1, 'Növények'), q: { op, items }, ...extra };
}

test('no filters: every row', () => {
    assert.equal(runQuery(query([]), table).rows.length, table.text.length);
});

test('is one of', () => {
    const { rows } = runQuery(query([{ ...newFilter('Típus', 'in'), v: ['Évelő', 'Talajtakaró'] }]), table);
    assert.ok(rows.length > 0);
    assert.ok(rows.every(r => ['Évelő', 'Talajtakaró'].includes(cell(r, 'Típus'))));
});

test('scale parts: Félárnyék matches Napos–félárnyék too', () => {
    const { rows } = runQuery(query([{ ...newFilter('Fényigény', 'in'), v: ['Félárnyék'], parts: true }]), table);
    assert.ok(rows.some(r => cell(r, 'Fényigény') === 'Napos–félárnyék'));
    assert.ok(rows.every(r => /félárnyék/i.test(cell(r, 'Fényigény'))));
});

test('exclude inverts a filter', () => {
    const all = table.text.length;
    const poisonous = runQuery(query([newFilter('Mérgező', 'flag')]), table).rows.length;
    const safe = runQuery(query([{ ...newFilter('Mérgező', 'flag'), not: true }]), table).rows.length;
    assert.ok(poisonous > 0);
    assert.equal(poisonous + safe, all);
});

test('range overlap and within', () => {
    const overlap = runQuery(query([{ ...newFilter('Magasság (m)', 'range'), min: 1, max: 2 }]), table).rows;
    const within = runQuery(query([{ ...newFilter('Magasság (m)', 'range'), min: 1, max: 2, how: 'within' }]), table).rows;
    assert.ok(within.length <= overlap.length);
    assert.ok(within.every(r => overlap.includes(r)));
    assert.ok(overlap.every(r => cell(r, 'Magasság (m)') !== '15–20'));
});

test('list contains any / all', () => {
    const any = runQuery(query([{ ...newFilter('Felhasználás', 'has'), v: ['Szoliter', 'Sövény'] }]), table).rows;
    const both = runQuery(query([{ ...newFilter('Felhasználás', 'has'), v: ['Szoliter', 'Sövény'], all: true }]), table).rows;
    assert.ok(any.length >= both.length);
    assert.ok(both.every(r => /szoliter/i.test(cell(r, 'Felhasználás')) && /sövény/i.test(cell(r, 'Felhasználás'))));
});

test('text: contains, wildcard, regex, equals', () => {
    const run = f => runQuery(query([{ ...newFilter('Latin név', 'text'), ...f }]), table).rows;
    assert.ok(run({ x: 'pinus' }).length > 0);
    assert.deepEqual(run({ m: 'wildcard', x: 'pinus*' }), run({ m: 'regex', x: '^pinus' }));
    assert.equal(run({ m: 'wildcard', x: 'pinus' }).length, 0);
    assert.equal(run({ m: 'equals', x: 'tilia CORDATA' }).length, 1);
    assert.equal(run({ x: 'PINUS', cs: true }).length, 0);
});

test('and / or / groups', () => {
    const tree = f => query([f('Típus', ['Évelő']), f('Típus', ['Talajtakaró'])], 'or');
    const f = (c, v) => ({ ...newFilter(c, 'in'), v });
    const either = runQuery(tree(f), table).rows.length;
    const evelo = runQuery(query([f('Típus', ['Évelő'])]), table).rows.length;
    const talaj = runQuery(query([f('Típus', ['Talajtakaró'])]), table).rows.length;
    assert.equal(either, evelo + talaj);
    const nested = query([
        { op: 'or', items: [f('Típus', ['Évelő']), f('Típus', ['Talajtakaró'])] },
        { ...newFilter('Mérgező', 'flag'), not: true }
    ]);
    const { rows } = runQuery(nested, table);
    assert.ok(rows.every(r => ['Évelő', 'Talajtakaró'].includes(cell(r, 'Típus')) && !cell(r, 'Mérgező')));
});

test('an excluded group', () => {
    const f = v => ({ ...newFilter('Típus', 'in'), v });
    const { rows } = runQuery(query([{ op: 'or', not: true, items: [f(['Évelő']), f(['Talajtakaró'])] }]), table);
    assert.ok(rows.length > 0);
    assert.ok(rows.every(r => !['Évelő', 'Talajtakaró'].includes(cell(r, 'Típus'))));
});

test('sort numeric by max, descending, empties last; then by name', () => {
    const q = query([], 'and', { o: [{ c: 'Max. magasság (m)', d: 'desc', by: 'max' }, { c: 'Név', d: 'asc' }] });
    const { rows } = runQuery(q, table);
    const values = rows.map(r => Number(table.raw[r][col('Max. magasság (m)')]));
    for (let i = 1; i < values.length; i++) assert.ok(values[i - 1] >= values[i]);
});

test('counts per top-level filter: alone and without', () => {
    const q = query([{ ...newFilter('Típus', 'in'), v: ['Évelő'] }, newFilter('Mérgező', 'flag')]);
    const { rows, counts } = runQuery(q, table);
    const evelo = runQuery(query([{ ...newFilter('Típus', 'in'), v: ['Évelő'] }]), table).rows.length;
    assert.equal(counts.get('0').alone, evelo);
    assert.equal(counts.get('1').without, evelo);
    assert.ok(rows.length <= evelo);
});

test('running counts along the chain: falling with and, rising with or, also inside groups', () => {
    const f = v => ({ ...newFilter('Típus', 'in'), v: [v] });
    const and = runQuery(query([newFilter('Mérgező', 'flag'), f('Évelő')]), table);
    assert.equal(and.counts.get('0').upTo, and.counts.get('0').alone);
    assert.equal(and.counts.get('1').upTo, and.rows.length);
    assert.ok(and.counts.get('1').upTo <= and.counts.get('0').upTo);
    const or = runQuery(query([f('Évelő'), f('Talajtakaró')], 'or'), table);
    assert.equal(or.counts.get('1').upTo, or.counts.get('0').alone + or.counts.get('1').alone);
    const nested = runQuery(query([{ op: 'or', items: [f('Évelő'), f('Talajtakaró')] }]), table);
    assert.equal(nested.counts.get('0.1').upTo, or.counts.get('1').upTo);
    assert.equal(nested.counts.get('0.1').without, undefined);
});

test('contexts: the rows that reach each filter, for offering its values', () => {
    const f = v => ({ ...newFilter('Típus', 'in'), v: [v] });
    const poisonous = newFilter('Mérgező', 'flag');
    const and = runQuery(query([poisonous, f('Évelő'), { op: 'or', items: [f('Évelő'), f('Talajtakaró')] }]), table);
    assert.equal(and.contexts.get('0').length, table.text.length);
    assert.equal(and.contexts.get('1').length, and.counts.get('0').alone);
    assert.equal(and.contexts.get('2').length, and.counts.get('1').upTo);
    // inside an 'any of' group the siblings don't narrow each other
    assert.deepEqual(and.contexts.get('2.1'), and.contexts.get('2'));
    const or = runQuery(query([poisonous, f('Évelő')], 'or'), table);
    assert.equal(or.contexts.get('1').length, table.text.length);
});

test('value counts within given rows: whole values, scale parts, list items', () => {
    const rows = table.text.map((_, r) => r);
    const light = countValues(table.text, rows, col('Fényigény'), 'parts');
    const lightWhole = countValues(table.text, rows, col('Fényigény'));
    assert.ok(light.get('félárnyék') >= lightWhole.get('félárnyék'));
    const evelo = rows.filter(r => cell(r, 'Típus') === 'Évelő');
    const types = countValues(table.text, evelo, col('Típus'));
    assert.deepEqual([...types], [['évelő', evelo.length]]);
    const uses = countValues(table.text, rows, col('Felhasználás'), 'tokens');
    assert.ok(uses.get('szoliter') > 1);
});

test('what each node changes along the chain: removed with and, added with or', () => {
    const f = v => ({ ...newFilter('Típus', 'in'), v: [v] });
    const and = runQuery(query([newFilter('Mérgező', 'flag'), f('Évelő'), newFilter('Mérgező', 'flag')]), table);
    assert.equal(and.counts.get('0').delta, undefined);
    assert.equal(and.counts.get('1').before, and.counts.get('0').upTo);
    assert.ok(and.counts.get('1').delta <= 0);
    assert.equal(and.counts.get('2').delta, 0); // the same filter again removes nothing
    const or = runQuery(query([f('Évelő'), f('Talajtakaró'), f('Évelő')], 'or'), table);
    assert.equal(or.counts.get('1').delta, or.counts.get('1').alone);
    assert.equal(or.counts.get('2').delta, 0); // adds nothing new
});

test('inside a group the chain counts among the rows reaching the group', () => {
    const f = v => ({ ...newFilter('Típus', 'in'), v: [v] });
    const q = query([newFilter('Mérgező', 'flag'), { op: 'or', items: [f('Évelő'), f('Talajtakaró')] }]);
    const { counts, rows } = runQuery(q, table);
    assert.equal(counts.get('1.1').upTo, counts.get('1').upTo);
    assert.equal(counts.get('1').upTo, rows.length);
    assert.ok(counts.get('1.0').upTo <= counts.get('0').upTo);
});

test('default visible columns: first two plus the used ones', () => {
    const q = query([newFilter('Mérgező', 'flag')], 'and', { o: [{ c: 'Típus', d: 'asc' }] });
    const { visible } = runQuery(q, table);
    assert.deepEqual(visible, [0, 1, col('Mérgező'), col('Típus')]);
});
