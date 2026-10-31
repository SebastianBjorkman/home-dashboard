import fs from 'node:fs';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ENTITY = /^[a-z_]+\.[a-z0-9_]+$/;

// Home Assistant validates options against config.yaml before start, but the
// same file is used in dev mode, so normalize defensively here too.
export function loadConfig(file = process.env.HD_OPTIONS || '/data/options.json') {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return normalizeConfig(raw);
}

export function normalizeConfig(raw = {}) {
  const str = v => (typeof v === 'string' ? v.trim() : '');
  const list = v => (Array.isArray(v) ? v : []);

  const children = list(raw.children).map((c, i) => ({
    id: String(i),
    name: str(c.name) || `Barn ${i + 1}`,
    haUser: str(c.ha_user).toLowerCase(),
    skola24: str(c.skola24_host) && str(c.skola24_unit) && str(c.skola24_class)
      ? { host: str(c.skola24_host), unit: str(c.skola24_unit), className: str(c.skola24_class), group: str(c.skola24_group) }
      : null,
    menuUrl: /^https:\/\//.test(str(c.school_menu_url)) ? str(c.school_menu_url) : '',
    // The child's own devices: shown in their view and the only ones they may switch.
    entities: list(c.entities).map(str).filter(id => ENTITY.test(id)),
  }));

  return {
    children,
    calendars: list(raw.calendars).map(str).filter(id => /^calendar\.[a-z0-9_]+$/.test(id)),
    entities: list(raw.entities).map(str).filter(id => ENTITY.test(id)),
    holidays: list(raw.holidays)
      .map(h => ({ name: str(h?.name), start: str(h?.start) }))
      .filter(h => h.name && DATE.test(h.start)),
    timezone: process.env.TZ || 'Europe/Stockholm',
  };
}
