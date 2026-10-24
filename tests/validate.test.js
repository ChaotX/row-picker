// What happens when the sheet changes under a saved query.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTable } from '../js/profile.js';
import { emptyQuery, findColumn, newFilter, runQuery } from '../js/query.js';
import { header, raw, text } from './fixtures/sample-plants.js';

const table = buildTable(header, raw, text);

function query(items, extra = {}) {
    return { ...emptyQuery('sheet', 1, 'Növények'), q: { op: 'and', items }, ...extra };
}

function withHeader(from, to) {
    return buildTable(header.map(h => (h === from ? to : h)), raw, text);
}

function withoutColumn(name) {
    const i = header.indexOf(name);
    const drop = row => row.filter((_, j) => j !== i);
    return buildTable(drop(header), raw.map(drop), text.map(drop));
}

test('a removed column skips its filter (no rows hidden) and suggests nothing far off', () => {
    const changed = withoutColumn('Mérgező');
    const q = query([newFilter('Mérgező', 'flag')]);
    const { rows, issues } = runQuery(q, changed);
    assert.equal(rows.length, changed.text.length);
    assert.equal(issues.get('0')[0].code, 'columnMissing');
    assert.equal(issues.get('0')[0].level, 'skip');
});

test('a skipped filter in an OR group does not make everything match', () => {
    const changed = withoutColumn('Mérgező');
    const q = { ...query([]), q: { op: 'or', items: [newFilter('Mérgező', 'flag'), { ...newFilter('Típus', 'in'), v: ['Évelő'] }] } };
    const { rows } = runQuery(q, changed);
    const evelo = runQuery(query([{ ...newFilter('Típus', 'in'), v: ['Évelő'] }]), changed).rows.length;
    assert.equal(rows.length, evelo);
});

test('a column renamed only in case / accents / spacing is still used, with a warning', () => {
    const changed = withHeader('Típus', 'tipus');
    const q = query([{ ...newFilter('Típus', 'in'), v: ['Évelő'] }]);
    const before = runQuery(q, table).rows;
    const { rows, issues } = runQuery(q, changed);
    assert.deepEqual(rows, before);
    assert.equal(issues.get('0')[0].code, 'columnRenamed');
});

test('a renamed column gets a suggestion', () => {
    const changed = withHeader('Fényigény', 'Fényigények');
    const { issues } = runQuery(query([{ ...newFilter('Fényigény', 'in'), v: ['Napos'] }]), changed);
    const issue = issues.get('0')[0];
    assert.equal(issue.code, 'columnMissing');
    assert.equal(issue.params.suggestion, 'Fényigények');
    const far = findColumn(changed.headers, 'Valami egészen más');
    assert.equal(far.index, -1);
    assert.equal(far.suggestion, null);
    const close = findColumn(withHeader('Fényigény', 'Fény igény (h)').headers, 'Fényigény');
    assert.equal(close.index, -1);
    assert.equal(close.suggestion, 'Fény igény (h)');
});

test('values that no longer occur are reported; the others still filter', () => {
    const q = query([{ ...newFilter('Típus', 'in'), v: ['Évelő', 'Pálma'] }]);
    const { rows, issues } = runQuery(q, table);
    assert.ok(rows.length > 0);
    assert.equal(issues.get('0')[0].code, 'valuesMissing');
    assert.equal(issues.get('0')[0].params.values, 'Pálma');
    const none = runQuery(query([{ ...newFilter('Típus', 'in'), v: ['Pálma'] }]), table);
    assert.equal(none.rows.length, 0);
    assert.equal(none.issues.get('0')[0].code, 'valuesAllMissing');
});

test('a bad regular expression skips the filter', () => {
    const { rows, issues } = runQuery(query([{ ...newFilter('Latin név', 'text'), m: 'regex', x: '(' }]), table);
    assert.equal(rows.length, table.text.length);
    assert.equal(issues.get('0')[0].code, 'badRegex');
});

test('a range filter on a column that stopped being numeric warns', () => {
    const { issues } = runQuery(query([{ ...newFilter('Típus', 'range'), min: 1 }]), table);
    assert.equal(issues.get('0')[0].code, 'notNumeric');
});

test('missing sort and visible columns are noted and dropped', () => {
    const changed = withoutColumn('Típus');
    const q = query([], { o: [{ c: 'Típus', d: 'asc' }], cols: ['Név', 'Típus'] });
    const { notes, visible, sort } = runQuery(q, changed);
    assert.equal(sort.length, 0);
    assert.deepEqual(visible, [0]);
    assert.deepEqual(notes.map(n => n.code).sort(), ['columnsMissing', 'sortMissing']);
});
