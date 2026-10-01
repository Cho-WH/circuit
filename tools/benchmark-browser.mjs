// Isolated production preview with an opt-in measurement overlay. No application code changes.
// npm run build; node tools/benchmark-browser.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist');
const mime = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:4173');
    if (url.pathname === '/__benchmark.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(await readFile(new URL('./benchmark-browser-client.js', import.meta.url)));
      return;
    }
    const file = path.resolve(
      root,
      '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname),
    );
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    let content = await readFile(file);
    if (file.endsWith('index.html'))
      content = content
        .toString()
        .replace('</body>', '<script type="module" src="/__benchmark.js"></script></body>');
    res.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(content);
  } catch {
    res.writeHead(404).end();
  }
}).listen(4173, '127.0.0.1', () =>
  console.log('Benchmark preview: http://127.0.0.1:4173/ (separate local storage)'),
);
