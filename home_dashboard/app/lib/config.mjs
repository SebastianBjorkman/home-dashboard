import fs from 'node:fs';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const ENTITY = /^[a-z_]+\.[a-z0-9_]+$/;
// Area names end up inside a Home Assistant template, so no quotes or braces.
export const AREA = /^[\p{L}\p{N} _-]{1,64}$/u;
export const SKOLA24_HOST = /^[a-z0-9-]+\.skola24\.se$/;
const HA_USER_ID = /^[a-f0-9]{32}$/;

const MAX_CHILDREN = 10;
const MAX_IDS = 200;
const MAX_HOLIDAYS = 60;

// Home Assistant validates options against config.yaml before start, but the
// same shape is saved from the settings page, so normalize defensively here.
export function loadConfig(file = process.env.HD_OPTIONS || '/data/options.json') {
  const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  return normalizeConfig(raw);
}

/** Only public https pages: the server fetches this URL, so no local addresses. */
export function isPublicHttpsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname;
  return url.protocol === 'https:' && host.includes('.') && !/^[\d.]+$/.test(host) && !host.includes(':')
    && !/(^|\.)(localhost|local|internal|lan|home\.arpa)$/i.test(host);
}

export function normalizeConfig(raw = {}) {
  const str = (v, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const list = v => (Array.isArray(v) ? v : []);
  const ids = v => [...new Set(list(v).map(x => str(x)).filter(id => ENTITY.test(id)))].slice(0, MAX_IDS);

  const children = list(raw.children).slice(0, MAX_CHILDREN).map((c, i) => {
    const host = str(c?.skola24_host).toLowerCase();
    const unit = str(c?.skola24_unit, 80);
    const className = str(c?.skola24_class, 20);
    return {
      id: String(i),
      name: str(c?.name, 40) || `Barn ${i + 1}`,
      haUser: str(c?.ha_user, 64).toLowerCase(),
      haUserId: HA_USER_ID.test(str(c?.ha_user_id)) ? str(c.ha_user_id) : '',
      skola24: SKOLA24_HOST.test(host) && unit && className ? { host, unit, className, group: str(c?.skola24_group, 20) } : null,
      menuUrl: isPublicHttpsUrl(str(c?.school_menu_url, 500)) ? str(c.school_menu_url, 500) : '',
      // The child's own devices: everything in their room (a Home Assistant area),
      // plus extra entities, minus excluded ones. Only these may the child switch.
      area: AREA.test(str(c?.area)) ? str(c.area) : '',
      entities: ids(c?.entities),
      exclude: ids(c?.exclude),
    };
  });

  return {
    children,
    calendars: ids(raw.calendars).filter(id => id.startsWith('calendar.')),
    entities: ids(raw.entities),
    holidays: list(raw.holidays)
      .slice(0, MAX_HOLIDAYS)
      .map(h => ({ name: str(h?.name, 40), start: str(h?.start, 10) }))
      .filter(h => h.name && DATE.test(h.start))
      .sort((a, b) => a.start.localeCompare(b.start)),
    timezone: process.env.TZ || 'Europe/Stockholm',
  };
}

/** The inverse of normalizeConfig: back to the options/settings file shape. */
export function toOptions(cfg) {
  return {
    children: cfg.children.map(c => ({
      name: c.name,
      ha_user: c.haUser,
      ha_user_id: c.haUserId,
      skola24_host: c.skola24?.host || '',
      skola24_unit: c.skola24?.unit || '',
      skola24_class: c.skola24?.className || '',
      skola24_group: c.skola24?.group || '',
      school_menu_url: c.menuUrl,
      area: c.area,
      entities: c.entities,
      exclude: c.exclude,
    })),
    calendars: cfg.calendars,
    entities: cfg.entities,
    holidays: cfg.holidays,
  };
}
