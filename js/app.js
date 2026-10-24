// The app: build a filter / sort query over a Google Sheet, see the matching rows live, and keep the query as a
// link. ?q=<encoded query> is self-contained; ?l=<id> is a short link stored in the user's own Drive.
// Started by startApp() in index.js, after the settings are in place and the page frame is mounted.

import { encodeQuery, decodeQuery, queryKey } from './codec.js';
import { LoadError, findTab, loadSpreadsheet, loadTab } from './data.js';
import { hasSignedInBefore, hasValidToken, isConfigured, requestToken, signOut } from './google-auth.js';
import { applyTranslations, getLanguage, languages, setLanguage, t } from './i18n.js';
import { pickSpreadsheet, spreadsheetIdFromUrl } from './picker.js';
import { addColumnGroups } from './groups.js';
import { buildTable } from './profile.js';
import { emptyQuery, runQuery } from './query.js';
import { settings, storageKey } from './settings.js';
import { createLink, findSavedLink, isShortId, linksSheetUrl, listLinks, resolveLink, updateLink } from './shortlinks.js';
import { renderBuilder, updateBuilder } from './ui/builder.js';
import { $, el, option } from './ui/dom.js';
import { renderResults } from './ui/results.js';
import { renderStart } from './ui/start.js';
import { debounce, storage } from './util.js';


const state = {
    spreadsheet: null,
    tab: null,
    table: null,
    query: null,
    result: null,
    code: '',            // the encoded current query
    key: '',             // its comparison key (queryKey)
    short: null,         // { id, name, key } when opened from / saved as / matching a short link
    view: { shown: 0, expanded: new Set() },
    builderCtx: null
};

// ---------- screens ----------

function showScreen(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
    document.body.dataset.screen = id;
    const loaded = id === 'mainScreen';
    $('#sheetInfo').classList.toggle('hidden', !loaded);
    $('#reloadButton').classList.toggle('hidden', !loaded);
    $('#changeSheetButton').classList.toggle('hidden', id === 'startScreen');
}

function showLoading(text) {
    $('#loadingText').textContent = text;
    showScreen('loadingScreen');
}

// actions: [{ label, run, primary }]
function showMessage(title, text, actions = [], kind = 'error') {
    $('#messageTitle').textContent = title;
    $('#messageText').replaceChildren(...[].concat(text).map(p => el('p', {}, p)));
    $('#messageBox').dataset.kind = kind;
    $('#messageActions').replaceChildren(...actions.map(a => el('button', { class: `btn${a.primary ? ' primary' : ''}${a.ghost ? ' ghost' : ''}`, onclick: a.run }, a.label)));
    showScreen('messageScreen');
}

let toastTimer;
function toast(text, kind = 'info') {
    const box = $('#toast');
    box.textContent = text;
    box.dataset.kind = kind;
    box.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.add('hidden'), 3500);
}

function showStart() {
    state.spreadsheet = null;
    state.table = null;
    state.short = null;
    history.replaceState(null, '', location.pathname);
    renderStart($('#startScreen'), {
        recent: storage.get(storageKey('recent'), []),
        configured: isConfigured(),
        onOpen: (id, gid) => openQuery(emptyQuery(id, gid ?? null, '')),
        onPick: pickFromDrive,
        onForget: id => {
            storage.set(storageKey('recent'), storage.get(storageKey('recent'), []).filter(r => r.id !== id));
            showStart();
        }
    });
    showScreen('startScreen');
}

// ---------- signing in ----------

async function signIn() {
    await requestToken({ prompt: '' });
    renderAccount();
}

function renderAccount() {
    const button = $('#accountButton');
    if (!isConfigured()) {
        button.classList.add('hidden');
        return;
    }
    const valid = hasValidToken();
    button.textContent = valid ? `✓ ${t('signedIn')}` : t('signIn');
    button.title = valid ? t('signOutHint') : t('signInHint');
}

async function onAccountClick() {
    if (hasValidToken()) {
        if (!confirm(t('signOutConfirm'))) return;
        signOut();
        renderAccount();
        toast(t('signedOut'));
        return;
    }
    try {
        await signIn();
        toast(t('signedInToast'));
    } catch (error) {
        toast(error.message, 'error');
    }
}

