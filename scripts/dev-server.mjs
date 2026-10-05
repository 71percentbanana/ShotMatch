import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
let port = Number(process.env.PORT || process.argv[2] || 4173);
let attempts = 0;
const server = http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ app: 'shotmatch', port })); return; }
    const name = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const target = path.resolve(root, name);
    if (!target.startsWith(root + path.sep) || !types[path.extname(target)]) { res.writeHead(404); res.end('Not found'); return; }
    const bytes = await fs.readFile(target);
    res.writeHead(200, {
      'Content-Type': types[path.extname(target)] + (['.html', '.css', '.js'].includes(path.extname(target)) ? '; charset=utf-8' : ''),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Permissions-Policy': 'camera=(self)',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'"
    });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 400);
    res.end(error.code === 'ENOENT' ? 'Not found' : 'Unable to serve this request');
  }
});
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && attempts++ < 20) { port += 1; server.listen(port, '127.0.0.1'); }
  else { console.error(error); process.exitCode = 1; }
});
server.listen(port, '127.0.0.1', () => console.log(`ShotMatch is running at http://localhost:${port}`));
