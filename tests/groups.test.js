import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeQuery, decodeQuery } from '../js/codec.js';
import { addColumnGroups, describeRow } from '../js/groups.js';
import { buildTable, filterKindsFor } from '../js/profile.js';
import { emptyQuery, newFilter, runQuery } from '../js/query.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const on = (...months) => MONTHS.map(m => months.includes(m));

// A made-up table of hiking trails with one column per month marking when the trail is open.
const header = ['Name', 'Region', ...MONTHS];
const trails = [
    ['Lake loop', 'Lakes', ['Apr', 'May']],
    ['Ridge path', 'Hills', ['Jun', 'Jul', 'Aug']],
    ['Winter walk', 'North', ['Dec', 'Jan', 'Feb']],
    ['Spring and autumn', 'Hills', ['May', 'Jun', 'Sep']],
    ['Closed', 'North', []]
];
const rows = trails.map(([name, region, open]) => [name, region, ...MONTHS.map(m => (open.includes(m) ? '●' : ''))]);
const GROUP = { name: 'Open', columns: MONTHS, sequence: 'cyclic' };

function table(groups = [GROUP], head = header) {
    return addColumnGroups(buildTable(head, rows, rows), groups);
}

test('summary: runs of months, also over the year end; single months and several runs', () => {
    assert.equal(describeRow(on('Apr', 'May'), MONTHS, 'cyclic').summary, 'Apr–May');
    assert.equal(describeRow(on('Dec', 'Jan', 'Feb'), MONTHS, 'cyclic').summary, 'Dec–Feb');
    assert.equal(describeRow(on('May', 'Jun', 'Sep'), MONTHS, 'cyclic').summary, 'May–Jun, Sep');
    assert.equal(describeRow(on(...MONTHS), MONTHS, 'cyclic').summary, 'Jan–Dec');
    assert.equal(describeRow(on('Dec', 'Jan'), MONTHS, 'linear').summary, 'Jan, Dec');
    assert.equal(describeRow(on('Mar', 'Apr'), MONTHS, null).summary, 'Mar, Apr');
    assert.equal(describeRow(on(), MONTHS, 'cyclic').summary, '');
});

test('sort keys: start and end follow the runs, count is how many', () => {
    const winter = describeRow(on('Dec', 'Jan', 'Feb'), MONTHS, 'cyclic');
    assert.equal(winter.first, 11);
    assert.equal(winter.last, 1);
    assert.equal(winter.count, 3);
    const linear = describeRow(on('Dec', 'Jan', 'Feb'), MONTHS, 'linear');
    assert.equal(linear.first, 0);
    assert.equal(linear.last, 11);
});

test('the group becomes a virtual list column; the members stay', () => {
    const t = table();
    const ci = t.headers.indexOf('Open');
    assert.equal(ci, header.length);
    assert.equal(t.text[0][ci], 'Apr, May');
    assert.deepEqual(t.profiles[ci].tokens.map(x => x.value), MONTHS);
    assert.equal(t.profiles[ci].tokens[4].count, 2); // May: Lake loop, Spring and autumn
    assert.deepEqual(filterKindsFor(t.profiles[ci]), ['has', 'flag', 'text']);
    assert.ok(t.memberColumns.has(t.headers.indexOf('Jan')));
    assert.equal(t.virtual.get(ci).rows[2].summary, 'Dec–Feb');
});

test('filtering: open in any / all of the chosen months, or not at all', () => {
    const t = table();
    const q = items => ({ ...emptyQuery('sheet', 1, 'Trails'), q: { op: 'and', items } });
    const names = res => res.rows.map(r => t.text[r][0]);
    const may = runQuery(q([{ ...newFilter('Open', 'has'), v: ['May', 'Jun'] }]), t);
    assert.deepEqual(names(may), ['Lake loop', 'Ridge path', 'Spring and autumn']);
    const both = runQuery(q([{ ...newFilter('Open', 'has'), v: ['May', 'Jun'], all: true }]), t);
    assert.deepEqual(names(both), ['Spring and autumn']);
    const never = runQuery(q([{ ...newFilter('Open', 'flag'), set: false }]), t);
    assert.deepEqual(names(never), ['Closed']);
});

test('sorting by start, end and count; empty rows last', () => {
    const t = table();
    const sorted = by => runQuery({ ...emptyQuery('sheet', 1, 'Trails'), o: [{ c: 'Open', d: 'asc', by }] }, t).rows.map(r => t.text[r][0]);
    assert.deepEqual(sorted('first'), ['Lake loop', 'Spring and autumn', 'Ridge path', 'Winter walk', 'Closed']);
    assert.deepEqual(sorted('last').slice(0, 2), ['Winter walk', 'Lake loop']);
    assert.deepEqual(sorted('count'), ['Lake loop', 'Ridge path', 'Winter walk', 'Spring and autumn', 'Closed']);
});

test('the sort key survives the link', async () => {
    const query = { ...emptyQuery('sheet', 1, 'Trails'), o: [{ c: 'Open', d: 'desc', by: 'count' }] };
    const back = await decodeQuery(await encodeQuery(query));
    assert.deepEqual(back.o, [{ c: 'Open', d: 'desc', by: 'count' }]);
});

test('missing member columns are reported; a group without any, or named like a column, is left out', () => {
    const without = header.filter(h => h !== 'Mar');
    const short = rows.map(r => r.filter((_, i) => header[i] !== 'Mar'));
    const t = addColumnGroups(buildTable(without, short, short), [GROUP]);
    const ci = t.headers.indexOf('Open');
    assert.deepEqual(t.virtual.get(ci).missing, ['Mar']);
    const res = runQuery({ ...emptyQuery('sheet', 1, 'Trails'), q: { op: 'and', items: [{ ...newFilter('Open', 'has'), v: ['May'] }] } }, t);
    assert.equal(res.issues.get('0')[0].code, 'groupColumnsMissing');
    assert.equal(table([{ name: 'Seasons', columns: ['Spring', 'Summer'] }]).headers.includes('Seasons'), false);
    assert.equal(table([{ name: 'region', columns: MONTHS }]).headers.filter(h => h.toLowerCase() === 'region').length, 1);
});