async function pickFromDrive(fileId = '') {
    try {
        if (!hasValidToken()) await signIn();
        const picked = await pickSpreadsheet({ title: t('pickTitle'), locale: getLanguage(), fileId });
        return picked;
    } catch (error) {
        toast(error.message, 'error');
        return null;
    }
}

// ---------- loading ----------

// Loads the spreadsheet and tab a query names, then shows the builder. Errors become a message with the next step.
// keepPanel: a reload keeps the filter panel as it is; otherwise a query that already has filters or a sort (an
// opened link) starts with the panel closed, so the results are in view.
async function openQuery(query, { short = null, keepPanel = false } = {}) {
    state.short = short;
    if (!keepPanel) state.builderCtx = { collapsed: query.q.items.length > 0 || query.o.length > 0 };
    showLoading(t('loadingSheet'));
    let spreadsheet;
    try {
        spreadsheet = await loadSpreadsheet(query.s);
    } catch (error) {
        handleLoadError(error, query, () => openQuery(query, { short }));
        return;
    }
    let tab;
    let tabNote = '';
    try {
        if (query.g === null && !query.t) {
            tab = rememberedTab(spreadsheet);
            if (!tab) {
                chooseTab(spreadsheet, query);
                return;
            }
        } else {
            const found = findTab(spreadsheet, query.g, query.t);
            tab = found.tab;
            if (found.byTitle) tabNote = t('tabFoundByTitle', { tab: tab.title });
        }
    } catch (error) {
        handleLoadError(error, query, () => openQuery(query, { short }));
        return;
    }
    await openTab(spreadsheet, tab, query, tabNote);
}

// The tab used last time for this spreadsheet, or the only one; null when the user has to choose.
function rememberedTab(spreadsheet) {
    if (spreadsheet.tabs.length === 1) return spreadsheet.tabs[0];
    const remembered = storage.get(storageKey('recent'), []).find(r => r.id === spreadsheet.id);
    return (remembered && spreadsheet.tabs.find(tab => tab.gid === remembered.gid)) || null;
}

// Asks which tab holds the data (one row per item, column names in the first row).
function chooseTab(spreadsheet, query) {
    const tabs = spreadsheet.tabs.map(tab => ({
        label: tab.title,
        run: () => openTab(spreadsheet, tab, { ...query, g: tab.gid, t: tab.title })
    }));
    showMessage(t('chooseTabTitle'), [t('chooseTabText', { sheet: spreadsheet.title }), t('chooseTabLater')],
        [...tabs, { label: `← ${t('openAnother')}`, run: showStart, ghost: true }], 'tabs');
}

// Starts an empty query on the same spreadsheet and tab. The previous one stays in the browser history: Back
// brings it back (a popstate reloads the page from its address).
function newQuery() {
    history.pushState(null, '', location.href);
    state.short = null;
    state.query = emptyQuery(state.spreadsheet.id, state.tab.gid, state.tab.title);
    state.builderCtx = { collapsed: false };
    state.view = { shown: 0, expanded: new Set() };
    renderAll();
    toast(t('newQueryToast'));
}

function switchTab(gid) {
    const tab = state.spreadsheet.tabs.find(x => String(x.gid) === String(gid));
    if (tab) openTab(state.spreadsheet, tab, { ...state.query, g: tab.gid, t: tab.title });
}

async function openTab(spreadsheet, tab, query, note = '') {
    showLoading(t('loadingTab', { tab: tab.title }));
    let data;
    try {
        data = await loadTab(spreadsheet.id, tab);
    } catch (error) {
        handleLoadError(error, query, () => openTab(spreadsheet, tab, query, note));
        return;
    }
    state.spreadsheet = spreadsheet;
    state.tab = tab;
    state.table = addColumnGroups(buildTable(data.header, data.raw, data.text, t('columnWord')), settings.columnGroups);
    state.query = { ...query, s: spreadsheet.id, g: tab.gid, t: tab.title };
    state.view = { shown: 0, expanded: new Set() };
    rememberRecent(spreadsheet, tab);
    renderTopbar();
    showScreen('mainScreen');
    renderAll();
    if (note) toast(note, 'warn');
    matchSavedLink();
}

