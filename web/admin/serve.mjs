/* Tiny static server for the FareFair Admin Console.
 *
 * Serves the repository root so the console can be edited without running the
 * API. The console talks to the API at http://localhost:4000 (or ?api=...), and
 * falls back to assets/data or the bundled snapshot when the API is offline.
 * No dependencies.
 *
 * Usage:
 *   node web/admin/serve.mjs            → http://localhost:8080/web/admin/
 *   node web/admin/serve.mjs 9000       → choose a port
 *
 * Stop with Ctrl+C.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const port = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let relative;
  try {
    relative = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    send(res, 400, 'Bad request');
    return;
  }

  if (relative === '/') {
    res.writeHead(302, { Location: '/web/admin/' });
    res.end();
    return;
  }

  if (relative.endsWith('/')) relative += 'index.html';

  const file = path.resolve(path.join(root, relative));
  if (file !== root && !file.startsWith(root + path.sep)) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      send(res, 404, 'Not found: ' + relative);
      return;
    }
    send(res, 200, data, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Try: node web/admin/serve.mjs 8081`);
  } else {
    console.error(error.message);
  }
  process.exit(1);
});

server.listen(port, () => {
  console.log('');
  console.log('  FareFair Admin Console');
  console.log(`  http://localhost:${port}/web/admin/`);
  console.log(`  Accounts panel: http://localhost:${port}/web/admin/?demo=1`);
  console.log('');
  console.log('  Serving ' + root);
  console.log('  Live data from /assets/data/ · Ctrl+C to stop');
  console.log('');
});
