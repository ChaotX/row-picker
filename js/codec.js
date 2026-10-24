// Query ⇄ URL parameter: JSON, compressed with deflate-raw and base64url-encoded, with a one-letter format prefix
// so the encoding can change later without breaking saved links. 'z' = deflate-raw, 'j' = plain JSON (fallback
// when the browser has no CompressionStream).

import { QUERY_VERSION } from './query.js';

function toBase64Url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function pipe(bytes, stream) {
    const out = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(out).arrayBuffer());
}

// Drops defaults and empty values so links stay short.
export function compact(query) {
    const strip = node => {
        if (Array.isArray(node.items)) {
            const out = { op: node.op, items: node.items.map(strip) };
            if (node.not) out.not = true;
            return out;
        }
        const out = {};
        for (const [k, v] of Object.entries(node)) {
            if (v === null || v === undefined || v === false || v === '') continue;
            if (k === 'how' && v === 'overlap') continue;
            if (k === 'm' && v === 'contains') continue;
            out[k] = v;
        }
        if (node.k === 'flag' && node.set === false) out.set = false;
        return out;
    };
    const out = { v: query.v || QUERY_VERSION, s: query.s, q: strip(query.q) };
    if (query.n) out.n = query.n;
    if (query.g !== null && query.g !== undefined) out.g = query.g;
    if (query.t) out.t = query.t;
    if (query.o?.length) out.o = query.o.map(o => ({ c: o.c, ...(o.d === 'desc' ? { d: 'desc' } : {}), ...(o.by === 'max' ? { by: 'max' } : {}) }));
    if (query.cols?.length) out.cols = query.cols;
    return out;
}

// Fills in the defaults compact() dropped and checks the shape.
export function expand(data) {
    if (!data || typeof data !== 'object' || typeof data.s !== 'string') throw new Error('Not a row-picker query');
    const fix = node => {
        if (Array.isArray(node?.items)) return { op: node.op === 'or' ? 'or' : 'and', items: node.items.map(fix), ...(node.not ? { not: true } : {}) };
        const f = { ...node, not: Boolean(node.not) };
        if (f.k === 'text') f.m = f.m || 'contains';
        if (f.k === 'range') {
            f.how = f.how || 'overlap';
            f.min = Number.isFinite(f.min) ? f.min : null;
            f.max = Number.isFinite(f.max) ? f.max : null;
        }
        if (f.k === 'flag') f.set = f.set !== false;
        if (f.k === 'in' || f.k === 'has') f.v = Array.isArray(f.v) ? f.v.map(String) : [];
        if (f.k === 'in' || f.k === 'has') f.wide = Boolean(f.wide);
        return f;
    };
    return {
        v: data.v || QUERY_VERSION,
        n: typeof data.n === 'string' ? data.n.slice(0, 120) : '',
        s: data.s,
        g: Number.isFinite(data.g) ? data.g : null,
        t: data.t || '',
        q: fix(data.q && Array.isArray(data.q.items) ? data.q : { op: 'and', items: [] }),
        o: Array.isArray(data.o) ? data.o.filter(o => o && o.c).map(o => ({ c: String(o.c), d: o.d === 'desc' ? 'desc' : 'asc', by: o.by === 'max' ? 'max' : 'min' })) : [],
        cols: Array.isArray(data.cols) && data.cols.length ? data.cols.map(String) : null
    };
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
    }
    return value;
}

// A comparison key: equal for queries that filter, sort and show the same, however they were built (key order,
// order of chosen values). withName false: ignore the name too.
export function queryKey(query, { withName = true } = {}) {
    const c = compact(query);
    if (!withName) delete c.n;
    const sortValues = node => {
        if (Array.isArray(node.items)) node.items.forEach(sortValues);
        else if (Array.isArray(node.v)) node.v = [...node.v].sort();
    };
    sortValues(c.q);
    return JSON.stringify(canonical(c));
}

export async function encodeQuery(query) {
    const json = new TextEncoder().encode(JSON.stringify(compact(query)));
    if (typeof CompressionStream === 'function') {
        return `z${toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))}`;
    }
    return `j${toBase64Url(json)}`;
}

export async function decodeQuery(text) {
    const s = String(text || '').trim();
    const body = s.slice(1);
    let bytes;
    if (s[0] === 'z') bytes = await pipe(fromBase64Url(body), new DecompressionStream('deflate-raw'));
    else if (s[0] === 'j') bytes = fromBase64Url(body);
    else throw new Error('Unknown link format');
    return expand(JSON.parse(new TextDecoder().decode(bytes)));
}
