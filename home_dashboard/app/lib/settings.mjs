import fs from 'node:fs';
import path from 'node:path';
import { AREA, ENTITY, normalizeConfig, toOptions } from './config.mjs';

const MAX_IDS = 200;
const CHILD_KEY = /^[\p{L}\p{N} _-]{1,64}$/u;

/**
 * Settings saved from the dashboard's settings page, kept in /data.
 * Version 2 holds the whole configuration (same shape as the add-on options)
 * and replaces the options entirely. Version 1 (0.4.0) only held per-child
 * device choices on top of the options, and is still understood.
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
  if (raw?.version === 2) return { version: 2, options: toOptions(normalizeConfig(raw.options || {})) };
  return validateLegacy(raw);
}

/** The configuration in effect: saved settings if any, otherwise the add-on options. */
export function applySettings(cfg, settings) {
  if (!settings) return cfg;
  if (settings.version === 2) return normalizeConfig(settings.options);
  return applyLegacy(cfg, settings);
}

// ---------- Version 1 (0.4.0) ----------

function validateLegacy(raw) {
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

function applyLegacy(cfg, settings) {
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
  if (!file || !fs.existsSync(file)) return null;
  try {
    return validateSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    console.error('Inställningar: kunde inte läsa, använder tilläggets inställningar: ' + e.message);
    return null;
  }
}
