import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AREA, SKOLA24_HOST, isPublicHttpsUrl, loadConfig, toOptions } from './lib/config.mjs';
import { addDays, isoWeek, localDay } from './lib/time.mjs';
import { fetchWeek, listClasses, listUnits, resolveClass, subGroups } from './modules/skola24.mjs';
import { fetchMenu } from './modules/schoolmenu.mjs';
import { createRateLimiter, identify, isSameOriginWrite, switchableEntities } from './lib/access.mjs';
import { createCache } from './lib/cache.mjs';
import { buildDashboard } from './lib/dashboard.mjs';
import { resolveChildEntities, roomCandidates } from './lib/devices.mjs';
import { applySettings, createSettings } from './lib/settings.mjs';
import * as ha from './modules/homeassistant.mjs';

const MAX_TOGGLE_BODY = 1024;
const MAX_SETTINGS_BODY = 32 * 1024;
const CATALOG_TTL_MS = 60_000;
const SCHOOL_TTL_MS = 60 * 60_000;

const root = path.dirname(fileURLToPath(import.meta.url));

// Only these files are ever served; nothing is looked up from the request path.
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/settings': ['settings.html', 'text/html; charset=utf-8'],
  '/settings.js': ['settings.js', 'text/javascript; charset=utf-8'],
};

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  // Ingress shows the page in an iframe on the same origin as Home Assistant.
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
};

const JSON_TYPE = 'application/json; charset=utf-8';

export function createServer({ cfg: baseCfg, cache, settings = createSettings(), dev = false, devUser = 'dev', rateLimit = createRateLimiter() }) {
  const catalog = () => cache.get('catalog', CATALOG_TTL_MS, async () => {
    const [areas, entities] = await Promise.all([ha.fetchAreas(), ha.fetchAllEntities()]);
    return { areas, entities };
  });

  return http.createServer(async (req, res) => {
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { ...HEADERS, 'Content-Type': type });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    const sendJson = data => send(200, JSON.stringify(data), JSON_TYPE);

    const cfg = applySettings(baseCfg, settings.get());
    const who = identify(req, cfg, { dev, devUser });
    if (!who.ok) return send(who.status, who.status === 401 ? 'Logga in via Home Assistant.' : 'Åtkomst nekad.');

    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return send(400, 'Felaktig begäran.');
    }

    // Both write routes share the same checks before anything is read.
    const readWrite = async limit => {
      if (req.method !== 'POST') return { error: [405, 'Använd POST.'] };
      if (!isSameOriginWrite(req)) return { error: [403, 'Åtkomst nekad.'] };
      if (!String(req.headers['content-type']).startsWith('application/json')) return { error: [415, 'Förväntade JSON.'] };
      if (!rateLimit(who.user.id)) return { error: [429, 'Lugna ner dig lite!'] };
      try {
        return { body: JSON.parse(await readBody(req, limit)) };
      } catch {
        return { error: [400, 'Felaktig begäran.'] };
      }
    };

    try {
      // Switch one device the viewer is allowed to switch.
      if (url.pathname === '/api/toggle') {
        const { body, error } = await readWrite(MAX_TOGGLE_BODY);
        if (error) return send(...error);
        if (!ha.available()) return send(503, 'Home Assistant är inte ansluten.');
        const allowed = await switchableEntities(cfg, who, c => resolveChildEntities(c, cache).then(r => r.ids));
        if (typeof body?.entity_id !== 'string' || !allowed.has(body.entity_id)) return send(403, 'Den enheten får du inte styra.');
        try {
          await ha.toggle(body.entity_id);
        } catch (e) {
          console.error('Toggle: ' + e.message);
          return send(502, 'Home Assistant svarade inte.');
        }
        cache.invalidate('states:');
        return send(204, '');
      }

      // Everything about settings is for parents only.
      if (['/api/settings', '/api/ha/', '/api/school/', '/settings'].some(p => url.pathname.startsWith(p))) {
        if (who.role !== 'parent') return send(403, 'Bara vuxna kan ändra inställningar.');
      }

      if (url.pathname === '/api/settings' && req.method === 'POST') {
        const { body, error } = await readWrite(MAX_SETTINGS_BODY);
        if (error) return send(...error);
        settings.save({ version: 2, options: body?.options });
        cache.invalidate('area:');
        cache.invalidate('states:');
        return send(204, '');
      }

      if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'Endast läsning.');

      if (url.pathname === '/api/dashboard') {
        return sendJson(await buildDashboard({ cfg, cache, identity: who, view: url.searchParams.get('view') }));
      }

      if (url.pathname === '/api/settings') {
        return sendJson({ haAvailable: ha.available(), options: toOptions(cfg) });
      }

      if (url.pathname.startsWith('/api/school/')) {
        const result = await schoolLookup(url, cfg, cache);
        if (result.error) return send(...result.error);
        return sendJson(result.data);
      }

      if (url.pathname === '/api/ha/catalog') {
        if (!ha.available()) return send(503, 'Home Assistant är inte ansluten.');
        const entry = await catalog();
        if (!entry.data) return send(502, 'Kunde inte hämta från Home Assistant: ' + entry.error);
        return sendJson(entry.data);
      }

      if (url.pathname === '/api/ha/area') {
        const area = url.searchParams.get('id') || '';
        if (!AREA.test(area)) return send(400, 'Ogiltigt rum.');
        if (!ha.available()) return send(503, 'Home Assistant är inte ansluten.');
        const [ids, cat] = await Promise.all([ha.fetchAreaEntities(area), catalog()]);
        return sendJson(roomCandidates(ids, cat.data?.entities || []));
      }
    } catch (e) {
      console.error(`${url.pathname}: ${e.stack}`);
      return send(500, 'Något gick fel.');
    }

    const file = STATIC[url.pathname];
    if (!file) return send(404, 'Hittades inte.');
    return send(200, fs.readFileSync(path.join(root, 'public', file[0])), file[1]);
  });
}

