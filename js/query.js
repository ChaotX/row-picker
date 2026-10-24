// The query: filters (AND / OR groups, each invertible), sort keys and visible columns, all referring to
// columns by header name. resolveQuery() checks a query against the table as it is now (columns may have been
// renamed, removed or changed), and runQuery() evaluates it. Pure, so node --test can run it.

import { cellText, compareText, fold, isSet, looseKey, parseRange, splitList, splitParts } from './profile.js';

export const QUERY_VERSION = 1;

export function emptyQuery(spreadsheetId = '', gid = null, tabTitle = '') {
    return { v: QUERY_VERSION, n: '', s: spreadsheetId, g: gid, t: tabTitle, q: { op: 'and', items: [] }, o: [], cols: null };
}

export function isGroup(node) {
    return Boolean(node && Array.isArray(node.items));
}

// A new filter for column c of the given kind, with neutral parameters.
export function newFilter(c, k) {
    switch (k) {
        case 'text': return { c, k, m: 'contains', x: '' };
        case 'in': return { c, k, v: [] };
        case 'has': return { c, k, v: [], all: false };
        case 'range': return { c, k, min: null, max: null, how: 'overlap' };
        case 'flag': return { c, k, set: true };
        default: return { c, k: 'text', m: 'contains', x: '' };
    }
}

// Walks the tree: fn(node, path) with paths like '0', '2.1'.
export function walk(group, fn, prefix = '') {
    group.items.forEach((node, i) => {
        const path = prefix ? `${prefix}.${i}` : String(i);
        fn(node, path);
        if (isGroup(node)) walk(node, fn, path);
    });
}

export function nodeAt(query, path) {
    let node = query.q;
    for (const i of String(path).split('.')) node = node.items[Number(i)];
    return node;
}

export function parentOf(query, path) {
    const parts = String(path).split('.');
    const index = Number(parts.pop());
    return { parent: parts.length ? nodeAt(query, parts.join('.')) : query.q, index };
}

// ---------- matching columns ----------

function editDistance(a, b) {
    const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const tmp = dp[j];
            dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = tmp;
        }
    }
    return dp[b.length];
}

// → { index, header, renamed } or { index: -1, suggestion }.
export function findColumn(headers, name) {
    const exact = headers.indexOf(name);
    if (exact >= 0) return { index: exact, header: name, renamed: false };
    const folded = headers.findIndex(h => fold(h) === fold(name));
    if (folded >= 0) return { index: folded, header: headers[folded], renamed: true };
    const key = looseKey(name);
    const loose = headers.findIndex(h => looseKey(h) === key);
    if (loose >= 0) return { index: loose, header: headers[loose], renamed: true };
    let best = null;
    let bestDistance = Infinity;
    for (const h of headers) {
        const d = editDistance(key, looseKey(h));
        if (d < bestDistance) {
            bestDistance = d;
            best = h;
        }
    }
    const limit = Math.max(2, Math.round(key.length * 0.3));
    return { index: -1, suggestion: bestDistance <= limit ? best : null };
}

// ---------- compiling a filter ----------

