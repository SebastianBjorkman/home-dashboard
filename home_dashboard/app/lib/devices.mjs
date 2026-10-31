import * as ha from '../modules/homeassistant.mjs';

const AREA_TTL_MS = 5 * 60_000;

// What we pick up automatically from a room. Sensors are narrowed further to
// temperature/humidity once their states are known, so batteries and other
// diagnostics stay out. Anything else can be added by hand under `entities`.
const AREA_DOMAINS = new Set(['light', 'switch', 'fan', 'input_boolean', 'sensor']);
const AREA_SENSOR_CLASSES = new Set(['temperature', 'humidity']);

const domain = id => id.split('.')[0];

/**
 * A child's devices: room (area) entities, then extra entities, minus excluded.
 * Returns { ids, inRoom: Set, entry } where entry is the area lookup (for status).
 */
export async function resolveChildEntities(child, cache) {
  let fromArea = [];
  let entry = null;
  if (child.area && ha.available()) {
    entry = await cache.get('area:' + child.area.toLowerCase(), AREA_TTL_MS, () => ha.fetchAreaEntities(child.area));
    fromArea = (entry.data || []).filter(id => AREA_DOMAINS.has(domain(id)));
  }
  const excluded = new Set(child.exclude);
  const ids = [...new Set([...fromArea, ...child.entities])].filter(id => !excluded.has(id));
  return { ids, inRoom: new Set(fromArea), entry };
}

/** The room entities the dashboard would show, with names, for the settings page. */
export function roomCandidates(areaIds, catalog) {
  const byId = new Map(catalog.map(e => [e.id, e]));
  return areaIds
    .map(id => byId.get(id))
    .filter(e => e && AREA_DOMAINS.has(e.domain) && (e.domain !== 'sensor' || AREA_SENSOR_CLASSES.has(e.deviceClass)))
    .map(e => ({ id: e.id, name: e.name }));
}

/** Drops room sensors that are not temperature/humidity; hand-picked ones always stay. */
export function keepUsefulRoomSensors(states, inRoom, manual) {
  const picked = new Set(manual);
  return states.filter(s => domain(s.id) !== 'sensor' || picked.has(s.id) || !inRoom.has(s.id) || AREA_SENSOR_CLASSES.has(s.deviceClass));
}