// Signed in and not on a short link: if this query is already saved (e.g. opened from its long link), show it as
// that short link, so saving again doesn't make a duplicate. Silent: never asks to sign in.
async function matchSavedLink() {
    if (state.short || !isConfigured() || !hasValidToken()) return;
    try {
        const match = await findSavedLink(state.query);
        if (match && !state.short) {
            state.short = { id: match.link.id, name: match.name, key: match.key };
            syncUrl();
        }
    } catch {
        // no links sheet yet, or offline: nothing to show
    }
}

function handleLoadError(error, query, retry) {
    const code = error instanceof LoadError ? error.code : 'other';
    const other = { label: t('openAnother'), run: showStart };
    const again = { label: t('tryAgain'), run: retry, primary: true };
    switch (code) {
        case 'needsSignIn':
            if (!isConfigured()) {
                showMessage(t('err_notPublic'), t('err_notPublicNoGoogle'), [other]);
                return;
            }
            showMessage(t('err_signInTitle'), [t('err_signInText'), t('err_signInPrivacy')], [
                {
                    label: hasSignedInBefore() ? t('continueGoogle') : t('signInGoogle'),
                    primary: true,
                    run: async () => {
                        try {
                            await signIn();
                            retry();
                        } catch (e) {
                            toast(e.message, 'error');
                        }
                    }
                },
                other
            ], 'info');
            return;
        case 'needsGrant':
            showMessage(t('err_grantTitle'), [t('err_grantText'), t('err_grantMissing')], [
                {
                    label: t('chooseInDrive'),
                    primary: true,
                    run: async () => {
                        const picked = await pickFromDrive(query.s);
                        if (picked?.id === query.s) retry();
                        else if (picked) openQuery({ ...query, s: picked.id, g: null, t: '' });
                    }
                },
                other
            ], 'info');
            return;
        case 'notFound':
            showMessage(t('err_notFoundTitle'), t('err_notFoundText'), [other, again]);
            return;
        case 'tabMissing': {
            const spreadsheet = error.spreadsheet;
            showMessage(t('err_tabTitle'), t('err_tabText', { tab: query.t || String(query.g), sheet: spreadsheet.title }),
                [...spreadsheet.tabs.map(tab => ({ label: tab.title, run: () => openTab(spreadsheet, tab, query) })), other]);
            return;
        }
        case 'offline':
            showMessage(t('err_offlineTitle'), t('err_offlineText'), [again, other]);
            return;
        default:
            showMessage(t('err_otherTitle'), error.message || String(error), [again, other]);
    }
}

function rememberRecent(spreadsheet, tab) {
    const list = storage.get(storageKey('recent'), []).filter(r => r.id !== spreadsheet.id);
    list.unshift({ id: spreadsheet.id, title: spreadsheet.title, gid: tab.gid, tab: tab.title });
    storage.set(storageKey('recent'), list.slice(0, 8));
}

async function reload() {
    if (!state.spreadsheet) return;
    const keepShort = state.short;
    await openQuery(state.query, { short: keepShort, keepPanel: true });
}

// ---------- rendering ----------

function renderTopbar() {
    const s = state.spreadsheet;
    const link = $('#sheetLink');
    link.textContent = s.title;
    link.href = `${s.url.replace(/#.*$/, '')}#gid=${state.tab.gid}`;
    const select = $('#tabSelect');
    select.replaceChildren(...s.tabs.map(tab => option(String(tab.gid), tab.title, tab.gid === state.tab.gid)));
}

function renderAll() {
    const ctx = state.builderCtx || {};
    Object.assign(ctx, { query: state.query, table: state.table, onChange: onQueryChange, tabs: state.spreadsheet.tabs, tab: state.tab, onTab: switchTab, onNew: newQuery });
    state.builderCtx = ctx;
    state.result = runQuery(state.query, state.table);
    ctx.visible = state.result.visible;
    renderBuilder($('#builder'), ctx);
    updateBuilder($('#builder'), ctx, state.result);
    renderResultList();
    syncUrl();
}

function renderResultList() {
    renderResults($('#results'), state.table, state.query, state.result, {
        onSortBy: column => {
            const first = state.query.o[0];
            const d = first && first.c === column && first.d !== 'desc' ? 'desc' : 'asc';
            state.query.o = [{ c: column, d, by: first?.c === column ? first.by : 'min' }, ...state.query.o.filter(o => o.c !== column)];
            renderAll();
        },
        onRemoveFilter: index => {
            state.query.q.items.splice(index, 1);
            renderAll();
        }
    }, state.view);
}

