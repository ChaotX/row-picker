// Reading a spreadsheet shared as "anyone with the link" without any key or sign-in: the tab list from the
// htmlview page, the values from the CSV export (both allow cross-origin reads). Values come as shown in the sheet
// (no separate unformatted numbers). A private sheet redirects to the Google login page, which fails as a
// cross-origin request; that is reported as NotPublicError.

import { fetchWithRetry, HttpError } from './sheets-api.js';

const DOCS = 'https://docs.google.com/spreadsheets/d';

export class NotPublicError extends Error {}

// RFC 4180 CSV: quoted fields, "" escapes, newlines inside quotes, CRLF or LF.
export function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    quoted = false;
                }
            } else {
                field += ch;
            }
        } else if (ch === '"') {
            quoted = true;
        } else if (ch === ',') {
            row.push(field);
            field = '';
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += ch;
        }
    }
    if (field || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

// JS string literal body from the htmlview page ('\x3d', '\/', 'é') → text.
function unescapeJs(s) {
    return s.replace(/\\x([0-9a-fA-F]{2})|\\u([0-9a-fA-F]{4})|\\(.)/g, (_, x, u, c) => {
        if (x) return String.fromCharCode(parseInt(x, 16));
        if (u) return String.fromCharCode(parseInt(u, 16));
        return { n: '\n', t: '\t', r: '\r' }[c] ?? c;
    });
}

// The htmlview page → { title, tabs: [{ gid, title, index }] }.
export function parseHtmlView(html) {
    const tabs = [];
    const re = /\{name:\s*"((?:[^"\\]|\\.)*)",\s*pageUrl:\s*"(?:[^"\\]|\\.)*",\s*gid:\s*"(\d+)"/g;
    let m;
    while ((m = re.exec(html))) {
        const gid = Number(m[2]);
        if (!tabs.some(t => t.gid === gid)) tabs.push({ gid, title: unescapeJs(m[1]), index: tabs.length });
    }
    const titleMatch = /<title>([^<]*)<\/title>/.exec(html);
    const title = titleMatch ? titleMatch[1].replace(/\s+-\s+Google (Drive|Sheets|Táblázatok)\s*$/i, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim() : '';
    return { title, tabs };
}

async function get(url) {
    try {
        const response = await fetchWithRetry(url, { credentials: 'omit', redirect: 'follow' }, { retries: 1 });
        const type = response.headers.get('content-type') || '';
        return { response, type };
    } catch (error) {
        if (error instanceof HttpError) throw error;
        // A redirect to the login page fails the cross-origin check: not shared publicly (or offline).
        if (typeof navigator !== 'undefined' && navigator.onLine === false) throw error;
        throw new NotPublicError(error.message);
    }
}

export async function publicSpreadsheet(id) {
    const { response, type } = await get(`${DOCS}/${encodeURIComponent(id)}/htmlview`);
    if (!type.includes('html')) throw new NotPublicError('Unexpected response');
    const { title, tabs } = parseHtmlView(await response.text());
    if (!tabs.length) throw new NotPublicError('No tabs found');
    return { title: title || id, tabs: tabs.map(t => ({ ...t, rows: 0, cols: 0 })) };
}

// → rows of text (the first is the header).
export async function publicValues(id, gid) {
    const { response, type } = await get(`${DOCS}/${encodeURIComponent(id)}/export?format=csv&gid=${encodeURIComponent(gid)}`);
    if (type.includes('html')) throw new NotPublicError('Login page instead of CSV');
    return parseCsv(await response.text());
}
