// Thin wrapper around the Google Sheets API v4 and Drive API v3 REST endpoints (adapted from PlanTape).
// Reads can go without a token (API key; works for sheets shared as "anyone with the link") or with one.

import { settings } from './settings.js';
import { getToken, invalidateToken } from './google-auth.js';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';

export class HttpError extends Error {
    constructor(status, message, reason = '') {
        super(message || `HTTP ${status}`);
        this.status = status;
        this.reason = reason; // e.g. API_KEY_SERVICE_BLOCKED
    }
}

// Ported from plant-trainer's ApiClient.fetchWithRetry; client errors (4xx except 429) are not retried.
export async function fetchWithRetry(url, options = {}, { retries = 2, timeoutMs = 20000, retryDelayMs = 1000 } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            if (!response.ok) {
                let message = `HTTP ${response.status}`;
                let reason = '';
                try {
                    const error = (await response.json()).error;
                    message = error?.message || message;
                    reason = error?.details?.find(d => d.reason)?.reason || error?.status || '';
                } catch {
                    // not JSON
                }
                throw new HttpError(response.status, message, reason);
            }
            return response;
        } catch (error) {
            lastError = error;
            const retryable = !(error instanceof HttpError) || error.status === 429 || error.status >= 500;
            if (!retryable) throw error;
            if (attempt < retries) {
                await new Promise(resolve => setTimeout(resolve, retryDelayMs * (attempt + 1)));
            }
        } finally {
            clearTimeout(timeoutId);
        }
    }
    throw lastError;
}

export function hasApiKey() {
    return Boolean(settings.google.apiKey);
}

// auth 'key': API key only, no sign-in. auth 'token': OAuth token (getToken() may open a popup, so only call it
// with a valid token or from a click).
async function api(method, url, body, auth = 'token') {
    if (auth === 'key') {
        const sep = url.includes('?') ? '&' : '?';
        const response = await fetchWithRetry(`${url}${sep}key=${encodeURIComponent(settings.google.apiKey)}`, { method });
        return response.json();
    }
    for (let attempt = 0; attempt < 2; attempt++) {
        const token = await getToken();
        try {
            const response = await fetchWithRetry(url, {
                method,
                headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
                body: body ? JSON.stringify(body) : undefined
            });
            return response.status === 204 ? null : response.json();
        } catch (error) {
            if (error instanceof HttpError && error.status === 401 && attempt === 0) {
                invalidateToken();
                continue;
            }
            throw error;
        }
    }
    return null;
}

export function quoteSheet(title) {
    return `'${String(title).replace(/'/g, "''")}'`;
}

export function getSpreadsheet(id, auth) {
    return api('GET', `${BASE}/${encodeURIComponent(id)}?fields=spreadsheetId,properties.title,spreadsheetUrl,sheets.properties(sheetId,title,index,gridProperties(rowCount,columnCount))`, null, auth);
}

// render: 'UNFORMATTED_VALUE' (numbers as numbers) or 'FORMATTED_VALUE' (as shown in the sheet).
export async function getValues(id, range, render, auth) {
    const res = await api('GET', `${BASE}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}?valueRenderOption=${render}&dateTimeRenderOption=FORMATTED_STRING`, null, auth);
    return res?.values || [];
}

// Appends rows below the table; returns the 1-based row number of the first appended row.
export async function appendRows(id, sheetTitle, rows) {
    const range = encodeURIComponent(`${quoteSheet(sheetTitle)}!A1`);
    const res = await api('POST', `${BASE}/${encodeURIComponent(id)}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { values: rows });
    const match = /![A-Z]+(\d+)/.exec(res?.updates?.updatedRange || '');
    return match ? Number(match[1]) : null;
}

export function updateValues(id, range, rows) {
    return api('PUT', `${BASE}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, { values: rows });
}

// Creates a spreadsheet with the given tabs, each with a bold, frozen header row.
export function createSpreadsheet(title, tabs) {
    return api('POST', BASE, {
        properties: { title },
        sheets: tabs.map((tab, i) => ({
            properties: { sheetId: i + 1, title: tab.title, gridProperties: { frozenRowCount: 1 } },
            data: [{
                startRow: 0,
                startColumn: 0,
                rowData: tab.rows.map((row, r) => ({
                    values: row.map(v => ({
                        userEnteredValue: { stringValue: String(v) },
                        ...(r === 0 ? { userEnteredFormat: { textFormat: { bold: true } } } : {})
                    }))
                }))
            }]
        }))
    });
}

// Drive files visible to the app (drive.file: the ones it created or the user picked) matching a query.
export async function findFiles(q) {
    const res = await api('GET', `${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&spaces=drive`);
    return res?.files || [];
}