/** Lookups behind the settings page's school pickers and the menu "Testa" button. */
async function schoolLookup(url, cfg, cache) {
  const q = name => (url.searchParams.get(name) || '').trim();
  const host = q('host').toLowerCase();
  const unit = q('unit').slice(0, 80);
  const className = q('class').slice(0, 20);
  const fail = (status, message) => ({ error: [status, message] });
  const fromCache = async (key, fn) => {
    const entry = await cache.get(key, SCHOOL_TTL_MS, fn);
    return entry.data ? { data: entry.data } : fail(502, entry.error);
  };

  switch (url.pathname) {
    case '/api/school/units':
      if (!SKOLA24_HOST.test(host)) return fail(400, 'Ange en adress som slutar på .skola24.se');
      return fromCache(`school:units:${host}`, () => listUnits(host));
    case '/api/school/classes':
      if (!SKOLA24_HOST.test(host) || !unit) return fail(400, 'Välj kommun och skola först.');
      return fromCache(`school:classes:${host}:${unit}`.toLowerCase(), () => listClasses(host, unit));
    case '/api/school/groups': {
      if (!SKOLA24_HOST.test(host) || !unit || !className) return fail(400, 'Välj klass först.');
      // This week and next, so a holiday week still finds the class's groups.
      const today = localDay(new Date(), cfg.timezone);
      const mondays = [addDays(today.iso, 1 - today.dow), addDays(today.iso, 8 - today.dow)];
      return fromCache(`school:groups:${host}:${unit}:${className}:${mondays[0]}`.toLowerCase(), async () => {
        const ref = await resolveClass({ host, unit, className });
        const weeks = await Promise.all(mondays.map(mondayIso => {
          const { week, weekYear } = isoWeek(mondayIso);
          return fetchWeek(ref, { weekYear, week, mondayIso });
        }));
        return subGroups(weeks.flat());
      });
    }
    case '/api/school/menu': {
      const menuUrl = q('url');
      if (!isPublicHttpsUrl(menuUrl)) return fail(400, 'Ange en https-länk till matsedelssidan.');
      try {
        return { data: (await fetchMenu(menuUrl))[0] };
      } catch (e) {
        return fail(502, e.code === 'blocked' ? 'Webbplatsen tillåter inte automatisk hämtning.' : e.message);
      }
    }
    default:
      return fail(404, 'Hittades inte.');
  }
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
  const dataDir = process.env.HD_DATA || '/data';
  const cfg = loadConfig();
  const cache = createCache({ file: path.join(dataDir, 'cache.json') });
  const settings = createSettings(path.join(dataDir, 'settings.json'));
  const port = Number(process.env.HD_PORT || 8099);
  // In the add-on the Ingress proxy reaches us over the internal Docker network;
  // access.mjs refuses every other source. In dev mode we only listen locally.
  const host = dev ? '127.0.0.1' : '0.0.0.0';
  const server = createServer({ cfg, cache, settings, dev, devUser: process.env.HD_DEV_USER || 'dev' });
  server.listen(port, host, () => {
    console.log(`Home Dashboard: http://${host}:${port}${dev ? ' (utvecklingsläge)' : ''}`);
    console.log(ha.available() ? 'Home Assistant: ansluten via Supervisor' : 'Home Assistant: ingen token – kalendrar och enheter är avstängda');
  });
  // Node runs as PID 1 in the container and ignores SIGTERM unless told otherwise.
  // Settings are written synchronously, so there is nothing to flush.
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => process.exit(0));
}
