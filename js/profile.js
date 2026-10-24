// Column profiling: guesses what kind of values a column holds, so the builder can offer a fitting filter.
// Everything here is pure (no DOM), so it runs in node --test too.

export const KINDS = ['flag', 'range', 'enum', 'list', 'text'];

const ENUM_MAX = 40;          // at most this many distinct values …
const ENUM_SHARE = 0.25;      // … and at most this share of the non-empty cells
const RANGE_RATE = 0.9;       // share of non-empty cells that must parse as a number or range
const YES = ['igen', 'yes', 'true', 'x', '✓', '✔', '●', '1', 'i'];
const NO = ['nem', 'no', 'false', '0', '-', '–', '—', 'n'];

let textLocale = 'en';
let collator = new Intl.Collator(textLocale, { sensitivity: 'base', numeric: true });

// The language used to compare, lower-case and sort cell text ('hu': Hungarian alphabet order, …).
export function setTextLocale(locale) {
    textLocale = locale || 'en';
    collator = new Intl.Collator(textLocale, { sensitivity: 'base', numeric: true });
}

export function compareText(a, b) {
    return collator.compare(a, b);
}

// Case-insensitive comparison key (accents are kept: in Hungarian o and ö are different letters).
export function fold(value) {
    return String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase(textLocale);
}

// Looser key for matching renamed headers: also drops accents and punctuation.
export function looseKey(value) {
    return fold(value).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
}

export function cellText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return String(value).trim();
}

export function isNo(text) {
    return NO.includes(fold(text));
}

// A cell counts as "set" when it has a value that doesn't mean no (●, Igen, TRUE, any text).
export function isSet(value) {
    const text = cellText(value);
    return text !== '' && !isNo(text);
}

