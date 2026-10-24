// Column groups (settings.columnGroups): several yes / no columns that together answer one question — e.g. one
// column per month marking when something happens — shown, filtered and sorted as one virtual column added to
// the end of the table. Its cell text lists the members that are set ('Apr, May'), so the list filter
// ('includes any / all of'), exclusion, narrowed value lists and counts work on it unchanged; display uses the
// per-row summary ('Apr–May') and on / off flags instead. The member columns stay in the table.
//
// A group: { name, columns: [header names, in order], sequence: 'cyclic' | 'linear' (optional) }. With a
// sequence the members are in order ('linear') or in a circle ('cyclic', like months: Dec–Feb runs over the
// year's end): the summary shows runs ('Apr–May, Sep') and sorting by start / end follows them. Without it the
// summary lists the members.
// Pure, so node --test can run it.

import { fold, isSet } from './profile.js';
import { findColumn } from './query.js';

export const SORT_BY = ['first', 'last', 'count'];

// Runs of set members: [[from, to], …] by index. Cyclic: a run may wrap ([10, 1] = members 10, 11, 0, 1); the
// runs start after the longest gap, so the first run is the one the "season" begins with.
function runs(on, sequence) {
    const n = on.length;
    const set = on.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
    if (!set.length) return [];
    if (set.length === n) return [[0, n - 1]];
    let start = 0;
    if (sequence === 'cyclic') {
        // The member right after the longest stretch of unset members.
        let best = -1;
        for (let i = 0; i < n; i++) {
            if (!on[i] || on[(i - 1 + n) % n]) continue; // not the start of a run
            let gap = 0;
            while (!on[(i - 1 - gap + n * 2) % n]) gap++;
            if (gap > best) {
                best = gap;
                start = i;
            }
        }
    }
    const out = [];
    const len = sequence === 'cyclic' ? n : n - start;
    let from = null;
    for (let k = 0; k < len; k++) {
        const i = (start + k) % n;
        if (on[i] && from === null) from = i;
        if (!on[i] && from !== null) {
            out.push([from, (i - 1 + n) % n]);
            from = null;
        }
    }
    if (from !== null) out.push([from, (start + len - 1) % n]);
    return out;
}

// One row of a group: { on: [bool], summary, first, last, count }; first / last are member indexes (null if
// none is set) and serve as sort keys.
export function describeRow(on, labels, sequence) {
    const count = on.filter(Boolean).length;
    if (!count) return { on, summary: '', first: null, last: null, count };
    if (sequence === 'linear' || sequence === 'cyclic') {
        const list = runs(on, sequence);
        const summary = list.map(([a, b]) => (a === b ? labels[a] : `${labels[a]}–${labels[b]}`)).join(', ');
        return { on, summary, first: list[0][0], last: list[list.length - 1][1], count };
    }
    const set = on.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
    return { on, summary: set.map(i => labels[i]).join(', '), first: set[0], last: set[set.length - 1], count };
}

// Adds the configured groups to a table built by buildTable(). Each becomes a column at the end with
// profile.virtual = { name, labels, members (column indexes), missing (configured names not found), sequence,
// rows: [describeRow …] }. table.virtual maps those column indexes to the same object; table.memberColumns is
// the set of member column indexes. A group is left out when none of its columns is in the table or its name
// is already a column's.
export function addColumnGroups(table, groups = []) {
    table.virtual = new Map();
    table.memberColumns = new Set();
    for (const group of groups || []) {
        if (!group?.name || !Array.isArray(group.columns)) continue;
        if (table.headers.some(h => fold(h) === fold(group.name))) continue;
        const members = [];
        const labels = [];
        const missing = [];
        for (const name of group.columns) {
            const col = findColumn(table.headers, name);
            if (col.index < 0 || table.virtual.has(col.index)) missing.push(name);
            else {
                members.push(col.index);
                labels.push(col.header);
            }
        }
        if (!members.length) continue;
        const sequence = group.sequence === 'cyclic' || group.sequence === 'linear' ? group.sequence : null;
        const rows = table.text.map((textRow, r) => describeRow(
            members.map(c => isSet(table.raw[r][c] === '' ? textRow[c] : table.raw[r][c])), labels, sequence));
        const index = table.headers.length;
        const cells = rows.map(row => row.on.map((v, i) => (v ? labels[i] : null)).filter(Boolean).join(', '));
        table.headers.push(group.name);
        table.text.forEach((row, r) => row.push(cells[r]));
        table.raw.forEach((row, r) => row.push(cells[r]));
        const virtual = { name: group.name, labels, members, missing, sequence, rows };
        const nonEmpty = rows.filter(row => row.count).length;
        table.profiles.push({
            kind: 'list',
            nonEmpty,
            values: [],
            numericRate: 0,
            min: null,
            max: null,
            // The members in their order (not by count), with the rows that have each.
            tokens: labels.map((value, i) => ({ value, count: rows.filter(row => row.on[i]).length })),
            virtual
        });
        table.virtual.set(index, virtual);
        members.forEach(c => table.memberColumns.add(c));
    }
    return table;
}