function wildcardToRegExp(pattern, flags) {
    const body = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${body}$`, flags);
}

function presentValues(list) {
    return new Set((list || []).map(v => fold(v.value)));
}

// Returns { test(rowIndex) → bool } or null when the filter can't run, and pushes issues.
function compileFilter(filter, table, issues) {
    const col = findColumn(table.headers, filter.c);
    if (col.index < 0) {
        issues.push({ level: 'skip', code: 'columnMissing', params: { column: filter.c, suggestion: col.suggestion || '' } });
        return null;
    }
    if (col.renamed) issues.push({ level: 'warn', code: 'columnRenamed', params: { column: filter.c, now: col.header } });
    const ci = col.index;
    const profile = table.profiles[ci];
    if (profile.virtual?.missing.length) {
        issues.push({ level: 'warn', code: 'groupColumnsMissing', params: { column: col.header, columns: profile.virtual.missing.join(', ') } });
    }
    const text = table.text;
    const raw = table.raw;

    switch (filter.k) {
        case 'flag': {
            const set = filter.set !== false;
            return { test: r => isSet(raw[r][ci] === '' ? text[r][ci] : raw[r][ci]) === set, column: ci };
        }
        case 'text': {
            const x = String(filter.x ?? '');
            if (!x) return { test: () => true, column: ci, neutral: true };
            const flags = filter.cs ? 'u' : 'iu';
            let re;
            try {
                if (filter.m === 'regex') re = new RegExp(x, flags);
                else if (filter.m === 'wildcard') re = wildcardToRegExp(x, flags);
            } catch (error) {
                issues.push({ level: 'skip', code: 'badRegex', params: { column: col.header, error: error.message } });
                return null;
            }
            if (re) return { test: r => re.test(text[r][ci]), column: ci };
            const needle = filter.cs ? x.normalize('NFC') : fold(x);
            const norm = filter.cs ? s => s.normalize('NFC') : fold;
            if (filter.m === 'equals') return { test: r => norm(text[r][ci]) === needle, column: ci };
            return { test: r => norm(text[r][ci]).includes(needle), column: ci };
        }
        case 'in': {
            const wanted = (filter.v || []).map(fold);
            if (!wanted.length) return { test: () => true, column: ci, neutral: true };
            const pool = filter.parts ? profile.parts || profile.values : profile.values;
            if (filter.parts && !profile.parts) issues.push({ level: 'warn', code: 'noParts', params: { column: col.header } });
            reportMissing(filter.v, presentValues(pool), col.header, issues);
            const set = new Set(wanted);
            if (filter.parts) return { test: r => splitParts(text[r][ci]).some(p => set.has(fold(p))), column: ci };
            return { test: r => set.has(fold(text[r][ci])), column: ci };
        }
        case 'has': {
            const wanted = (filter.v || []).map(fold);
            if (!wanted.length) return { test: () => true, column: ci, neutral: true };
            if (!profile.tokens) issues.push({ level: 'warn', code: 'notList', params: { column: col.header } });
            reportMissing(filter.v, presentValues(profile.tokens || profile.values), col.header, issues);
            const tokenSets = new Map();
            const tokensOf = r => {
                let s = tokenSets.get(r);
                if (!s) {
                    s = new Set(splitList(text[r][ci]).map(fold));
                    tokenSets.set(r, s);
                }
                return s;
            };
            if (filter.all) return { test: r => wanted.every(w => tokensOf(r).has(w)), column: ci };
            return { test: r => wanted.some(w => tokensOf(r).has(w)), column: ci };
        }
        case 'range': {
            const min = Number.isFinite(filter.min) ? filter.min : -Infinity;
            const max = Number.isFinite(filter.max) ? filter.max : Infinity;
            if (min === -Infinity && max === Infinity) return { test: () => true, column: ci, neutral: true };
            if (profile.nonEmpty && profile.numericRate < 0.5) {
                issues.push({ level: 'warn', code: 'notNumeric', params: { column: col.header, percent: Math.round(profile.numericRate * 100) } });
            }
            const within = filter.how === 'within';
            return {
                test: r => {
                    const v = parseRange(raw[r][ci] === '' ? text[r][ci] : raw[r][ci]);
                    if (!v) return false;
                    return within ? v[0] >= min && v[1] <= max : v[1] >= min && v[0] <= max;
                },
                column: ci
            };
        }
        default:
            issues.push({ level: 'skip', code: 'unknownFilter', params: { column: col.header, kind: String(filter.k) } });
            return null;
    }
}

function reportMissing(values, present, column, issues) {
    const missing = (values || []).filter(v => !present.has(fold(v)));
    if (!missing.length) return;
    const all = missing.length === values.length;
    issues.push({ level: 'warn', code: all ? 'valuesAllMissing' : 'valuesMissing', params: { column, values: missing.join(', ') } });
}

// ---------- resolving a whole query ----------

// Compiles the filter tree. Returns { root, issues: Map(path → [issue]) }. A node's evaluator returns true / false,
// or null when it doesn't take part (skipped filter, empty group), so a broken filter neither hides nor adds rows.
export function resolveQuery(query, table) {
    const issues = new Map();
    const compileNode = (node, path) => {
        const list = [];
        let fn;
        if (isGroup(node)) {
            const children = node.items.map((child, i) => compileNode(child, path ? `${path}.${i}` : String(i)));
            const or = node.op === 'or';
            fn = r => {
                let seen = false;
                for (const child of children) {
                    const v = child(r);
                    if (v === null) continue;
                    if (or && v) return true;
                    if (!or && !v) return false;
                    seen = true;
                }
                return seen ? !or : null;
            };
        } else {
            const compiled = compileFilter(node, table, list);
            fn = compiled && !compiled.neutral ? compiled.test : () => null;
            if (compiled?.neutral) list.push({ level: 'info', code: 'incomplete', params: {} });
        }
        if (path) issues.set(path, list);
        if (!node.not) return fn;
        return r => {
            const v = fn(r);
            return v === null ? null : !v;
        };
    };
    const root = compileNode(query.q, '');
    return { root, issues };
}

// Sort keys and visible columns against the current headers.
export function resolveColumns(query, table) {
    const notes = [];
    const sort = [];
    for (const key of query.o || []) {
        const col = findColumn(table.headers, key.c);
        if (col.index < 0) {
            notes.push({ level: 'skip', code: 'sortMissing', params: { column: key.c, suggestion: col.suggestion || '' } });
            continue;
        }
        if (col.renamed) notes.push({ level: 'warn', code: 'columnRenamed', params: { column: key.c, now: col.header } });
        const profile = table.profiles[col.index];
        if (profile.virtual) {
            // A column group: by where its set members start or end, or by how many are set.
            const by = ['first', 'last', 'count'].includes(key.by) ? key.by : 'first';
            sort.push({ index: col.index, desc: key.d === 'desc', by, numeric: true, virtual: profile.virtual });
            continue;
        }
        sort.push({ index: col.index, desc: key.d === 'desc', by: key.by === 'max' ? 1 : 0, numeric: profile.kind === 'range' });
    }
    let visible;
    if (Array.isArray(query.cols) && query.cols.length) {
        visible = [];
        const missing = [];
        for (const name of query.cols) {
            const col = findColumn(table.headers, name);
            if (col.index < 0) missing.push(name);
            else if (!visible.includes(col.index)) visible.push(col.index);
        }
        if (missing.length) notes.push({ level: 'warn', code: 'columnsMissing', params: { columns: missing.join(', ') } });
        if (!visible.length) visible = defaultColumns(query, table);
    } else {
        visible = defaultColumns(query, table);
    }
    return { sort, visible, notes };
}

// Without a chosen column list: the first two columns plus every column a filter or sort uses.
export function defaultColumns(query, table) {
    const cols = [0, 1].filter(i => i < table.headers.length);
    const add = name => {
        const col = findColumn(table.headers, name);
        if (col.index >= 0 && !cols.includes(col.index)) cols.push(col.index);
    };
    walk(query.q, node => {
        if (!isGroup(node)) add(node.c);
    });
    (query.o || []).forEach(key => add(key.c));
    return cols;
}

function sortValue(table, r, key) {
    if (key.virtual) {
        const row = key.virtual.rows[r];
        return row.count ? row[key.by] : null; // nothing set: last, like an empty cell
    }
    if (key.numeric) {
        const v = parseRange(table.raw[r][key.index] === '' ? table.text[r][key.index] : table.raw[r][key.index]);
        return v ? v[key.by] : null;
    }
    const t = table.text[r][key.index];
    return t === '' ? null : t;
}

export function sortRows(rows, table, sort) {
    if (!sort.length) return rows;
    const decorated = rows.map(r => ({ r, keys: sort.map(key => sortValue(table, r, key)) }));
    decorated.sort((a, b) => {
        for (let i = 0; i < sort.length; i++) {
            const x = a.keys[i];
            const y = b.keys[i];
            if (x === y) continue;
            if (x === null) return 1; // empty cells last, whatever the direction
            if (y === null) return -1;
            const c = sort[i].numeric ? x - y : compareText(x, y);
            if (c) return sort[i].desc ? -c : c;
        }
        return a.r - b.r;
    });
    return decorated.map(d => d.r);
}

// Runs the query. Returns { rows (sorted row indexes), issues, notes, sort, visible, counts, contexts }.
// contexts maps each node path to the rows that reach it: in an 'all of' group, those that pass the nodes before
// it (and whatever narrowed the group itself); in an 'any of' or excluded group the siblings don't narrow. The
// value lists of a filter are offered from these rows.
// counts maps each node path to { alone: rows it lets through by itself (whole table), upTo: rows matching it
// combined with the nodes before it in its group, counted among the rows reaching the group (so the last node
// of a group shows what the group lets through there), before / delta (not for the first node): the previous
// node's upTo and the change, negative along 'all of' (rows removed), positive along 'any of' (rows added),
// without (top level only): rows if it were removed }.
export function runQuery(query, table) {
    const { root, issues } = resolveQuery(query, table);
    const all = table.text.map((_, r) => r);
    const rows = all.filter(r => root(r) !== false);
    const matching = (q, from) => {
        if (!q.items.length) return from;
        const fn = resolveQuery({ ...query, q }, table).root;
        return from.filter(r => fn(r) !== false);
    };

    const contexts = new Map();
    const narrow = (group, prefix, from) => {
        const chain = group.op !== 'or' && !group.not;
        group.items.forEach((node, i) => {
            const path = prefix ? `${prefix}.${i}` : String(i);
            const here = chain ? matching({ op: 'and', items: group.items.slice(0, i) }, from) : from;
            contexts.set(path, here);
            if (isGroup(node)) narrow(node, path, here);
        });
    };
    narrow(query.q, '', all);

    const counts = new Map();
    const visit = (group, prefix) => {
        const from = prefix ? contexts.get(prefix) : all;
        group.items.forEach((node, i) => {
            const path = prefix ? `${prefix}.${i}` : String(i);
            const entry = {
                alone: matching({ op: 'and', items: [node] }, all).length,
                upTo: matching({ op: group.op, items: group.items.slice(0, i + 1) }, from).length
            };
            if (!prefix) entry.without = matching({ ...group, items: group.items.filter((_, j) => j !== i) }, all).length;
            if (prefix && i === 0) entry.reach = from.length; // rows reaching the group
            if (i > 0) {
                entry.before = counts.get(prefix ? `${prefix}.${i - 1}` : String(i - 1)).upTo;
                entry.delta = entry.upTo - entry.before;
            }
            counts.set(path, entry);
            if (isGroup(node)) visit(node, path);
        });
    };
    visit(query.q, '');

    const { sort, visible, notes } = resolveColumns(query, table);
    return { rows: sortRows(rows, table, sort), issues, notes, sort, visible, counts, contexts };
}

export function cellIsLink(text) {
    return /^https?:\/\/\S+$/i.test(cellText(text));
}
