// The start screen: paste a spreadsheet link, pick one in Google Drive, or reopen a recent one.

import { t } from '../i18n.js';
import { spreadsheetIdFromUrl } from '../picker.js';
import { el } from './dom.js';

// A gid in a pasted link (…/edit#gid=123 or ?gid=123) selects that tab.
function gidFromUrl(text) {
    const m = /[#&?]gid=(\d+)/.exec(String(text));
    return m ? Number(m[1]) : null;
}

// options: { recent, configured, onOpen(id, gid), onPick() → { id } | null, onForget(id) }
export function renderStart(root, options) {
    const input = el('input', { type: 'text', class: 'sheet-input', placeholder: t('pastePlaceholder'), autocomplete: 'off', spellcheck: false });
    const error = el('div', { class: 'issue skip hidden' });
    const open = () => {
        const id = spreadsheetIdFromUrl(input.value);
        if (!id) {
            error.textContent = t('notASheetLink');
            error.classList.remove('hidden');
            return;
        }
        options.onOpen(id, gidFromUrl(input.value));
    };
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') open();
    });

    const pick = options.configured
        ? el('button', {
            class: 'btn',
            onclick: async () => {
                const picked = await options.onPick();
                if (picked) options.onOpen(picked.id, null);
            }
        }, `📂 ${t('pickFromDrive')}`)
        : null;

    const recent = options.recent.length
        ? el('div', { class: 'section' },
            el('h3', {}, t('recentTitle')),
            el('ul', { class: 'recent' }, options.recent.map(r => el('li', {},
                el('button', { class: 'link-btn', onclick: () => options.onOpen(r.id, r.gid) }, r.title || r.id),
                el('span', { class: 'muted small' }, ` · ${r.tab || ''}`),
                el('button', { class: 'icon small', title: t('forget'), onclick: () => options.onForget(r.id) }, '✕')))))
        : null;

    root.replaceChildren(el('div', { class: 'start card' },
        el('h1', {}, t('startTitle')),
        el('p', { class: 'muted' }, t('startIntro')),
        el('div', { class: 'inline wide' }, input, el('button', { class: 'btn primary', onclick: open }, t('open'))),
        error,
        el('div', { class: 'inline' }, pick, options.configured ? el('span', { class: 'muted small' }, t('pickHint')) : null),
        recent,
        options.configured ? null : el('p', { class: 'issue warn' }, t('notConfigured'))));
    setTimeout(() => input.focus(), 0);
}
