// Loading a spreadsheet, trying in turn:
//   key    — Sheets API with the API key (no sign-in; link-shared sheets; numbers come unformatted),
//   public — the public htmlview / CSV export (no key at all; link-shared sheets; values as shown),
//   token  — Sheets API with the signed-in user's token (private sheets).
// Errors carry a code the UI turns into a message with the right next step.

import { hasValidToken } from './google-auth.js';
import { NotPublicError, publicSpreadsheet, publicValues } from './public-sheet.js';
import { getSpreadsheet, getValues, hasApiKey, HttpError, quoteSheet } from './sheets-api.js';

export class LoadError extends Error {
    // code: needsSignIn | needsGrant | notFound | tabMissing | offline | other
    constructor(code, message = code, extra = {}) {
        super(message);
        this.code = code;
        Object.assign(this, extra);
    }
}

// Remembers per spreadsheet which way worked, so a private sheet doesn't try the others on every reload.
const accessById = new Map();
let keyBlocked = false;

function isAccessError(error) {
    return error instanceof NotPublicError || (error instanceof HttpError && [400, 401, 403, 404].includes(error.status));
}

function classify(error) {
    if (error instanceof LoadError) return error;
    if (error instanceof HttpError) {
        if (error.status === 404) return new LoadError('notFound', error.message);
        if (error.status === 403 || error.status === 401) return new LoadError('needsGrant', error.message);
        return new LoadError('other', error.message);
    }
    if (!navigator.onLine || error?.name === 'AbortError' || error instanceof TypeError) return new LoadError('offline', error?.message);
    return new LoadError('other', error?.message || String(error));
}

// requests: { key, public, token } functions. Throws LoadError.
async function withAccess(id, requests) {
    const preferred = accessById.get(id);
    const order = ['key', 'public', 'token'].sort((a, b) => (b === preferred) - (a === preferred));
    let notFound = 0;
    let tried = 0;
    let lastError = null;
    for (const auth of order) {
        if (auth === 'key' && (!hasApiKey() || keyBlocked)) continue;
        if (auth === 'token' && !hasValidToken()) continue;
        tried++;
        try {
            const result = await requests[auth]();
            accessById.set(id, auth);
            return result;
        } catch (error) {
            if (!isAccessError(error)) throw classify(error);
            lastError = error;
            if (error instanceof HttpError && error.status === 404) notFound++;
            if (auth === 'key' && error.reason === 'API_KEY_SERVICE_BLOCKED') {
                keyBlocked = true;
                console.warn('row-picker: the API key may not call the Sheets API (README → Google Cloud setup); using the public export or sign-in.');
            }
            if (auth === 'token') {
                // With a token, a sheet the user hasn't chosen in the Picker yet looks like 403 / 404 under drive.file.
                throw new LoadError('needsGrant', error.message, { status: error.status });
            }
        }
    }
    // Every way that ran said 404: it really isn't there (the public export also answers 404 for unknown ids).
    if (tried && notFound === tried) throw new LoadError('notFound', lastError?.message);
    if (!hasValidToken()) throw new LoadError('needsSignIn', lastError?.message || 'Sign-in needed');
    throw classify(lastError || new Error('No way to read the spreadsheet'));
}

// → { id, title, url, tabs: [{ gid, title, rows, cols, index }] }
export async function loadSpreadsheet(id) {
    const fromApi = auth => async () => {
        const meta = await getSpreadsheet(id, auth);
        return {
            title: meta.properties?.title || id,
            tabs: (meta.sheets || []).map(s => ({
                gid: s.properties.sheetId,
                title: s.properties.title,
                index: s.properties.index,
                rows: s.properties.gridProperties?.rowCount || 0,
                cols: s.properties.gridProperties?.columnCount || 0
            }))
        };
    };
    const meta = await withAccess(id, { key: fromApi('key'), public: () => publicSpreadsheet(id), token: fromApi('token') });
    return { id, ...meta, url: `https://docs.google.com/spreadsheets/d/${id}/edit` };
}

// The tab a query means: by gid, else by title. → { tab, byTitle } or throws tabMissing.
export function findTab(spreadsheet, gid, title) {
    if (gid !== null && gid !== undefined) {
        const tab = spreadsheet.tabs.find(t => t.gid === gid);
        if (tab) return { tab, byTitle: false };
    }
    if (title) {
        const tab = spreadsheet.tabs.find(t => t.title === title);
        if (tab) return { tab, byTitle: gid !== null && gid !== undefined };
    }
    throw new LoadError('tabMissing', `Tab not found: ${title || gid}`, { spreadsheet });
}

// → { header, raw, text }: the first row and the data rows, unformatted and as shown in the sheet.
export async function loadTab(id, tab) {
    const range = quoteSheet(tab.title);
    const fromApi = auth => async () => {
        const [raw, text] = await Promise.all([
            getValues(id, range, 'UNFORMATTED_VALUE', auth),
            getValues(id, range, 'FORMATTED_VALUE', auth)
        ]);
        return { header: text[0] || raw[0] || [], raw: raw.slice(1), text: text.slice(1) };
    };
    return withAccess(id, {
        key: fromApi('key'),
        public: async () => {
            const rows = await publicValues(id, tab.gid);
            return { header: rows[0] || [], raw: rows.slice(1), text: rows.slice(1) };
        },
        token: fromApi('token')
    });
}
