import test from 'node:test';
import assert from 'node:assert/strict';
import { identify, INGRESS_PROXY } from '../lib/access.mjs';
import { normalizeConfig } from '../lib/config.mjs';
import { createCache } from '../lib/cache.mjs';
import { createServer } from '../server.mjs';
import { buildDashboard } from '../lib/dashboard.mjs';

const cfg = normalizeConfig({
  children: [{ name: 'Alva', ha_user: 'Alva' }, { name: 'Theo', ha_user: 'theo' }],
  calendars: ['calendar.familj', 'not a calendar'],
  holidays: [{ name: 'Jullov', start: '2026-12-21' }, { name: 'Trasig', start: 'imorgon' }],
});

const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });
const ingressHeaders = name => ({ 'x-remote-user-id': 'abc', 'x-remote-user-name': name, 'x-remote-user-display-name': name });

test('config drops invalid entries', () => {
  assert.deepEqual(cfg.calendars, ['calendar.familj']);
  assert.deepEqual(cfg.holidays.map(h => h.name), ['Jullov']);
  assert.equal(cfg.children[0].haUser, 'alva');
  assert.equal(cfg.children[0].skola24, null);
});

test('room names that could break out of a template are refused', () => {
  const areas = ['Alvas rum', 'Kök 2', 'x") }}{{ states', "a'b", '{{ x }}']
    .map(area => normalizeConfig({ children: [{ name: 'A', area }] }).children[0].area);
  assert.deepEqual(areas, ['Alvas rum', 'Kök 2', '', '', '']);
});

test('only the Ingress proxy is trusted, and only with user headers', () => {
  assert.equal(identify(req('172.30.32.5', ingressHeaders('pappa')), cfg).status, 403);
  assert.equal(identify(req('127.0.0.1', ingressHeaders('pappa')), cfg).status, 403);
  assert.equal(identify(req(INGRESS_PROXY), cfg).status, 401);
  const parent = identify(req('::ffff:' + INGRESS_PROXY, ingressHeaders('pappa')), cfg);
  assert.deepEqual([parent.ok, parent.role], [true, 'parent']);
});

test('a child user is recognized case-insensitively and mapped to their own entry', () => {
  const child = identify(req(INGRESS_PROXY, ingressHeaders('ALVA')), cfg);
  assert.deepEqual([child.role, child.childId], ['child', '0']);
});

test('dev mode accepts loopback only', () => {
  assert.equal(identify(req('127.0.0.1'), cfg, { dev: true }).ok, true);
  assert.equal(identify(req('192.168.1.20'), cfg, { dev: true }).status, 403);
});

test('a child sees only their own data, never home devices; kid view is forced', async () => {
  const identity = identify(req(INGRESS_PROXY, ingressHeaders('theo')), cfg);
  const d = await buildDashboard({ cfg, cache: createCache(), identity, view: 'family', now: new Date('2026-12-14T08:00:00Z') });
  assert.equal(d.view, 'kid');
  assert.deepEqual(d.children.map(c => c.name), ['Theo']);
  assert.equal(d.calendar, undefined);
  assert.equal(d.entities, undefined);
  assert.equal(d.countdown.nights, 7);
});

test('server refuses outsiders and writes, serves only known files', async () => {
  const server = createServer({ cfg, cache: createCache(), dev: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal((await fetch(base + '/api/dashboard', { method: 'POST' })).status, 405);
    assert.equal((await fetch(base + '/../server.mjs')).status, 404);
    assert.equal((await fetch(base + '/lib/config.mjs')).status, 404);
    const api = await fetch(base + '/api/dashboard');
    assert.equal(api.status, 200);
    assert.equal((await api.json()).role, 'parent');
  } finally {
    server.close();
  }
});

test('cache serves the last good value when a source fails', async () => {
  let t = 0;
  const cache = createCache({ now: () => t });
  await cache.get('k', 10, async () => 'gammal');
  t = 20;
  const failed = await cache.get('k', 10, async () => { const e = new Error('nere'); e.code = 'blocked'; throw e; });
  assert.deepEqual([failed.data, failed.error, failed.code], ['gammal', 'nere', 'blocked']);
});
