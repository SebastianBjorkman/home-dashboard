import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { createRateLimiter, identify, isSameOriginWrite, switchableEntities } from './lib/access.mjs';
import { createCache } from './lib/cache.mjs';
import { buildDashboard } from './lib/dashboard.mjs';
import * as ha from './modules/homeassistant.mjs';

const MAX_BODY = 1024;

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

export function createServer({ cfg, cache, dev = false, devUser = 'dev', rateLimit = createRateLimiter() }) {
  return http.createServer(async (req, res) => {
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { ...HEADERS, 'Content-Type': type });
      res.end(req.method === 'HEAD' ? undefined : body);
    };

    const who = identify(req, cfg, { dev, devUser });
    if (!who.ok) return send(who.status, who.status === 401 ? 'Logga in via Home Assistant.' : 'Åtkomst nekad.');

    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return send(400, 'Felaktig begäran.');
    }

    // The single write route: switch one device the viewer is allowed to switch.
    if (url.pathname === '/api/toggle') {
      if (req.method !== 'POST') return send(405, 'Använd POST.');
      if (!isSameOriginWrite(req)) return send(403, 'Åtkomst nekad.');
      if (!String(req.headers['content-type']).startsWith('application/json')) return send(415, 'Förväntade JSON.');
      if (!rateLimit(who.user.id)) return send(429, 'Lugna ner dig lite!');
      let entityId;
      try {
        entityId = JSON.parse(await readBody(req, MAX_BODY)).entity_id;
      } catch {
        return send(400, 'Felaktig begäran.');
      }
      if (typeof entityId !== 'string' || !switchableEntities(cfg, who).has(entityId)) return send(403, 'Den enheten får du inte styra.');
      if (!ha.available()) return send(503, 'Home Assistant är inte ansluten.');
      try {
        await ha.toggle(entityId);
        cache.invalidate('states:');
        return send(204, '');
      } catch (e) {
        console.error('Toggle: ' + e.message);
        return send(502, 'Home Assistant svarade inte.');
      }
    }

    if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'Endast läsning.');

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

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('För stor'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
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
