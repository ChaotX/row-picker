import test from 'node:test';
import assert from 'node:assert/strict';
import { compact, decodeQuery, encodeQuery, expand, queryKey } from '../js/codec.js';
import { emptyQuery, newFilter } from '../js/query.js';

const sample = {
    ...emptyQuery('TEST_SPREADSHEET_ID_00000000000000000000000', 123456, 'Növények'),
    n: 'Árnyéktűrő sövény',
    q: {
        op: 'and',
        items: [
            { ...newFilter('Típus', 'in'), v: ['Lombhullató cserje', 'Örökzöld cserje'], not: false },
            { ...newFilter('Fényigény', 'in'), v: ['Félárnyék'], parts: true, not: false },
            { ...newFilter('Mérgező', 'flag'), not: true },
            { op: 'or', items: [{ ...newFilter('Magasság (m)', 'range'), min: 1, max: 2.5, not: false }, { ...newFilter('Latin név', 'text'), m: 'regex', x: '^Acer', not: false }] }
        ]
    },
    o: [{ c: 'Max. magasság (m)', d: 'desc', by: 'max' }],
    cols: ['Név', 'Latin név', 'Típus']
};

test('round trip keeps the query', async () => {
    const code = await encodeQuery(sample);
    assert.match(code, /^z[A-Za-z0-9_-]+$/);
    const back = await decodeQuery(code);
    assert.deepEqual(compact(back), compact(sample));
    assert.equal(back.q.items[2].not, true);
    assert.equal(back.n, 'Árnyéktűrő sövény');
    assert.equal(back.q.items[3].items[0].how, 'overlap');
});

test('links stay reasonably short', async () => {
    const code = await encodeQuery(sample);
    assert.ok(code.length < 600, `length ${code.length}`);
});

test('comparison key ignores how the query was built, and the name on request', async () => {
    const back = await decodeQuery(await encodeQuery(sample));
    assert.equal(queryKey(back), queryKey(sample));
    const reordered = structuredClone(sample);
    reordered.q.items[0] = { not: false, v: ['Örökzöld cserje', 'Lombhullató cserje'], k: 'in', c: 'Típus' };
    assert.equal(queryKey(reordered), queryKey(sample));
    const renamed = { ...sample, n: 'Más név' };
    assert.notEqual(queryKey(renamed), queryKey(sample));
    assert.equal(queryKey(renamed, { withName: false }), queryKey(sample, { withName: false }));
    const changed = structuredClone(sample);
    changed.q.items[2].not = false;
    assert.notEqual(queryKey(changed, { withName: false }), queryKey(sample, { withName: false }));
});

test('plain JSON format decodes too', async () => {
    const json = Buffer.from(JSON.stringify(compact(sample))).toString('base64url');
    const back = await decodeQuery(`j${json}`);
    assert.deepEqual(compact(back), compact(sample));
});

test('garbage is rejected', async () => {
    await assert.rejects(decodeQuery('xabc'));
    await assert.rejects(decodeQuery('j' + Buffer.from('{"a":1}').toString('base64url')));
    assert.throws(() => expand(null));
});

test('a filter offering every value (wide) keeps that in the link; the default adds nothing', async () => {
    const wide = structuredClone(sample);
    wide.q.items[0].wide = true;
    const back = await decodeQuery(await encodeQuery(wide));
    assert.equal(back.q.items[0].wide, true);
    assert.equal(back.q.items[1].wide, false);
    assert.equal('wide' in compact(sample).q.items[0], false);
    assert.notEqual(queryKey(wide), queryKey(sample));
});