function onQueryChange(structural) {
    if (structural) {
        renderAll();
        return;
    }
    state.result = runQuery(state.query, state.table);
    state.builderCtx.visible = state.result.visible;
    updateBuilder($('#builder'), state.builderCtx, state.result);
    renderResultList();
    syncUrl();
}

// ---------- the link ----------

const syncUrl = debounce(async () => {
    if (!state.query) return;
    state.code = await encodeQuery(state.query);
    state.key = queryKey(state.query);
    const short = state.short && state.short.key === state.key;
    const search = short ? `?l=${state.short.id}` : `?q=${state.code}`;
    history.replaceState(null, '', `${location.pathname}${search}`);
    document.title = state.query.n ? `${state.query.n} – ${settings.name}` : settings.name;
    renderShareBar();
}, 120);

function fullLink() {
    return `${location.origin}${location.pathname}?q=${state.code}`;
}

function shortLink(id) {
    return `${location.origin}${location.pathname}?l=${id}`;
}

async function copy(text, message) {
    try {
        await navigator.clipboard.writeText(text);
        toast(message);
    } catch {
        prompt(t('copyManually'), text);
    }
}

function renderShareBar() {
    const bar = $('#shareBar');
    const short = state.short;
    const modified = short && short.key !== state.key;
    // The name is part of the query (edited at the top of the filter panel), so a rename also counts as a change.
    const save = async (asNew) => {
        try {
            if (!hasValidToken()) await signIn();
            const label = state.query.n || '';
            if (short && !asNew) {
                await updateLink(short.id, state.code, label);
                state.short = { ...short, name: label, key: state.key };
                toast(t('linkUpdated', { id: short.id }));
            } else {
                // The same filter saved before (names aside) gets its existing link, not a duplicate.
                const match = await findSavedLink(state.query);
                if (match) {
                    state.short = { id: match.link.id, name: match.name, key: match.key };
                    await copy(shortLink(match.link.id), t('alreadySaved', { id: match.link.id }));
                } else {
                    const id = await createLink(state.code, label);
                    state.short = { id, name: label, key: state.key };
                    await copy(shortLink(id), t('shortCopied', { id }));
                }
            }
            syncUrl();
        } catch (error) {
            toast(`${t('linkSaveFailed')}: ${error.message}`, 'error');
        }
    };
    const updateButton = short ? el('button', { class: 'btn', disabled: !modified, onclick: () => save(false), title: t('updateLinkHint') }, `💾 ${t('updateLink', { id: short.id })}`) : null;
    bar.replaceChildren(
        el('div', { class: 'share-row' },
            el('button', { class: 'btn primary', onclick: () => copy(fullLink(), t('linkCopied')), title: t('copyLinkHint') }, `🔗 ${t('copyLink')}`),
            el('span', { class: 'muted small link-len' }, t('linkLength', { n: fullLink().length })),
            el('span', { class: 'spacer' }),
            isConfigured() && short
                ? [
                    updateButton,
                    el('button', { class: 'btn ghost', onclick: () => copy(shortLink(short.id), t('shortCopied', { id: short.id })) }, `?l=${short.id}`),
                    el('button', { class: 'btn ghost', onclick: () => save(true) }, t('saveAsNew'))
                ]
                : isConfigured() ? el('button', { class: 'btn', onclick: () => save(true), title: t('shortLinkHint') }, `✂ ${t('shortLink')}`) : null),
        ...(modified ? [el('div', { class: 'muted small' }, t('linkModified', { id: short.id }))] : []));
}

// ---------- saved filters menu ----------

