import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeConfig } from '../lib/config.mjs';
import { createCache } from '../lib/cache.mjs';
import { applySettings, createSettings, validateSettings } from '../lib/settings.mjs';
import { createServer } from '../server.mjs';
import { fakeHomeAssistant } from './fake-ha-server.mjs';

const cfg = normalizeConfig({
  children: [{ name: 'Alva', ha_user: 'alva' }, { name: 'Theo', ha_user: 'theo', entities: ['light.theo_tak'] }],
  entities: ['sensor.ute'],
});

async function withServer(devUser, fn, settings = createSettings()) {
  const ha = await fakeHomeAssistant();
  process.env.HD_HA_URL = ha.url;
  process.env.SUPERVISOR_TOKEN = 'test-token';
  const server = createServer({ cfg, cache: createCache(), settings, dev: true, devUser });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = p => fetch(base + p);
  const save = (body, headers = {}) => fetch(base + '/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Home-Dashboard': '1', ...headers },
    body: JSON.stringify(body),
  });
  try {
    await fn({ get, save, ha });
  } finally {
    server.close();
    ha.server.close();
    delete process.env.HD_HA_URL;
    delete process.env.SUPERVISOR_TOKEN;
  }
}

test('saved settings are validated: bad ids, room names and keys are dropped', () => {
  const s = validateSettings({
    children: { Alva: { area: 'alvas_rum', entities: ['light.ok', 'not an id', 'light.ok'], exclude: ['switch.x'] }, '{{bad}}': {} },
    calendars: ['calendar.familj', 'sensor.inte_kalender'],
    entities: 'inte en lista',
  });
  assert.deepEqual(s, { children: { alva: { area: 'alvas_rum', entities: ['light.ok'], exclude: ['switch.x'] } }, calendars: ['calendar.familj'] });
  assert.equal(validateSettings({ children: { a: { area: '"}}{{' } } }).children.a.area, '');
});

test('settings override the add-on options per child and for the family', () => {
  const merged = applySettings(cfg, { children: { alva: { area: 'alvas_rum', entities: ['light.hallen'], exclude: [] } }, entities: [] });
  assert.equal(merged.children[0].area, 'alvas_rum');
  assert.deepEqual(merged.children[1].entities, ['light.theo_tak']);
  assert.deepEqual(merged.entities, []);
});

test('settings survive a restart', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hd-')), 'settings.json');
  createSettings(file).save({ children: { alva: { area: 'alvas_rum' } } });
  assert.equal(createSettings(file).get().children.alva.area, 'alvas_rum');
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
});

test('a child cannot see or change settings', () => withServer('alva', async ({ get, save }) => {
  for (const p of ['/settings', '/settings.js', '/api/settings', '/api/ha/catalog', '/api/ha/area?id=alvas_rum']) {
    assert.equal((await get(p)).status, 403, p);
  }
  assert.equal((await save({ options: { children: [] } })).status, 403);
}));

test('a parent gets rooms and entities from Home Assistant to pick from', () => withServer('pappa', async ({ get }) => {
  const catalog = await (await get('/api/ha/catalog')).json();
  assert.deepEqual(catalog.areas.map(a => a.name), ['Alvas rum', 'Kök']);
  assert.ok(catalog.entities.some(e => e.id === 'calendar.familj' && e.domain === 'calendar'));
  const room = await (await get('/api/ha/area?id=alvas_rum')).json();
  assert.deepEqual(room.map(e => e.id), ['light.alva_tak', 'switch.alva_laddare', 'sensor.alva_temp']);
  assert.equal((await get('/api/ha/area?id=' + encodeURIComponent('x") }}'))).status, 400);
}));

test('saving from the settings page replaces the whole configuration', () => withServer('pappa', async ({ get, save }) => {
  const options = {
    children: [{ name: 'Alva', ha_user_id: 'a'.repeat(32), area: 'alvas_rum', entities: ['light.hallen'], exclude: ['switch.alva_laddare'] }],
    entities: ['sensor.ute'],
    calendars: [],
    holidays: [{ name: 'Jullovet', start: '2026-12-23' }],
  };
  assert.equal((await save({ options })).status, 204);
  const saved = (await (await get('/api/settings')).json()).options;
  assert.deepEqual(saved.children.map(c => c.name), ['Alva']);
  assert.equal(saved.children[0].ha_user_id, 'a'.repeat(32));
  assert.deepEqual(saved.holidays, [{ name: 'Jullovet', start: '2026-12-23' }]);
  const d = await (await get('/api/dashboard')).json();
  assert.deepEqual(d.children.map(c => c.name), ['Alva']);
  assert.deepEqual(d.children[0].devices.map(x => x.id).sort(), ['light.alva_tak', 'light.hallen', 'sensor.alva_temp']);
}));

test('a child linked by person (user id) gets the kid view after the settings are saved', async () => {
  const settings = createSettings();
  settings.save({ version: 2, options: { children: [{ name: 'Alva', ha_user_id: 'b'.repeat(32) }] } });
  const merged = applySettings(cfg, settings.get());
  const { identify, INGRESS_PROXY } = await import('../lib/access.mjs');
  const who = identify({ socket: { remoteAddress: INGRESS_PROXY }, headers: { 'x-remote-user-id': 'b'.repeat(32), 'x-remote-user-name': 'vadsomhelst' } }, merged);
  assert.deepEqual([who.role, who.childId], ['child', '0']);
});

test('school lookups validate input before contacting anyone', () => withServer('pappa', async ({ get }) => {
  assert.equal((await get('/api/school/units?host=evil.example.com')).status, 400);
  assert.equal((await get('/api/school/classes?host=kommun.skola24.se')).status, 400);
  assert.equal((await get('/api/school/groups?host=kommun.skola24.se&unit=Skolan')).status, 400);
  for (const url of ['http://kommun.se/meny', 'https://localhost/meny', 'https://192.168.1.10/meny', 'https://nas.local/meny', 'file:///etc/passwd']) {
    assert.equal((await get('/api/school/menu?url=' + encodeURIComponent(url))).status, 400, url);
  }
}));

test('a child cannot use the school lookups', () => withServer('alva', async ({ get }) => {
  assert.equal((await get('/api/school/units?host=kommun.skola24.se')).status, 403);
}));

test('saving needs the same write protections as switching', () => withServer('pappa', async ({ save }) => {
  assert.equal((await save({}, { 'X-Home-Dashboard': '' })).status, 403);
  assert.equal((await save({}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await save({}, { 'Content-Type': 'text/plain' })).status, 415);
}));
