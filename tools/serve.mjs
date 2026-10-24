// Zero-dependency static file server for local development:
//
//     node tools/serve.mjs [port] [--row-picker <folder>]
//
// --row-picker: for an app built on row-picker, serve row-picker from that local folder instead of jsDelivr (the
// jsDelivr address in the app's HTML is rewritten to it), to try changes to both before releasing row-picker.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = args.indexOf('--row-picker');
const local = flag >= 0 ? path.resolve(args[flag + 1] || '') : null;
const port = Number(args.find((a, i) => /^\d+$/.test(a) && i !== flag + 1)) || 8000;
const CDN = /https:\/\/cdn\.jsdelivr\.net\/gh\/ChaotX\/row-picker@[^/"']+\//g;
const LOCAL_PATH = '/_row-picker/';
const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    let base = root;
    if (local && urlPath.startsWith(LOCAL_PATH)) {
        base = local;
        urlPath = urlPath.slice(LOCAL_PATH.length - 1);
    }
    const file = path.join(base, urlPath);
    if (!file.startsWith(base)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
    }
    fs.readFile(file, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('not found');
            return;
        }
        const type = types[path.extname(file)] || 'application/octet-stream';
        const body = local && type.startsWith('text/html') ? data.toString('utf8').replace(CDN, LOCAL_PATH) : data;
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        res.end(body);
    });
}).listen(port, () => console.log(`http://localhost:${port}${local ? `  (row-picker from ${local})` : ''}  (Ctrl+C to stop)`));