// '1,5' → 1.5, '1 540' → 1540, '1.234,5' → 1234.5, '0.5' → 0.5, '1,540' → 1540 (a comma before exactly three
// digits is a thousands separator, as in '1,540 Ft' from a sheet with English number format); null when not a number.
export function parseNumber(text) {
    let s = String(text).replace(/[\s  ]/g, '');
    if (!/^[+-]?(\d+([.,]\d+)*|[.,]\d+)$/.test(s)) return null;
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
        const decimal = lastDot > lastComma ? '.' : ',';
        const thousands = decimal === '.' ? ',' : '.';
        s = s.split(thousands).join('').replace(decimal, '.');
    } else if (lastComma >= 0) {
        const thousands = s.match(/,/g).length > 1 || /^[+-]?[1-9]\d{0,2},\d{3}$/.test(s);
        s = thousands ? s.split(',').join('') : s.replace(',', '.');
    } else if ((s.match(/\./g) || []).length > 1) {
        s = s.split('.').join('');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

const RANGE_RE = /^\s*[~≈]?\s*(?:kb\.?\s*)?([+-]?[\d\s  .,]*\d)\s*(?:(?:[–—-]|\.\.)\s*([+-]?[\d\s  .,]*\d))?\s*([^\d]{0,12})$/i;

// A number or range cell → [min, max], or null. Handles '15–20', '1,5–2 m', '0,4', 1540 (a number cell), '995 Ft'.
export function parseRange(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? [value, value] : null;
    const text = cellText(value);
    if (!text) return null;
    const m = RANGE_RE.exec(text);
    if (!m || /\d/.test(m[3])) return null;
    const a = parseNumber(m[1]);
    const b = m[2] === undefined ? a : parseNumber(m[2]);
    if (a === null || b === null) return null;
    return a <= b ? [a, b] : [b, a];
}

// Splits a list cell on , and ; outside parentheses and not inside a decimal number:
// 'Sövény, szoliter (kicsi, nagy)' → ['Sövény', 'szoliter (kicsi, nagy)'], '1,5–2' → ['1,5–2'].
export function splitList(text) {
    const s = String(text);
    const parts = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '(' || ch === '[') depth++;
        else if ((ch === ')' || ch === ']') && depth > 0) depth--;
        const decimal = ch === ',' && /\d/.test(s[i - 1] || '') && /\d/.test(s[i + 1] || '');
        if ((ch === ',' || ch === ';') && depth === 0 && !decimal) {
            parts.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    parts.push(current);
    return parts.map(p => p.trim()).filter(Boolean);
}

// Splits a scale value: 'Napos–félárnyék' → ['Napos', 'félárnyék'].
export function splitParts(text) {
    return String(text).split(/\s*[–—]\s*/).map(p => p.trim()).filter(Boolean);
}

function capitalize(text) {
    return text.charAt(0).toLocaleUpperCase(textLocale) + text.slice(1);
}

// How many of the given rows have each value of column ci (by folded key). mode: 'values' (whole cells), 'parts'
// (scale parts: Napos–félárnyék counts for both) or 'tokens' (list items). A row counts once per value.
export function countValues(text, rows, ci, mode = 'values') {
    const counts = new Map();
    for (const r of rows) {
        const cell = text[r][ci];
        if (!cell) continue;
        const list = mode === 'parts' ? splitParts(cell) : mode === 'tokens' ? splitList(cell) : [cell];
        for (const key of new Set(list.map(fold))) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
}

// Counts values by their folded key, remembering the most common spelling of each (items of lists and scales
// are shown capitalized: 'szoliter' and 'Szoliter' are one item).
function tally(values, capital = false) {
    const map = new Map();
    for (const v of values) {
        const key = fold(v);
        let entry = map.get(key);
        if (!entry) {
            entry = { value: v, count: 0, spellings: new Map() };
            map.set(key, entry);
        }
        entry.count++;
        const n = (entry.spellings.get(v) || 0) + 1;
        entry.spellings.set(v, n);
        if (n > (entry.spellings.get(entry.value) || 0)) entry.value = v;
    }
    return [...map.values()]
        .map(({ value, count }) => ({ value: capital ? capitalize(value) : value, count }))
        .sort((a, b) => b.count - a.count || compareText(a.value, b.value));
}

// Profiles one column. raw: unformatted cell values, text: what the sheet shows.
export function profileColumn(raw, text) {
    const nonEmpty = [];
    let parsed = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < text.length; i++) {
        const t = text[i];
        if (!t) continue;
        nonEmpty.push(t);
        const r = parseRange(raw[i] ?? t);
        if (r) {
            parsed++;
            min = Math.min(min, r[0]);
            max = Math.max(max, r[1]);
        }
    }
    const values = tally(nonEmpty);
    const n = nonEmpty.length;
    const profile = { nonEmpty: n, values, numericRate: n ? parsed / n : 0, min: parsed ? min : null, max: parsed ? max : null };

    // Scale values joined by dashes, made of values that also occur alone (Napos–félárnyék, Alacsony–közepes).
    const known = new Set(values.map(v => fold(v.value)));
    const composite = values.filter(v => splitParts(v.value).length > 1);
    if (profile.numericRate < 0.5 && composite.length && composite.some(v => splitParts(v.value).every(p => known.has(fold(p))))) {
        profile.parts = tally(nonEmpty.flatMap(splitParts), true);
    }

    // Lists: cells with separators whose items repeat across rows.
    const listCells = nonEmpty.filter(t => splitList(t).length > 1).length;
    if (n && listCells / n >= 0.2) {
        const tokens = tally(nonEmpty.flatMap(splitList), true);
        const uses = tokens.reduce((sum, t) => sum + t.count, 0);
        const repeated = tokens.filter(t => t.count > 1).reduce((sum, t) => sum + t.count, 0);
        if (repeated / uses >= 0.6 && tokens.length < uses * 0.6) profile.tokens = tokens;
    }

    profile.kind = detectKind(profile);
    return profile;
}

function detectKind(p) {
    const distinct = p.values.length;
    if (p.nonEmpty === 0) return 'flag';
    if (distinct === 1) return 'flag';
    if (distinct === 2 && p.values.some(v => isNo(v.value)) && p.values.some(v => YES.includes(fold(v.value)))) return 'flag';
    if (p.numericRate >= RANGE_RATE && distinct > 2) return 'range';
    if (distinct <= ENUM_MAX && distinct <= p.nonEmpty * ENUM_SHARE) return 'enum';
    if (p.tokens) return 'list';
    return 'text';
}

// The filter types that make sense for a column, the most fitting first.
export function filterKindsFor(profile) {
    const kinds = [];
    if (profile.kind === 'flag') kinds.push('flag');
    if (profile.kind === 'range') kinds.push('range');
    if (profile.kind === 'enum') kinds.push('in');
    if (profile.tokens) kinds.push('has');
    if (profile.kind !== 'enum' && profile.values.length <= 300 && profile.values.length > 1) kinds.push('in');
    if (profile.kind !== 'range' && profile.numericRate >= 0.5) kinds.push('range');
    kinds.push('text');
    if (profile.kind !== 'flag') kinds.push('flag');
    return kinds;
}

// Builds the table the rest of the app works on. headerRow: first row; rawRows / textRows: the data rows as
// unformatted values and as shown. Empty headers become 'Column N', repeated ones get ' (2)'.
export function buildTable(headerRow, rawRows, textRows, columnWord = 'Column') {
    const width = Math.max(headerRow.length, ...rawRows.map(r => r.length), ...textRows.map(r => r.length), 0);
    const headers = [];
    const seen = new Map();
    for (let c = 0; c < width; c++) {
        let name = cellText(headerRow[c]) || `${columnWord} ${c + 1}`;
        const key = fold(name);
        const n = (seen.get(key) || 0) + 1;
        seen.set(key, n);
        if (n > 1) name = `${name} (${n})`;
        headers.push(name);
    }
    // Drop rows that are completely empty (trailing blank rows inside the used range).
    const keep = [];
    for (let r = 0; r < Math.max(rawRows.length, textRows.length); r++) {
        const tr = textRows[r] || [];
        const rr = rawRows[r] || [];
        if (tr.some(v => cellText(v)) || rr.some(v => cellText(v))) keep.push(r);
    }
    const raw = keep.map(r => headers.map((_, c) => rawRows[r]?.[c] ?? ''));
    const text = keep.map(r => headers.map((_, c) => cellText(textRows[r]?.[c] ?? rawRows[r]?.[c] ?? '')));
    const profiles = headers.map((_, c) => profileColumn(raw.map(row => row[c]), text.map(row => row[c])));
    return { headers, raw, text, profiles, rowNumbers: keep.map(r => r + 2) };
}
