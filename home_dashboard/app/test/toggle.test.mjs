import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRateLimiter, switchableEntities } from '../lib/access.mjs';
import { normalizeConfig } from '../lib/config.mjs';
import { createCache } from '../lib/cache.mjs';
import { createServer } from '../server.mjs';

const cfg = normalizeConfig({
  children: [
    {
      name: 'Alva', ha_user: 'alva', area: 'Alvas rum',
      entities: ['light.hallen', 'lock.ytterdorr'],
      exclude: ['switch.alva_laddare'],
    },
    { name: 'Theo', ha_user: 'theo', entities: ['light.theo_tak'] },
  ],
  entities: ['light.kok', 'sensor.ute'],
});

// A stand-in for Home Assistant's REST API that records every call.
async function fakeHomeAssistant() {
  const states = {
    'light.alva_tak': 'off', 'light.hallen': 'off', 'light.theo_tak': 'off', 'light.kok': 'on',
    'switch.alva_laddare': 'on', 'sensor.alva_temp': '21', 'sensor.alva_batteri': '80', 'sensor.ute': '7',
  };
  const deviceClass = { 'sensor.alva_temp': 'temperature', 'sensor.alva_batteri': 'battery', 'sensor.ute': 'temperature' };
  const areas = { 'Alvas rum': ['light.alva_tak', 'switch.alva_laddare', 'sensor.alva_temp', 'sensor.alva_batteri', 'media_player.alva'] };
  const calls = [];
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer test-token') { res.writeHead(401).end(); return; }
    const toggle = req.url.match(/^\/services\/(\w+)\/toggle$/);
    if (req.method === 'POST' && toggle) {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        const { entity_id } = JSON.parse(body);
        calls.push(entity_id);
        states[entity_id] = states[entity_id] === 'on' ? 'off' : 'on';
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('[]');
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/template') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        const area = JSON.parse(body).template.match(/area_entities\(("[^"]*")\)/)[1];
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end(JSON.stringify(areas[JSON.parse(area)] || []));
      });
      return;
    }
    const id = decodeURIComponent(req.url.replace('/states/', ''));
    if (req.method === 'GET' && id in states) {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ state: states[id], attributes: { friendly_name: id, device_class: deviceClass[id] } }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, calls, states, url: `http://127.0.0.1:${server.address().port}` };
}

async function withDashboard(devUser, fn, { rateLimit, config = cfg } = {}) {
  const ha = await fakeHomeAssistant();
  process.env.HD_HA_URL = ha.url;
  process.env.SUPERVISOR_TOKEN = 'test-token';
  const server = createServer({ cfg: config, cache: createCache(), dev: true, devUser, rateLimit });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const toggle = (entity_id, headers = {}) => fetch(base + '/api/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Home-Dashboard': '1', ...headers },
    body: JSON.stringify({ entity_id }),
  });
  try {
    await fn({ base, toggle, ha });
  } finally {
    server.close();
    ha.server.close();
    delete process.env.HD_HA_URL;
    delete process.env.SUPERVISOR_TOKEN;
  }
}

test('only on/off domains from the viewer\'s own devices are switchable', async () => {
  const devices = { 0: ['light.alva_tak', 'sensor.alva_temp', 'lock.ytterdorr'], 1: ['light.theo_tak'] };
  const entitiesOf = c => devices[c.id];
  const alva = await switchableEntities(cfg, { role: 'child', childId: '0' }, entitiesOf);
  assert.deepEqual([...alva], ['light.alva_tak']);
  const parent = await switchableEntities(cfg, { role: 'parent' }, entitiesOf);
  assert.deepEqual([...parent].sort(), ['light.alva_tak', 'light.kok', 'light.theo_tak']);
});

test('room devices are picked up, extras added, excluded and diagnostic ones left out', () => withDashboard('alva', async ({ base }) => {
  const { devices, status } = (await (await fetch(base + '/api/dashboard')).json()).children[0];
  const byId = Object.fromEntries(devices.map(d => [d.id, d]));
  assert.deepEqual(Object.keys(byId).sort(), ['light.alva_tak', 'light.hallen', 'lock.ytterdorr', 'sensor.alva_temp']);
  assert.deepEqual([byId['light.alva_tak'].inRoom, byId['light.hallen'].inRoom], [true, false]);
  assert.deepEqual([byId['light.hallen'].switchable, byId['lock.ytterdorr'].switchable], [true, false]);
  assert.deepEqual(status, []);
}));

test('a misspelled room name is reported', () => withDashboard('alva', async ({ base }) => {
  const { status } = (await (await fetch(base + '/api/dashboard')).json()).children[0];
  assert.match(status[0].message, /Hittar inga enheter i "Alvas rumm"/);
}, { config: normalizeConfig({ children: [{ name: 'Alva', ha_user: 'alva', area: 'Alvas rumm' }] }) }));

test('a child can switch their own lamp and sees it change', () => withDashboard('alva', async ({ base, toggle, ha }) => {
  const before = await (await fetch(base + '/api/dashboard')).json();
  const lamp = before.children[0].devices.find(d => d.id === 'light.alva_tak');
  assert.deepEqual([lamp.state, lamp.switchable], ['off', true]);
  assert.equal(before.children[0].devices.find(d => d.id === 'sensor.alva_temp').switchable, false);

  assert.equal((await toggle('light.alva_tak')).status, 204);
  assert.equal((await toggle('light.hallen')).status, 204);
  assert.deepEqual(ha.calls, ['light.alva_tak', 'light.hallen']);
  const after = await (await fetch(base + '/api/dashboard')).json();
  assert.equal(after.children[0].devices.find(d => d.id === 'light.alva_tak').state, 'on');
}));

test('a child cannot switch a sibling\'s lamp, the home\'s lamps, excluded devices or a lock', () => withDashboard('alva', async ({ toggle, ha }) => {
  for (const id of ['light.theo_tak', 'light.kok', 'lock.ytterdorr', 'switch.alva_laddare', 'media_player.alva', 'light.finns_inte']) {
    assert.equal((await toggle(id)).status, 403, id);
  }
  assert.deepEqual(ha.calls, []);
}));

test('a parent can switch any configured lamp but nothing unconfigured', () => withDashboard('pappa', async ({ toggle, ha }) => {
  assert.equal((await toggle('light.theo_tak')).status, 204);
  assert.equal((await toggle('light.kok')).status, 204);
  assert.equal((await toggle('light.vardagsrum')).status, 403);
  assert.deepEqual(ha.calls, ['light.theo_tak', 'light.kok']);
}));

test('writes need our own header, same-origin, JSON and POST', () => withDashboard('pappa', async ({ base, toggle, ha }) => {
  assert.equal((await toggle('light.kok', { 'X-Home-Dashboard': '' })).status, 403);
  assert.equal((await toggle('light.kok', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await toggle('light.kok', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await fetch(base + '/api/toggle')).status, 405);
  const big = await fetch(base + '/api/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Home-Dashboard': '1' },
    body: JSON.stringify({ entity_id: 'light.kok', pad: 'x'.repeat(5000) }),
  }).catch(() => ({ status: 400 }));
  assert.equal(big.status, 400);
  assert.deepEqual(ha.calls, []);
}));

test('rapid tapping is rate limited per user', () => withDashboard('alva', async ({ toggle }) => {
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await toggle('light.alva_tak')).status);
  assert.deepEqual(statuses, [204, 204, 429, 429]);
}, { rateLimit: createRateLimiter({ max: 2, windowMs: 60_000 }) }));
