// Google sign-in with Google Identity Services (token model, no backend).
// Scope drive.file: the app only sees spreadsheets it created or the user picked in the Drive Picker.
// The token is kept in localStorage, so reloads and new tabs reuse it until it expires (about an hour). All
// token handling is behind getToken(), so a backend that refreshes tokens could replace this module later.

import { settings, storageKey } from './settings.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

let tokenClient = null;
let token = null;
let expiresAt = 0;
let pendingRequest = null;
let restored = false;

// The token saved by an earlier page load of this app (read on first use: the storage keys depend on settings).
function restore() {
    if (restored) return;
    restored = true;
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey('token')) || 'null');
        if (saved && saved.expiresAt > Date.now() + 60000) {
            token = saved.token;
            expiresAt = saved.expiresAt;
        }
    } catch {
        // localStorage unavailable
    }
}

export function isConfigured() {
    return Boolean(settings.google.clientId);
}

// True after a sign-in in this browser (until sign-out): signing in again then needs no consent screen.
export function hasSignedInBefore() {
    try {
        return localStorage.getItem(storageKey('signedIn')) === '1';
    } catch {
        return false;
    }
}

export function hasValidToken() {
    restore();
    return Boolean(token) && Date.now() < expiresAt - 60000;
}

function waitForGis(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
            if (window.google?.accounts?.oauth2) resolve();
            else if (Date.now() - start > timeoutMs) reject(new Error('Google sign-in library did not load'));
            else setTimeout(check, 100);
        };
        if (!document.querySelector(`script[src="${GIS_SRC}"]`)) {
            const s = document.createElement('script');
            s.src = GIS_SRC;
            s.async = true;
            document.head.appendChild(s);
        }
        check();
    });
}

async function ensureClient() {
    if (tokenClient) return;
    await waitForGis();
    tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: settings.google.clientId,
        scope: SCOPE,
        callback: () => {} // replaced per request
    });
}

// Requests a token. prompt '' tries to reuse the existing grant without showing the consent screen.
export async function requestToken({ prompt = '' } = {}) {
    if (pendingRequest) return pendingRequest;
    await ensureClient();
    pendingRequest = new Promise((resolve, reject) => {
        tokenClient.callback = response => {
            if (response.error) {
                reject(new Error(response.error_description || response.error));
                return;
            }
            token = response.access_token;
            expiresAt = Date.now() + Number(response.expires_in || 3600) * 1000;
            try {
                localStorage.setItem(storageKey('token'), JSON.stringify({ token, expiresAt }));
                localStorage.setItem(storageKey('signedIn'), '1');
            } catch {
                // ignore
            }
            resolve(token);
        };
        tokenClient.error_callback = err => reject(new Error(err?.message || err?.type || 'Sign-in failed'));
        tokenClient.requestAccessToken({ prompt });
    }).finally(() => {
        pendingRequest = null;
    });
    return pendingRequest;
}

export async function getToken() {
    if (hasValidToken()) return token;
    return requestToken({ prompt: '' });
}

export function invalidateToken() {
    token = null;
    expiresAt = 0;
    try {
        localStorage.removeItem(storageKey('token'));
    } catch {
        // ignore
    }
}

export function signOut() {
    if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token, () => {});
    invalidateToken();
    try {
        localStorage.removeItem(storageKey('signedIn'));
    } catch {
        // ignore
    }
}
