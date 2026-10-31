import fs from 'node:fs';
import path from 'node:path';
import { AREA, ENTITY } from './config.mjs';

const MAX_IDS = 200;
const CHILD_KEY = /^[\p{L}\p{N} _-]{1,64}$/u;

/**
 * Settings changed from the dashboard's own settings page, kept in /data.
 * They sit on top of the add-on options: per child (by name) room, extra and
 * excluded entities, plus the parents' entities and calendars.
 */
export function createSettings(file = null) {
  let data = load(file);
  return {
    get: () => data,
    save(next) {
      data = validateSettings(next);
      if (file) {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
        fs.renameSync(tmp, file);
      }
      return data;
    },
  };
}

export function validateSettings(raw) {
  const ids = v => [...new Set((Array.isArray(v) ? v : []).filter(x => typeof x === 'string' && ENTITY.test(x)))].slice(0, MAX_IDS);
  const children = {};
  for (const [key, c] of Object.entries(raw?.children && typeof raw.children === 'object' ? raw.children : {})) {
    if (!CHILD_KEY.test(key)) continue;
    const area = typeof c?.area === 'string' && AREA.test(c.area) ? c.area : '';
    children[key.toLowerCase()] = { area, entities: ids(c?.entities), exclude: ids(c?.exclude) };
  }
  const out = { children };
  if (Array.isArray(raw?.entities)) out.entities = ids(raw.entities);
  if (Array.isArray(raw?.calendars)) out.calendars = ids(raw.calendars).filter(id => id.startsWith('calendar.'));
  return out;
}

/** The add-on options with the settings page's choices applied on top. */
export function applySettings(cfg, settings) {
  if (!settings) return cfg;
  return {
    ...cfg,
    entities: settings.entities ?? cfg.entities,
    calendars: settings.calendars ?? cfg.calendars,
    children: cfg.children.map(c => {
      const own = settings.children?.[c.name.toLowerCase()];
      return own ? { ...c, area: own.area, entities: own.entities, exclude: own.exclude } : c;
    }),
  };
}

function load(file) {
  if (!file || !fs.existsSync(file)) return validateSettings({});
  try {
    return validateSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    console.error('Inställningar: kunde inte läsa, börjar om: ' + e.message);
    return validateSettings({});
  }
}
