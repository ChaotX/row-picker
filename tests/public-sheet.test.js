import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseHtmlView } from '../js/public-sheet.js';

test('CSV with quotes, escaped quotes, newlines in cells and CRLF', () => {
    const rows = parseCsv('a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n1,,3\n');
    assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'say "hi"', 'two\nlines'], ['1', '', '3']]);
});

test('tab list and title from the htmlview page', () => {
    const html = '<title>Kerti minta - Google Drive</title><script>items.push({name: "Leírás", pageUrl: "https:\/\/docs.google.com\/x?headers\x3dtrue&gid=111111", gid: "111111"});'
        + 'items.push({name: "Minta \\"lista\\"", pageUrl: "https:\/\/docs.google.com\/y", gid: "222222"});</script>';
    const { title, tabs } = parseHtmlView(html);
    assert.equal(title, 'Kerti minta');
    assert.deepEqual(tabs.map(t => [t.gid, t.title]), [[111111, 'Leírás'], [222222, 'Minta "lista"']]);
});
