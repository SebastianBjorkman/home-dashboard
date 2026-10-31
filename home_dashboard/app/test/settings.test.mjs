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
  for (const p of ['/settings', '/api/settings', '/api/ha/catalog', '/api/ha/area?id=alvas_rum']) {
    assert.equal((await get(p)).status, 403, p);
  }
  assert.equal((await save({ children: { alva: { area: 'kok' } } })).status, 403);
}));

test('a parent gets rooms and entities from Home Assistant to pick from', () => withServer('pappa', async ({ get }) => {
  const catalog = await (await get('/api/ha/catalog')).json();
  assert.deepEqual(catalog.areas.map(a => a.name), ['Alvas rum', 'Kök']);
  assert.ok(catalog.entities.some(e => e.id === 'calendar.familj' && e.domain === 'calendar'));
  const room = await (await get('/api/ha/area?id=alvas_rum')).json();
  assert.deepEqual(room.map(e => e.id), ['light.alva_tak', 'switch.alva_laddare', 'sensor.alva_temp']);
  assert.equal((await get('/api/ha/area?id=' + encodeURIComponent('x") }}'))).status, 400);
}));

test('saving from the settings page changes what the child sees and may switch', () => withServer('pappa', async ({ get, save }) => {
  const res = await save({ children: { alva: { area: 'alvas_rum', entities: ['light.hallen'], exclude: ['switch.alva_laddare'] } }, entities: ['sensor.ute'], calendars: [] });
  assert.equal(res.status, 204);
  const settings = await (await get('/api/settings')).json();
  assert.equal(settings.children[0].area, 'alvas_rum');
  const alva = (await (await get('/api/dashboard')).json()).children[0];
  assert.deepEqual(alva.devices.map(d => d.id).sort(), ['light.alva_tak', 'light.hallen', 'sensor.alva_temp']);
}));

test('saving needs the same write protections as switching', () => withServer('pappa', async ({ save }) => {
  assert.equal((await save({}, { 'X-Home-Dashboard': '' })).status, 403);
  assert.equal((await save({}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await save({}, { 'Content-Type': 'text/plain' })).status, 415);
}));
