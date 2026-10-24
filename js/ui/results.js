// The live result list: count, notes about the query, the table (cards on phones), and a clear empty state that
// tells which filter removes what.

import { t } from '../i18n.js';
import { cellIsLink, findColumn } from '../query.js';
import { describeNode, issueText } from './builder.js';
import { el } from './dom.js';

const PAGE = 200;

// handlers: { onSortBy(column), onRemoveFilter(index) }; state: { shown, expanded: Set } kept between renders.
export function renderResults(root, table, query, result, handlers, state) {
    const total = table.text.length;
    const n = result.rows.length;
    const skipped = [...result.issues.values()].flat().filter(i => i.level === 'skip').length;
    const head = el('div', { class: 'results-head' },
        el('div', { class: 'count' }, el('strong', {}, n), ` ${t('ofRows', { total })}`),
        skipped ? el('div', { class: 'issue skip' }, `⛔ ${t('skippedFilters', { n: skipped })}`) : null,
        ...result.notes.map(note => el('div', { class: `issue ${note.level}` }, note.level === 'skip' ? '⛔ ' : '⚠ ', issueText(note))));

    if (!n) {
        root.replaceChildren(head, emptyState(query, result, handlers, total));
        return;
    }

    const cols = result.visible;
    const sortKey = query.o[0] ? findColumn(table.headers, query.o[0].c).index : -1;
    const thead = el('thead', {}, el('tr', {}, cols.map(c => el('th', {
        class: c === sortKey ? `sorted ${query.o[0].d === 'desc' ? 'desc' : 'asc'}` : '',
        title: table.virtual?.has(c) ? `${t('virtualNote', { columns: table.virtual.get(c).labels.join(', ') })}\n${t('sortByColumn')}` : t('sortByColumn'),
        onclick: () => handlers.onSortBy(table.headers[c])
    }, table.virtual?.has(c) ? `⧉ ${table.headers[c]}` : table.headers[c]))));
    const tbody = el('tbody');
    const shown = Math.min(n, Math.max(PAGE, state.shown || 0));
    for (const r of result.rows.slice(0, shown)) {
        const tr = el('tr', { class: 'row', dataset: { row: r }, title: t('rowHint') },
            cols.map(c => el('td', { dataset: { label: table.headers[c] } }, table.virtual?.has(c) ? groupCell(table.virtual.get(c), r) : cell(table.text[r][c]))));
        tr.addEventListener('click', e => {
            if (e.target.closest('a')) return;
            if (state.expanded.has(r)) state.expanded.delete(r);
            else state.expanded.add(r);
            const next = tr.nextElementSibling;
            if (next?.classList.contains('details')) next.remove();
            else tr.after(detailsRow(table, r, cols.length));
            tr.classList.toggle('open', state.expanded.has(r));
        });
        tbody.append(tr);
        if (state.expanded.has(r)) {
            tr.classList.add('open');
            tbody.append(detailsRow(table, r, cols.length));
        }
    }
    const more = shown < n
        ? el('button', {
            class: 'btn ghost more',
            onclick: () => {
                state.shown = n;
                renderResults(root, table, query, result, handlers, state);
            }
        }, t('showAll', { n }))
        : null;
    root.replaceChildren(...[head, el('div', { class: 'table-wrap' }, el('table', { class: 'results' }, thead, tbody)), more].filter(Boolean));
}

function cell(text) {
    if (cellIsLink(text)) {
        let label = text;
        try {
            label = new URL(text).hostname.replace(/^www\./, '');
        } catch {
            // keep the text
        }
        return el('a', { href: text, target: '_blank', rel: 'noopener' }, label);
    }
    return text;
}

// A column group's cell: one mark per member (set ones filled), then the summary ('Apr–May').
function groupCell(virtual, r) {
    const row = virtual.rows[r];
    if (!row.count) return '';
    return el('span', { class: 'group-cell', title: row.summary },
        el('span', { class: 'strip', 'aria-hidden': 'true' }, virtual.labels.map((label, i) => el('span', { class: row.on[i] ? 'on' : '', title: label }))),
        el('span', {}, row.summary));
}

// Every non-empty field of a row, below it.
function detailsRow(table, r, span) {
    const fields = table.headers
        .map((h, c) => (table.virtual?.has(c) ? [`⧉ ${h}`, table.virtual.get(c).rows[r].summary] : [h, table.text[r][c]]))
        .filter(([, v]) => v !== '');
    return el('tr', { class: 'details' }, el('td', { colspan: span },
        el('dl', {}, fields.map(([h, v]) => [el('dt', {}, h), el('dd', {}, cell(v))])),
        el('div', { class: 'muted small' }, t('sheetRow', { n: table.rowNumbers[r] }))));
}

function emptyState(query, result, handlers, total) {
    const items = query.q.items.map((node, i) => {
        const count = result.counts.get(String(i));
        return el('li', {},
            el('span', { class: 'what' }, describeNode(node)),
            count ? el('span', { class: 'muted' }, ` — ${t('alone', { n: count.alone })}; ${t('without', { n: count.without })}`) : null,
            count && count.without > 0
                ? el('button', { class: 'link-btn', onclick: () => handlers.onRemoveFilter(i) }, t('removeFilter'))
                : null);
    });
    return el('div', { class: 'empty' },
        el('div', { class: 'empty-icon' }, '🌱'),
        el('h2', {}, total ? t('noResults') : t('emptySheet')),
        total && items.length ? el('p', {}, t('noResultsHelp')) : null,
        items.length ? el('ul', { class: 'empty-list' }, items) : null);
}
