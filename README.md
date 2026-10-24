# row-picker

Filter and sort a Google Sheet and keep the result as a link. Build the query with a few clicks — filters combined
with AND / OR, each one can be inverted, sort keys, visible columns — and watch the matching rows update below. The
link always runs on the sheet's **current** content; if the sheet changes, filters that no longer fit are skipped
with a warning instead of breaking the link.

It is a static web app (plain JavaScript ES modules, no build step, no dependencies), served by GitHub Pages at
<https://chaotx.github.io/row-picker/>. Other apps can be built on it with their own name, texts and settings — see
[Building an app on row-picker](#building-an-app-on-row-picker).

## Using it

1. **Choose a spreadsheet:** paste its link (a `#gid=…` in it picks the tab), choose it in Google Drive, or open a
   recent one. A spreadsheet with several tabs asks which one holds the data (one item per row, column names in the
   first row); the choice is remembered, and **Data from tab** above the filters switches it.
2. **Add filters.** Each filter card: column → filter type → values. The type is guessed from the column's values:

   | Column holds | Example | Filter offered first |
   |---|---|---|
   | one value or yes/no | `●`, `Yes` | **has a value / is empty** |
   | numbers or ranges | `15–20`, `1,5–2`, `995 Ft` | **between** min … max (*overlaps* or *lies within*) |
   | a few distinct values | `Shrub` | **is one of** (checkboxes with counts) |
   | scale values joined by dashes | `Sun–half shade` | **is one of** + *Match parts of ranges* (counts for both parts) |
   | comma-separated lists | `Hedge, solitary` | **includes** any / all of the items |
   | anything else | free text | **text matches**: contains, is exactly, wildcard (`Acer*`), regular expression |

   Any other type can be picked from the type menu. **Exclude** keeps the rows a filter does *not* match. The top
   line chooses whether *all* or *any* of the filters must match; a **Group** combines its filters the other way
   (e.g. "any of" inside "all of"). ↑ ↓ move a filter or group within its list.
3. **Read the counts.** Each card shows how many rows the filter lets through alone, and the running count along
   the chain with what it changes: `→ 117 (−70)` along *all of* (rows removed), `→ 562 (+431)` along *any of* (rows
   added); `±0` (highlighted) means the filter changes nothing there. Inside a group the chain counts among the rows
   reaching the group.
4. **Value lists follow the filters above:** a filter's checkboxes offer only the values of the rows that pass the
   filters before it in an *all of* chain, with their counts there. *Only values in the rows filtered so far* (per
   filter, saved in the link) switches back to every value of the column.
5. **Sort** by one or more columns (ranges by their lower or upper end), or click a column header. **Columns shown**
   picks the table columns (automatic: the first two plus the filtered / sorted ones). Click a row for all its fields.
6. **Name and keep it:** the name at the top of the panel is part of the query and the page title. The address bar
   always holds the whole query (`?q=…`); **Copy link** copies it. **Short link** saves it in your Drive and copies
   `…/?l=abc234` (see below). **New filter** starts an empty one on the same tab (Back brings the previous one).
   The panel closes to a one-line summary (▾); a link that has filters opens with it closed.

When nothing matches, the page says so and lists each filter with the number of rows it lets through alone and the
number you'd get without it, with a button to remove it.

### When the sheet changes

| Change | What happens |
|---|---|
| column renamed only in case / accents / spacing | used anyway, with a note |
| column removed or renamed | filter skipped (neither hides nor adds rows), with a one-click "Use *closest column*" |
| a chosen value no longer occurs | warning; the other values still filter (none left → nothing matches, said so) |
| a numeric column turned into text | warning with the share still numeric; non-numbers don't match |
| invalid regular expression | filter skipped |
| sort / shown column missing | dropped, with a note |
| tab renamed | found by its id (gid); tab deleted → choose another tab |
| spreadsheet deleted / no access | error page saying which, with the next step |

## Access and sign-in

Reading tries, in order:

1. **Sheets API with the API key** — no sign-in; works for sheets shared as *anyone with the link*. Gives numbers
   unformatted (exact).
2. **The public export** (`htmlview` + CSV) — no key at all; also only for link-shared sheets. Values as shown.
3. **Google sign-in** (scope `drive.file`) — private sheets. The app only sees spreadsheets you chose in the Drive
   Picker (or it created), so a private sheet is chosen once with **Choose it in Google Drive**.

The access token is kept in `localStorage`: reloads and new tabs within its hour need nothing; after that one click
(**Continue with Google**) gets a new one without any consent screen. A static page can't refresh tokens silently
(that needs a backend holding a refresh token — e.g. a small Cloudflare Worker; all token handling is behind
`getToken()` in [js/google-auth.js](js/google-auth.js), so one could be added later).

### Short links

`?l=<id>` links are stored in a spreadsheet named after the app (`row-picker links`) in *your* Drive (created on
the first save; columns `id`, `name`, `query`, `created`, `updated`). It is never shared, so it doesn't leak which
spreadsheets your filters point to — but it also means a short link opens only for you (signed in). Saving a filter
that is already saved gives its existing link; opening a long link of a saved filter (signed in) shows it as that
short link. Opened from a short link, **Update** makes the link open the query as it is now; **Save as new** makes
another one. **Saved ▾** lists them. To give a filter to someone else, use the full **Copy link**.

## Building an app on row-picker

An app is an `index.html` that calls `startApp(config)`; row-picker puts its page frame and stylesheet into the
page. It loads row-picker from [jsDelivr](https://www.jsdelivr.com/), which serves this repository's files at a
fixed version tag:

```html
<!doctype html>
<html lang="hu">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>my-picker</title>
    <link rel="icon" href="favicon.svg" type="image/svg+xml">
    <script type="importmap">
        { "imports": { "row-picker/": "https://cdn.jsdelivr.net/gh/ChaotX/row-picker@v1.0.0/" } }
    </script>
</head>
<body>
    <script type="module">
        import { startApp } from 'row-picker/js/index.js';
        import config from './config.js';

        startApp(config);
    </script>
</body>
</html>
```

`config.js` (every option and its default: [js/settings.js](js/settings.js)):

```js
export default {
    name: 'my-picker',                 // top bar, page title, {app} in texts
    icon: 'favicon.svg',               // top-bar icon
    storagePrefix: 'my-picker',        // browser storage keys (sign-in, recent sheets, …)
    linksTitle: 'my-picker links',     // the short-link spreadsheet in the user's Drive
    locale: 'hu',                      // comparing and sorting cell text
    languages: ['hu', 'en'],           // UI languages offered
    strings: { hu: { startTitle: '…' }, en: { startTitle: '…' } },   // text overrides (keys: i18n/en.js)
    google: { clientId: '…', apiKey: '…', appId: '…' }
};
```

A stylesheet of the app, linked in its `<head>`, comes after row-picker's and can override it.

**Versions.** A release is a git tag (`git tag v1.1.0 && git push origin v1.1.0`); an app moves to it by changing
the version in its import map. A tag's files never change on jsDelivr, so an app keeps working while row-picker
changes. (`@main` would follow the branch with up to 12 hours of caching — not for a live app.)

**Developing both at once:** serve the app with `node tools/serve.mjs --row-picker ../row-picker` (the app's copy
of [tools/serve.mjs](tools/serve.mjs)): its pages then load row-picker from the local folder instead of jsDelivr.

## Running locally

```sh
node tools/serve.mjs   # or: npm run serve (in PowerShell: npm.cmd run serve)
node --test "tests/*.test.js"   # or: npm test — profiling, query, validation, link codec, CSV (Node ≥ 20)
```

Open <http://localhost:8000> and paste the link of a spreadsheet (or choose one from Google Drive).

## Google Cloud setup

The values in [config.js](config.js) are PlanTape's Google Cloud project (same `chaotx.github.io` origin).
Link-shared sheets work without any of this (step 2 above); sign-in needs it.

1. **APIs & Services → Library:** Google Sheets API, Google Drive API and Google Picker API enabled.
2. **Credentials → API key → API restrictions:** Google Sheets API and Google Picker API. Without the Sheets API
   the key path is skipped (a console warning says so) and the public export is used.
3. **Credentials → OAuth client → Authorized JavaScript origins:** `https://chaotx.github.io` and
   `http://localhost:8000`.
4. The consent screen shows the project's app name. For a separate name, create a new project or OAuth client and
   put its values in the app's `config.js`.

## Link format

`?q=` is `z` + base64url(deflate-raw(JSON)) (`j` + base64url(JSON) without CompressionStream):

```js
{ v: 1, n: '<name>', s: '<spreadsheet id>', g: <tab gid>, t: '<tab title>',
  q: { op: 'and' | 'or', items: [filter | group] },   // group = { op, items, not }
  o: [{ c: '<column>', d: 'desc', by: 'max' }],         // sort keys
  cols: ['<column>', …] }                               // shown columns (absent = automatic)
filter = { c: '<column header>', k: 'in' | 'has' | 'range' | 'flag' | 'text', not, …
           v: [values], parts, all, wide, min, max, how: 'within', set: false, m: 'equals' | 'wildcard' | 'regex', x, cs }
```

Columns are referenced by header name (so reordering columns doesn't matter), the tab by gid, then title.

## Project layout

```
index.html, config.js     row-picker's own site: startApp() with its config
style.css                 light / dark, phone layout with result cards
js/index.js               startApp(config): the entry point for apps
js/settings.js            the configuration and its defaults
js/shell.js               the page frame and stylesheet, put into the host page
js/app.js                 screens, loading, URL sync, sharing, saved filters
js/profile.js             column kinds, number / range / list parsing, table building
js/query.js               query model, validation against the current columns, evaluation, counts, sorting
js/codec.js               query ⇄ URL, comparison key
js/data.js                key → public export → token access, error codes
js/public-sheet.js        htmlview tab list, CSV export
js/shortlinks.js          the private short-link spreadsheet
js/sheets-api.js, google-auth.js, picker.js, util.js, i18n.js
js/ui/builder.js, results.js, start.js, dom.js
i18n/en.js, i18n/hu.js    UI strings (sheet content is never translated)
tests/                    node --test suites; fixtures/sample-plants.js = a small made-up table
```

## Ideas

- Column groups in the config: several yes/no columns as one filter (e.g. the months a plant flowers in).
- Ordered scales in the config (Sun < Sun–half shade < Half shade …) so "at least half shade" can be asked.
- Arbitrary nesting of groups in the UI (the query model and engine already support it).