async function openSavedMenu() {
    const menu = $('#savedMenu');
    if (!menu.classList.contains('hidden')) {
        menu.classList.add('hidden');
        return;
    }
    menu.classList.remove('hidden');
    if (!hasValidToken()) {
        menu.replaceChildren(el('button', {
            class: 'menu-item',
            onclick: async () => {
                try {
                    await signIn();
                    menu.classList.add('hidden');
                    openSavedMenu();
                } catch (error) {
                    toast(error.message, 'error');
                }
            }
        }, t('savedSignIn')));
        return;
    }
    menu.replaceChildren(el('div', { class: 'menu-note' }, t('loading')));
    try {
        const links = await listLinks();
        const sheetUrl = linksSheetUrl();
        menu.replaceChildren(
            ...(links.length
                ? [...links].reverse().map(l => el('a', { class: 'menu-item', href: `?l=${l.id}` },
                    el('span', {}, l.name || t('unnamed')),
                    el('span', { class: 'muted small' }, ` ?l=${l.id} · ${l.updated}`)))
                : [el('div', { class: 'menu-note' }, t('noSaved'))]),
            ...(sheetUrl ? [el('a', { class: 'menu-item muted', href: sheetUrl, target: '_blank', rel: 'noopener' }, t('openLinksSheet'))] : []));
    } catch (error) {
        menu.replaceChildren(el('div', { class: 'menu-note error' }, error.message));
    }
}

// ---------- boot ----------

async function openShort(id) {
    if (!isConfigured()) {
        showMessage(t('err_shortTitle'), t('err_notPublicNoGoogle'), [{ label: t('openAnother'), run: showStart }]);
        return;
    }
    const resolve = async () => {
        showLoading(t('loadingShort', { id }));
        try {
            const link = await resolveLink(id);
            if (!link) {
                showMessage(t('err_shortMissingTitle'), t('err_shortMissingText', { id }), [{ label: t('openAnother'), run: showStart }]);
                return;
            }
            const query = await decodeQuery(link.query);
            query.n = query.n || link.name; // links saved before names were part of the query
            await openQuery(query, { short: { id, name: query.n, key: queryKey(query) } });
        } catch (error) {
            showMessage(t('err_otherTitle'), error.message, [{ label: t('tryAgain'), run: resolve, primary: true }, { label: t('openAnother'), run: showStart }]);
        }
    };
    if (hasValidToken()) {
        await resolve();
        return;
    }
    // Signing in opens a popup, which browsers only allow after a click.
    showMessage(t('err_shortSignInTitle'), [t('err_shortSignInText', { id }), t('err_signInPrivacy')], [{
        label: hasSignedInBefore() ? t('continueGoogle') : t('signInGoogle'),
        primary: true,
        run: async () => {
            try {
                await signIn();
                await resolve();
            } catch (error) {
                toast(error.message, 'error');
            }
        }
    }, { label: t('openAnother'), run: showStart }], 'info');
}

function bindTopbar() {
    $('#accountButton').addEventListener('click', onAccountClick);
    $('#reloadButton').addEventListener('click', reload);
    $('#changeSheetButton').addEventListener('click', showStart);
    $('#savedButton').addEventListener('click', openSavedMenu);
    document.addEventListener('click', e => {
        if (!e.target.closest('.menu-wrap')) $('#savedMenu').classList.add('hidden');
    });
    $('#tabSelect').addEventListener('change', e => switchTab(e.target.value));
    window.addEventListener('popstate', () => location.reload());
    const lang = $('#languageSelect');
    lang.replaceChildren(...languages().map(l => option(l.code, l.label, l.code === getLanguage())));
    lang.addEventListener('change', () => {
        setLanguage(lang.value);
        renderAccount();
        if (document.body.dataset.screen === 'mainScreen') renderAll();
        else if (document.body.dataset.screen === 'startScreen') showStart();
    });
}

export async function boot() {
    document.documentElement.lang = getLanguage();
    applyTranslations(document);
    bindTopbar();
    renderAccount();

    const params = new URLSearchParams(location.search);
    const short = params.get('l');
    const code = params.get('q');
    const sheet = spreadsheetIdFromUrl(params.get('s') || '');
    if (short && isShortId(short)) {
        await openShort(short);
    } else if (code) {
        try {
            await openQuery(await decodeQuery(code));
        } catch (error) {
            showMessage(t('err_badLinkTitle'), [t('err_badLinkText'), error.message], [{ label: t('openAnother'), run: showStart, primary: true }]);
        }
    } else if (sheet) {
        const gid = Number(params.get('gid'));
        await openQuery(emptyQuery(sheet, Number.isFinite(gid) && params.has('gid') ? gid : null, ''));
    } else {
        showStart();
    }
}

