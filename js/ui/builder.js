// The filter builder: one card per filter or group, plus sort keys and the visible-columns chooser.
// ctx: { query, table, onChange(structural) } — structural changes re-render the builder, value edits only rerun
// the query (so typing keeps focus).

import { t } from '../i18n.js';
import { countValues, filterKindsFor, fold, parseNumber } from '../profile.js';
import { findColumn, isGroup, newFilter, nodeAt, parentOf, walk } from '../query.js';
import { el, option } from './dom.js';
import { debounce } from '../util.js';

const KIND_ICON = { flag: '◐', range: '↔', enum: '☰', list: '⋯', text: 'T' };
const CHECKLIST_SEARCH_FROM = 10;

// The panel: a header that always shows (open / close, the query's name, a one-line summary when closed) and the
// body with the tab, filters, sort and columns.
export function renderBuilder(root, ctx) {
    root.classList.toggle('collapsed', Boolean(ctx.collapsed));
    root.replaceChildren(renderHead(root, ctx), el('div', { class: 'builder-body' }, renderBody(ctx)));
    if (ctx.scrollTo) {
        const card = root.querySelector(`.card[data-path="${ctx.scrollTo}"]`);
        ctx.scrollTo = null;
        if (card) {
            card.scrollIntoView({ block: 'nearest' });
            card.classList.add('moved');
            setTimeout(() => card.classList.remove('moved'), 600);
        }
    }
}

function setCollapsed(root, ctx, collapsed) {
    ctx.collapsed = collapsed;
    root.classList.toggle('collapsed', collapsed);
    const toggle = root.querySelector('.builder-toggle');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.title = collapsed ? t('expandFilters') : t('collapseFilters');
}

