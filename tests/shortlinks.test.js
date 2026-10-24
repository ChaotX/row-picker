import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeQuery } from '../js/codec.js';
import { emptyQuery, newFilter } from '../js/query.js';
import { matchLinks } from '../js/shortlinks.js';

const base = { ...emptyQuery('sheet', 1, 'Növények'), q: { op: 'and', items: [{ ...newFilter('Típus', 'in'), v: ['Évelő', 'Talajtakaró'], not: false }] } };

test('an already saved filter is found by content, whatever its name or value order', async () => {
    const links = [
        { id: 'aaaaaa', name: '', query: await encodeQuery({ ...base, o: [{ c: 'Típus', d: 'asc' }] }) },
        { id: 'bbbbbb', name: 'Régi', query: await encodeQuery({ ...base, n: 'Régi' }) },
        { id: 'cccccc', name: '', query: 'garbage' }
    ];
    const reordered = { ...base, n: 'Új név', q: { op: 'and', items: [{ c: 'Típus', k: 'in', not: false, v: ['Talajtakaró', 'Évelő'] }] } };
    const match = await matchLinks(reordered, links);
    assert.equal(match.link.id, 'bbbbbb');
    assert.equal(match.name, 'Régi');
    assert.equal(await matchLinks({ ...base, q: { op: 'or', items: base.q.items } }, links.slice(0, 1)), null);
});

test('among duplicates the one with the same name wins, else the latest', async () => {
    const code = n => encodeQuery({ ...base, n });
    const links = [
        { id: 'first1', name: 'A', query: await code('A') },
        { id: 'second', name: 'B', query: await code('B') },
        { id: 'third3', name: 'C', query: await code('C') }
    ];
    assert.equal((await matchLinks({ ...base, n: 'B' }, links)).link.id, 'second');
    assert.equal((await matchLinks({ ...base, n: 'X' }, links)).link.id, 'third3');
});
