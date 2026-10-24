// Short links: ?l=<id> → an encoded query stored in a private spreadsheet in the user's own Drive, named by
// settings.linksTitle (e.g. 'row-picker links'). The app creates it on the first save; drive.file lets it find
// that file again (and no other file), so nothing needs configuring. The sheet is never shared, so it doesn't
// leak which spreadsheets the saved filters point to. Needs a signed-in user.

import { appendRows, createSpreadsheet, findFiles, getValues, HttpError, quoteSheet, updateValues } from './sheets-api.js';
import { decodeQuery, queryKey } from './codec.js';
import { settings, storageKey } from './settings.js';
import { storage } from './util.js';

const TAB = 'links';
const HEADER = ['id', 'name', 'query', 'created', 'updated'];
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // no l / o / 0 / 1: easy to read and type

export function isShortId(text) {
    return /^[a-z2-9]{4,12}$/.test(String(text || ''));
}

function newId(length = 6) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return [...bytes].map(b => ALPHABET[b % ALPHABET.length]).join('');
}

function stamp() {
    return new Date().toISOString().replace('T', ' ').slice(0, 16);
}

// The links spreadsheet id; create: make it when missing (otherwise null).
async function linksSheetId({ create = false } = {}) {
    const cached = storage.get(storageKey('linksSheet'));
    if (cached) return cached;
    const files = await findFiles(`name = '${settings.linksTitle.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`);
    if (files.length) {
        storage.set(storageKey('linksSheet'), files[0].id);
        return files[0].id;
    }
    if (!create) return null;
    const created = await createSpreadsheet(settings.linksTitle, [{ title: TAB, rows: [HEADER] }]);
    storage.set(storageKey('linksSheet'), created.spreadsheetId);
    return created.spreadsheetId;
}

// Reads all links; a cached id that no longer works (sheet deleted) is looked up again once.
async function readLinks(options = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
        const sheetId = await linksSheetId(options);
        if (!sheetId) return { sheetId: null, links: [] };
        try {
            const rows = await getValues(sheetId, `${quoteSheet(TAB)}!A1:E`, 'FORMATTED_VALUE', 'token');
            const header = (rows[0] || []).map(h => String(h).trim().toLowerCase());
            const col = name => header.indexOf(name);
            const links = rows.slice(1).map((row, i) => ({
                id: String(row[col('id')] ?? '').trim(),
                name: String(row[col('name')] ?? ''),
                query: String(row[col('query')] ?? ''),
                created: String(row[col('created')] ?? ''),
                updated: String(row[col('updated')] ?? ''),
                row: i + 2
            })).filter(l => l.id);
            return { sheetId, links };
        } catch (error) {
            if (attempt === 0 && error instanceof HttpError && [400, 403, 404].includes(error.status)) {
                storage.remove(storageKey('linksSheet'));
                continue;
            }
            throw error;
        }
    }
    return { sheetId: null, links: [] };
}

export async function listLinks() {
    return (await readLinks()).links;
}

// → the stored link { id, name, query, … } or null.
export async function resolveLink(id) {
    const { links } = await readLinks();
    return links.find(l => l.id === id) || null;
}

const decoded = new Map(); // stored query text → its comparison key (decoding is async; the texts don't change)

// The saved link whose query filters, sorts and shows the same as this one (names ignored), or null. When
// several do, the one with the same name, else the latest. → { link, key } with key = the saved query's full key.
export async function findSavedLink(query) {
    return matchLinks(query, await listLinks());
}

// The matching part of findSavedLink, for given link rows ({ id, name, query }).
export async function matchLinks(query, links) {
    const wanted = queryKey(query, { withName: false });
    const matches = [];
    for (const link of links) {
        if (!decoded.has(link.query)) {
            try {
                const saved = await decodeQuery(link.query);
                decoded.set(link.query, { loose: queryKey(saved, { withName: false }), full: queryKey(saved), name: saved.n || link.name });
            } catch {
                decoded.set(link.query, null); // a row edited by hand into something unreadable
            }
        }
        const d = decoded.get(link.query);
        if (d && d.loose === wanted) matches.push({ link, key: d.full, name: d.name });
    }
    if (!matches.length) return null;
    return matches.find(m => m.name === (query.n || '')) || matches[matches.length - 1];
}

// Saves a new link and returns its id.
export async function createLink(query, name = '') {
    const { sheetId, links } = await readLinks({ create: true });
    const taken = new Set(links.map(l => l.id));
    let id = newId();
    while (taken.has(id)) id = newId();
    const now = stamp();
    await appendRows(sheetId, TAB, [[id, name, query, now, now]]);
    return id;
}

// Points an existing link at a new query (and name).
export async function updateLink(id, query, name) {
    const { sheetId, links } = await readLinks();
    const link = links.find(l => l.id === id);
    if (!link) throw new Error(`Short link not found: ${id}`);
    await updateValues(sheetId, `${quoteSheet(TAB)}!B${link.row}:E${link.row}`, [[name ?? link.name, query, link.created, stamp()]]);
}

export function linksSheetUrl() {
    const id = storage.get(storageKey('linksSheet'));
    return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : '';
}
