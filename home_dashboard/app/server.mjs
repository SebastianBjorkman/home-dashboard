import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { identify } from './lib/access.mjs';
import { createCache } from './lib/cache.mjs';
import { buildDashboard } from './lib/dashboard.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

// Only these files are ever served; nothing is looked up from the request path.
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  // Ingress shows the page in an iframe on the same origin as Home Assistant.
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
};

export function createServer({ cfg, cache, dev = false, devUser = 'dev' }) {
  return http.createServer(async (req, res) => {
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { ...HEADERS, 'Content-Type': type });
      res.end(req.method === 'HEAD' ? undefined : body);
    };

    const who = identify(req, cfg, { dev, devUser });
    if (!who.ok) return send(who.status, who.status === 401 ? 'Logga in via Home Assistant.' : 'Åtkomst nekad.');
    if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'Endast läsning.');

    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return send(400, 'Felaktig begäran.');
    }

    if (url.pathname === '/api/dashboard') {
      try {
        const data = await buildDashboard({ cfg, cache, identity: who, view: url.searchParams.get('view') });
        return send(200, JSON.stringify(data), 'application/json; charset=utf-8');
      } catch (e) {
        console.error('Dashboard: ' + e.stack);
        return send(500, 'Något gick fel.');
      }
    }

    const file = STATIC[url.pathname];
    if (!file) return send(404, 'Hittades inte.');
    return send(200, fs.readFileSync(path.join(root, 'public', file[0])), file[1]);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dev = process.env.HD_DEV === '1';
  const cfg = loadConfig();
  const cache = createCache({ file: path.join(process.env.HD_DATA || '/data', 'cache.json') });
  const port = Number(process.env.HD_PORT || 8099);
  // In the add-on the Ingress proxy reaches us over the internal Docker network;
  // access.mjs refuses every other source. In dev mode we only listen locally.
  const host = dev ? '127.0.0.1' : '0.0.0.0';
  createServer({ cfg, cache, dev, devUser: process.env.HD_DEV_USER || 'dev' })
    .listen(port, host, () => console.log(`Home Dashboard: http://${host}:${port}${dev ? ' (utvecklingsläge)' : ''}`));
}