function renderHead(root, ctx) {
    const toggle = el('button', { class: 'builder-toggle', 'aria-expanded': String(!ctx.collapsed), title: ctx.collapsed ? t('expandFilters') : t('collapseFilters') },
        el('span', { class: 'chevron' }, '▾'));
    toggle.addEventListener('click', () => setCollapsed(root, ctx, !ctx.collapsed));
    const nameChanged = debounce(() => ctx.onChange(false), 300);
    const name = el('input', { type: 'text', class: 'query-name', value: ctx.query.n || '', placeholder: t('namePlaceholder'), maxlength: 120, 'aria-label': t('nameLabel') });
    name.addEventListener('input', () => {
        ctx.query.n = name.value.trim();
        nameChanged();
    });
    const summary = el('div', { class: 'builder-summary' });
    summary.addEventListener('click', e => {
        const chip = e.target.closest('[data-goto]');
        setCollapsed(root, ctx, false);
        if (chip) root.querySelector(`.card[data-path="${chip.dataset.goto}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    const fresh = el('button', { class: 'btn small ghost', title: t('newQueryHint'), onclick: () => ctx.onNew() }, `＋ ${t('newQuery')}`);
    return el('div', { class: 'builder-head' }, el('div', { class: 'builder-title' }, toggle, name, fresh), summary);
}

function renderBody(ctx) {
    const { query } = ctx;
    return [
        tabLine(ctx),
        el('div', { class: 'match-line' },
            el('span', {}, t('matchPrefix')),
            opSelect(query.q, ctx),
            el('span', {}, t('matchSuffix'))),
        el('div', { class: 'filter-list' }, query.q.items.map((node, i) => renderNode(node, String(i), ctx))),
        el('div', { class: 'add-row' },
            el('button', { class: 'btn primary', onclick: () => addFilter(query.q, ctx) }, `+ ${t('addFilter')}`),
            el('button', { class: 'btn ghost', onclick: () => addGroup(ctx), title: t('addGroupHint') }, `+ ${t('addGroup')}`)),
        renderSort(ctx),
        renderColumns(ctx)
    ];
}

// Which tab of the spreadsheet is the data (switching keeps the filters; ones that don't fit get warnings).
function tabLine(ctx) {
    const select = el('select', { class: 'tab-select', 'aria-label': t('dataTab') },
        (ctx.tabs || []).map(tab => option(String(tab.gid), tab.title, tab.gid === ctx.tab?.gid)));
    select.addEventListener('change', () => ctx.onTab(select.value));
    return el('div', { class: 'tab-line' },
        el('label', {}, t('dataTab'), select),
        el('span', { class: 'muted small' }, t('dataTabRows', { n: ctx.table.text.length, cols: ctx.table.headers.length })));
}

function opSelect(group, ctx, nested = false) {
    const select = el('select', { class: 'op-select', 'aria-label': t('matchOp') },
        option('and', nested ? t('groupAll') : t('opAll'), group.op !== 'or'),
        option('or', nested ? t('groupAny') : t('opAny'), group.op === 'or'));
    select.addEventListener('change', () => {
        group.op = select.value;
        ctx.onChange(true);
    });
    return select;
}

function columnLabel(ctx, index) {
    const p = ctx.table.profiles[index];
    return `${ctx.table.headers[index]}  ${KIND_ICON[p.kind] || ''}`;
}

function defaultColumn(ctx) {
    const used = new Set();
    walk(ctx.query.q, node => {
        if (!isGroup(node)) used.add(node.c);
    });
    // Prefer columns with a ready-made filter (a list of values, a range, a flag) that aren't in use yet.
    const free = ctx.table.headers.findIndex((h, i) => !used.has(h) && ctx.table.profiles[i].kind !== 'text');
    return ctx.table.headers[free >= 0 ? free : 0];
}

function filterFor(ctx, column) {
    const col = findColumn(ctx.table.headers, column);
    const kind = col.index >= 0 ? filterKindsFor(ctx.table.profiles[col.index])[0] : 'text';
    return { ...newFilter(col.index >= 0 ? col.header : column, kind), not: false };
}

function addFilter(group, ctx) {
    group.items.push(filterFor(ctx, defaultColumn(ctx)));
    ctx.focusLast = true;
    ctx.onChange(true);
}

function addGroup(ctx) {
    const op = ctx.query.q.op === 'or' ? 'and' : 'or';
    ctx.query.q.items.push({ op, items: [filterFor(ctx, defaultColumn(ctx))] });
    ctx.onChange(true);
}

// Moves a filter or group one place up (-1) or down (+1) among its siblings. The result doesn't change, but the
// values offered and the running counts follow the order.
function moveNode(ctx, path, delta) {
    const { parent, index } = parentOf(ctx.query, path);
    const to = index + delta;
    if (to < 0 || to >= parent.items.length) return;
    [parent.items[index], parent.items[to]] = [parent.items[to], parent.items[index]];
    ctx.scrollTo = [...path.split('.').slice(0, -1), String(to)].join('.');
    ctx.onChange(true);
}

function moveButtons(ctx, path, count) {
    const index = Number(path.split('.').pop());
    return el('span', { class: 'move' },
        el('button', { class: 'icon', title: t('moveUp'), 'aria-label': t('moveUp'), disabled: index === 0, onclick: () => moveNode(ctx, path, -1) }, '↑'),
        el('button', { class: 'icon', title: t('moveDown'), 'aria-label': t('moveDown'), disabled: index === count - 1, onclick: () => moveNode(ctx, path, 1) }, '↓'));
}

function siblingCount(ctx, path) {
    return parentOf(ctx.query, path).parent.items.length;
}

function removeNode(ctx, path) {
    const { parent, index } = parentOf(ctx.query, path);
    parent.items.splice(index, 1);
    // A group left empty goes too.
    if (!parent.items.length && parent !== ctx.query.q) {
        const up = parentOf(ctx.query, path.split('.').slice(0, -1).join('.'));
        up.parent.items.splice(up.index, 1);
    }
    ctx.onChange(true);
}

function excludeToggle(node, ctx) {
    const input = el('input', { type: 'checkbox', checked: Boolean(node.not) });
    input.addEventListener('change', () => {
        node.not = input.checked;
        input.closest('.card')?.classList.toggle('excluded', node.not);
        ctx.onChange(false);
    });
    return el('label', { class: 'exclude', title: t('excludeHint') }, input, t('exclude'));
}

function renderNode(node, path, ctx) {
    return isGroup(node) ? renderGroup(node, path, ctx) : renderFilter(node, path, ctx);
}

function renderGroup(group, path, ctx) {
    return el('div', { class: `card group${group.not ? ' excluded' : ''}`, dataset: { path } },
        el('div', { class: 'card-head' },
            el('span', { class: 'group-label' }, t('groupPrefix')),
            opSelect(group, ctx, true),
            el('span', { class: 'spacer' }),
            excludeToggle(group, ctx),
            el('span', { class: 'badge', title: t('badgeHint') }),
            el('span', { class: 'chain' }),
            moveButtons(ctx, path, siblingCount(ctx, path)),
            el('button', { class: 'icon', title: t('remove'), onclick: () => removeNode(ctx, path) }, '✕')),
        el('div', { class: 'filter-list' }, group.items.map((child, i) => renderFilter(child, `${path}.${i}`, ctx))),
        el('div', { class: 'add-row' }, el('button', { class: 'btn small ghost', onclick: () => addFilter(group, ctx) }, `+ ${t('addFilterToGroup')}`)),
        el('div', { class: 'issues' }));
}

function renderFilter(filter, path, ctx) {
    const { table } = ctx;
    const col = findColumn(table.headers, filter.c);
    const colSelect = el('select', { class: 'col-select', 'aria-label': t('column') },
        col.index < 0 ? option(filter.c, `⚠ ${filter.c} (${t('missing')})`, true) : null,
        table.headers.map((h, i) => option(h, columnLabel(ctx, i), i === col.index)));
    colSelect.addEventListener('change', () => {
        const fresh = filterFor(ctx, colSelect.value);
        replaceNode(ctx, path, { ...fresh, not: filter.not });
    });

    const kinds = col.index >= 0 ? filterKindsFor(table.profiles[col.index]) : [filter.k];
    if (!kinds.includes(filter.k)) kinds.push(filter.k);
    const kindSelect = el('select', { class: 'kind-select', 'aria-label': t('filterType') },
        kinds.map(k => option(k, t(`kind_${k}`), k === filter.k)));
    kindSelect.addEventListener('change', () => {
        replaceNode(ctx, path, { ...newFilter(filter.c, kindSelect.value), not: filter.not });
    });

    const card = el('div', { class: `card filter${filter.not ? ' excluded' : ''}`, dataset: { path } },
        el('div', { class: 'card-head' },
            colSelect,
            kindSelect,
            el('span', { class: 'spacer' }),
            excludeToggle(filter, ctx),
            el('span', { class: 'badge', title: t('badgeHint') }),
            el('span', { class: 'chain' }),
            moveButtons(ctx, path, siblingCount(ctx, path)),
            el('button', { class: 'icon', title: t('remove'), onclick: () => removeNode(ctx, path) }, '✕')),
        el('div', { class: 'card-body' }, col.index >= 0 ? renderEditor(filter, table.profiles[col.index], ctx, { path, column: col.index }) : null),
        el('div', { class: 'issues' }));
    if (ctx.focusLast) queueMicrotask(() => {
        if (!ctx.focusLast) return;
        ctx.focusLast = false;
        const last = [...document.querySelectorAll('.col-select')].pop();
        last?.focus();
    });
    return card;
}

function replaceNode(ctx, path, node) {
    const { parent, index } = parentOf(ctx.query, path);
    parent.items[index] = node;
    ctx.onChange(true);
}

// ---------- editors ----------

function renderEditor(filter, profile, ctx, where) {
    switch (filter.k) {
        case 'in': return inEditor(filter, profile, ctx, where);
        case 'has': return hasEditor(filter, profile, ctx, where);
        case 'range': return rangeEditor(filter, profile, ctx);
        case 'flag': return flagEditor(filter, ctx);
        default: return textEditor(filter, ctx);
    }
}

function inEditor(filter, profile, ctx, where) {
    const parts = profile.parts
        ? (() => {
            const input = el('input', { type: 'checkbox', checked: Boolean(filter.parts) });
            input.addEventListener('change', () => {
                filter.parts = input.checked;
                ctx.onChange(true);
            });
            return el('label', { class: 'check hint-check', title: t('partsHint') }, input, t('parts'));
        })()
        : null;
    const byParts = Boolean(filter.parts && profile.parts);
    return el('div', {}, parts, checklist(filter, byParts ? profile.parts : profile.values, ctx, { ...where, mode: byParts ? 'parts' : 'values' }));
}

function hasEditor(filter, profile, ctx, where) {
    const mode = el('select', { class: 'small-select' },
        option('any', t('hasAny'), !filter.all),
        option('all', t('hasAll'), Boolean(filter.all)));
    mode.addEventListener('change', () => {
        filter.all = mode.value === 'all';
        ctx.onChange(false);
    });
    return el('div', {}, el('div', { class: 'inline' }, el('span', {}, t('hasPrefix')), mode), checklist(filter, profile.tokens || profile.values, ctx, { ...where, mode: profile.tokens ? 'tokens' : 'values' }));
}

// Checkboxes for the values of a column, with counts. Chosen values first, values gone from the sheet flagged.
// refresh(result) (called after every run) offers only the values of the rows reaching this filter, unless that
// is switched off for this filter (filter.wide); it rebuilds the boxes only when those counts change, so clicking a box doesn't reorder them.
// where: { path, column, mode } — mode as in countValues.
function checklist(filter, pool, ctx, where) {
    const box = el('div', { class: 'checklist' });
    const summary = el('span', { class: 'muted small' });
    const updateSummary = () => {
        summary.textContent = filter.v.length ? t('chosenCount', { n: filter.v.length }) : t('noneChosen');
    };
    // Per filter, saved in the link: filter.wide offers every value of the column instead.
    const narrowInput = el('input', { type: 'checkbox', checked: !filter.wide });
    narrowInput.addEventListener('change', () => {
        filter.wide = !narrowInput.checked;
        ctx.onChange(false);
    });
    const narrowNote = el('span', { class: 'muted small' });
    const narrowLine = el('div', { class: 'inline narrow-line hidden' },
        el('label', { class: 'check narrow-check', title: t('narrowHint') }, narrowInput, t('narrowValues')), narrowNote);
    const search = el('input', { type: 'search', class: 'checklist-search hidden', placeholder: t('searchValues') });
    const applySearch = () => {
        const q = fold(search.value);
        for (const label of box.querySelectorAll('label')) label.classList.toggle('hidden', Boolean(q) && !fold(label.textContent).includes(q));
    };
    search.addEventListener('input', applySearch);

    // counts: Map of folded value → rows among those reaching the filter, or null for the whole column.
    const render = counts => {
        const chosen = new Set(filter.v.map(fold));
        const known = new Set(pool.map(v => fold(v.value)));
        const countOf = v => (counts ? counts.get(fold(v.value)) || 0 : v.count);
        const rest = pool.filter(v => !chosen.has(fold(v.value)) && countOf(v) > 0);
        if (counts) rest.sort((a, b) => countOf(b) - countOf(a));
        const items = [
            ...filter.v.filter(v => !known.has(fold(v))).map(v => ({ value: v, count: 0, gone: true })),
            ...pool.filter(v => chosen.has(fold(v.value))).map(v => ({ value: v.value, count: countOf(v) })),
            ...rest.map(v => ({ value: v.value, count: countOf(v) }))
        ];
        box.replaceChildren(...items.map(item => {
            const input = el('input', { type: 'checkbox', checked: chosen.has(fold(item.value)) });
            input.addEventListener('change', () => {
                const key = fold(item.value);
                filter.v = filter.v.filter(v => fold(v) !== key);
                if (input.checked) filter.v.push(item.value);
                updateSummary();
                ctx.onChange(false);
            });
            const none = !item.gone && !item.count;
            const hint = item.gone ? t('valueGone') : none ? t('valueFilteredOut') : '';
            return el('label', { class: `check${item.gone ? ' gone' : ''}${none ? ' none' : ''}`, title: hint },
                input,
                el('span', { class: 'value' }, item.value),
                el('span', { class: 'count' }, item.gone ? '⚠' : item.count));
        }));
        if (!items.length) box.append(el('span', { class: 'muted small' }, t('noValuesHere')));
        search.classList.toggle('hidden', items.length < CHECKLIST_SEARCH_FROM && !search.value);
        applySearch();
    };

    let signature = null;
    const wrap = el('div', { class: 'checklist-wrap' },
        narrowLine,
        el('div', { class: 'inline' }, search, summary, el('button', {
            class: 'link-btn small',
            onclick: () => {
                filter.v = [];
                ctx.onChange(true);
            }
        }, t('clear'))),
        box);
    wrap.refresh = result => {
        const rows = result.contexts.get(where.path);
        const total = ctx.table.text.length;
        const narrowed = Boolean(rows) && rows.length < total;
        narrowLine.classList.toggle('hidden', !narrowed);
        narrowNote.textContent = narrowed ? t('narrowNote', { n: rows.length, total }) : '';
        const counts = narrowed && !filter.wide ? countValues(ctx.table.text, rows, where.column, where.mode) : null;
        const next = counts ? JSON.stringify([...counts]) : 'all';
        if (next === signature) return;
        signature = next;
        render(counts);
    };
    render(null);
    updateSummary();
    return wrap;
}

function numberInput(value, placeholder, onValue) {
    const input = el('input', { type: 'text', inputmode: 'decimal', class: 'num', placeholder, value: value ?? '' });
    input.addEventListener('input', () => {
        const s = input.value.trim();
        const n = s === '' ? null : parseNumber(s);
        input.classList.toggle('invalid', s !== '' && n === null);
        if (s === '' || n !== null) onValue(n);
    });
    return input;
}

function fmtNumber(n) {
    return n === null || n === undefined ? '' : String(Math.round(n * 1000) / 1000).replace('.', ',');
}

function rangeEditor(filter, profile, ctx) {
    const changed = debounce(() => ctx.onChange(false), 200);
    const how = el('select', { class: 'small-select', title: t('rangeHowHint') },
        option('overlap', t('rangeOverlap'), filter.how !== 'within'),
        option('within', t('rangeWithin'), filter.how === 'within'));
    how.addEventListener('change', () => {
        filter.how = how.value;
        ctx.onChange(false);
    });
    return el('div', {},
        el('div', { class: 'inline' },
            el('span', {}, t('rangeFrom')),
            numberInput(filter.min, fmtNumber(profile.min), n => {
                filter.min = n;
                changed();
            }),
            el('span', {}, t('rangeTo')),
            numberInput(filter.max, fmtNumber(profile.max), n => {
                filter.max = n;
                changed();
            }),
            how),
        profile.min !== null ? el('div', { class: 'muted small' }, t('rangeSpan', { min: fmtNumber(profile.min), max: fmtNumber(profile.max) })) : null);
}

function flagEditor(filter, ctx) {
    const select = el('select', {},
        option('set', t('flagSet'), filter.set !== false),
        option('empty', t('flagEmpty'), filter.set === false));
    select.addEventListener('change', () => {
        filter.set = select.value === 'set';
        ctx.onChange(false);
    });
    return el('div', { class: 'inline' }, select);
}

function textEditor(filter, ctx) {
    const changed = debounce(() => ctx.onChange(false), 200);
    const mode = el('select', { class: 'small-select' },
        ['contains', 'equals', 'wildcard', 'regex'].map(m => option(m, t(`text_${m}`), (filter.m || 'contains') === m)));
    const input = el('input', { type: 'text', class: 'pattern', value: filter.x || '', placeholder: t(`textPlaceholder_${filter.m || 'contains'}`) });
    const hint = el('div', { class: 'muted small' }, t(`textHint_${filter.m || 'contains'}`));
    mode.addEventListener('change', () => {
        filter.m = mode.value;
        input.placeholder = t(`textPlaceholder_${filter.m}`);
        hint.textContent = t(`textHint_${filter.m}`);
        ctx.onChange(false);
    });
    input.addEventListener('input', () => {
        filter.x = input.value;
        changed();
    });
    const cs = el('input', { type: 'checkbox', checked: Boolean(filter.cs) });
    cs.addEventListener('change', () => {
        filter.cs = cs.checked;
        ctx.onChange(false);
    });
    return el('div', {}, el('div', { class: 'inline' }, mode, input, el('label', { class: 'check' }, cs, t('caseSensitive'))), hint);
}

// ---------- sort and columns ----------

function renderSort(ctx) {
    const { query, table } = ctx;
    const rows = query.o.map((key, i) => {
        const col = findColumn(table.headers, key.c);
        const numeric = col.index >= 0 && table.profiles[col.index].kind === 'range';
        const colSelect = el('select', { class: 'col-select' },
            col.index < 0 ? option(key.c, `⚠ ${key.c} (${t('missing')})`, true) : null,
            table.headers.map((h, j) => option(h, h, j === col.index)));
        colSelect.addEventListener('change', () => {
            key.c = colSelect.value;
            ctx.onChange(true);
        });
        const dir = el('select', { class: 'small-select' },
            option('asc', numeric ? t('sortAscNum') : t('sortAsc'), key.d !== 'desc'),
            option('desc', numeric ? t('sortDescNum') : t('sortDesc'), key.d === 'desc'));
        dir.addEventListener('change', () => {
            key.d = dir.value;
            ctx.onChange(false);
        });
        let by = null;
        if (numeric) {
            by = el('select', { class: 'small-select', title: t('sortByHint') },
                option('min', t('sortByMin'), key.by !== 'max'),
                option('max', t('sortByMax'), key.by === 'max'));
            by.addEventListener('change', () => {
                key.by = by.value;
                ctx.onChange(false);
            });
        }
        const move = delta => {
            const j = i + delta;
            if (j < 0 || j >= query.o.length) return;
            [query.o[i], query.o[j]] = [query.o[j], query.o[i]];
            ctx.onChange(true);
        };
        return el('div', { class: 'sort-row', dataset: { sort: i } },
            el('span', { class: 'muted' }, i === 0 ? t('sortFirst') : t('sortThen')),
            colSelect, dir, by,
            el('button', { class: 'icon', title: t('moveUp'), disabled: i === 0, onclick: () => move(-1) }, '↑'),
            el('button', { class: 'icon', title: t('moveDown'), disabled: i === query.o.length - 1, onclick: () => move(1) }, '↓'),
            el('button', {
                class: 'icon',
                title: t('remove'),
                onclick: () => {
                    query.o.splice(i, 1);
                    ctx.onChange(true);
                }
            }, '✕'));
    });
    const add = el('button', {
        class: 'btn small ghost',
        onclick: () => {
            const used = new Set(query.o.map(o => o.c));
            const c = table.headers.find(h => !used.has(h)) || table.headers[0];
            query.o.push({ c, d: 'asc', by: 'min' });
            ctx.onChange(true);
        }
    }, `+ ${t('addSort')}`);
    return el('div', { class: 'section sort-section' }, el('h3', {}, t('sortTitle')), rows, add);
}

function renderColumns(ctx) {
    const { query, table } = ctx;
    const auto = !query.cols;
    const visible = new Set(ctx.visible || []);
    const autoInput = el('input', { type: 'checkbox', checked: auto });
    autoInput.addEventListener('change', () => {
        query.cols = autoInput.checked ? null : table.headers.filter((_, i) => visible.has(i));
        ctx.onChange(true);
    });
    const boxes = table.headers.map((h, i) => {
        const input = el('input', { type: 'checkbox', checked: visible.has(i), disabled: auto });
        input.addEventListener('change', () => {
            const current = query.cols ? [...query.cols] : table.headers.filter((_, j) => visible.has(j));
            const next = input.checked ? [...current, h] : current.filter(c => c !== h);
            // Keep the sheet's column order.
            query.cols = table.headers.filter(x => next.includes(x));
            ctx.onChange(true);
        });
        return el('label', { class: 'check' }, input, h);
    });
    const details = el('details', { class: 'section columns-section', open: Boolean(ctx.columnsOpen) },
        el('summary', {}, t('columnsTitle', { n: visible.size, total: table.headers.length })),
        el('label', { class: 'check' }, autoInput, t('columnsAuto')),
        el('div', { class: 'columns-grid' }, boxes));
    details.addEventListener('toggle', () => {
        ctx.columnsOpen = details.open;
    });
    return details;
}

// ---------- badges and issues (updated after every run, without re-rendering) ----------

export function issueText(issue) {
    return t(`issue_${issue.code}`, issue.params);
}

export function updateBuilder(root, ctx, result) {
    renderSummary(root, ctx, result);
    for (const list of root.querySelectorAll('.checklist-wrap')) list.refresh?.(result);
    for (const card of root.querySelectorAll('.card[data-path]')) {
        const path = card.dataset.path;
        const badge = card.querySelector(':scope > .card-head > .badge');
        const chain = card.querySelector(':scope > .card-head > .chain');
        const count = result.counts.get(path);
        if (badge) {
            badge.textContent = count ? t('badge', { n: count.alone }) : '';
            badge.classList.toggle('zero', Boolean(count) && count.alone === 0);
        }
        // The running count: this one combined with the ones above it (by the group's and / or).
        const index = Number(path.split('.').pop());
        if (chain) {
            const group = path.includes('.') ? nodeAt(ctx.query, path.split('.').slice(0, -1).join('.')) : ctx.query.q;
            // The first node of a nested group: how many of the rows reaching the group it matches.
            const first = Boolean(count) && index === 0 && count.reach !== undefined;
            const show = Boolean(count) && (index > 0 || first);
            chain.textContent = first ? `→ ${count.upTo}` : show ? chainText(count) : '';
            chain.title = first ? t('chainHintFirst', { before: count.reach, after: count.upTo }) : show ? chainHint(count, group.op) : '';
            chain.classList.toggle('zero', show && count.upTo === 0);
            chain.classList.toggle('idle', show && !first && count.delta === 0);
        }
        const issues = (result.issues.get(path) || []).filter(i => i.level !== 'info');
        const box = card.querySelector(':scope > .issues');
        card.classList.toggle('skipped', issues.some(i => i.level === 'skip'));
        card.classList.toggle('warned', issues.some(i => i.level === 'warn'));
        if (!box) continue;
        box.replaceChildren(...issues.map(issue => el('div', { class: `issue ${issue.level}` },
            issue.level === 'skip' ? '⛔ ' : '⚠ ',
            issueText(issue),
            issue.params.suggestion
                ? el('button', {
                    class: 'link-btn',
                    onclick: () => {
                        const node = nodeAt(ctx.query, path);
                        node.c = issue.params.suggestion;
                        ctx.onChange(true);
                    }
                }, t('useColumn', { column: issue.params.suggestion }))
                : null)));
    }
}

// The running count with what this node changed: '→ 117 (−70)' along 'all of', '→ 562 (+431)' along 'any of'.
function chainText(count) {
    const d = count.delta;
    const change = d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '±0';
    return `→ ${count.upTo} (${change})`;
}

function chainHint(count, op) {
    const params = { before: count.before, after: count.upTo, n: Math.abs(count.delta) };
    if (op === 'or') return t(count.delta ? 'chainHintOr' : 'chainHintOrIdle', params);
    return t(count.delta ? 'chainHintAnd' : 'chainHintAndIdle', params);
}

// The closed panel's one-liner: each top-level filter as a chip with the running count, joined by and / or,
// then the sort. Clicking a chip opens the panel at that filter.
function renderSummary(root, ctx, result) {
    const box = root.querySelector('.builder-summary');
    if (!box) return;
    const { query } = ctx;
    const joiner = query.q.op === 'or' ? t('or') : t('and');
    const parts = [];
    query.q.items.forEach((node, i) => {
        const path = String(i);
        const count = result.counts.get(path);
        const issues = result.issues.get(path) || [];
        const skipped = issues.some(x => x.level === 'skip');
        if (i > 0) parts.push(el('span', { class: 'joiner' }, joiner));
        const text = describeNode(node);
        parts.push(el('button', {
            class: `chip${node.not ? ' excluded' : ''}${skipped ? ' skipped' : ''}`,
            dataset: { goto: path },
            title: text
        }, el('span', { class: 'chip-text' }, text), count ? el('span', { class: `chip-count${i > 0 && count.delta === 0 ? ' idle' : ''}`, title: i > 0 ? chainHint(count, query.q.op) : '' }, i > 0 ? chainText(count) : `→ ${count.upTo}`) : null));
    });
    if (!parts.length) parts.push(el('span', { class: 'muted' }, t('noFiltersYet')));
    if (query.o.length) {
        parts.push(el('span', { class: 'chip sort', title: t('sortTitle') }, `⇅ ${query.o.map(o => `${o.c} ${o.d === 'desc' ? '↓' : '↑'}`).join(', ')}`));
    }
    box.replaceChildren(...parts);
}

// Short human description of a top-level node, for the "no results" help.
export function describeNode(node) {
    if (isGroup(node)) {
        const inner = node.items.map(describeNode).join(node.op === 'or' ? ` ${t('or')} ` : ` ${t('and')} `);
        return `${node.not ? `${t('not')} ` : ''}(${inner})`;
    }
    let what;
    switch (node.k) {
        case 'in':
        case 'has': what = `${t(`kind_${node.k}`)} ${node.v.join(', ') || '…'}`; break;
        case 'range': what = `${t('kind_range')} ${fmtNumber(node.min) || '…'}–${fmtNumber(node.max) || '…'}`; break;
        case 'flag': what = node.set === false ? t('flagEmpty') : t('flagSet'); break;
        default: what = `${t(`text_${node.m || 'contains'}`)} “${node.x || ''}”`;
    }
    return `${node.not ? `${t('not')} ` : ''}${node.c}: ${what}`;
}
