import { getJson, request } from '../lib/http.mjs';

// Talks to Home Assistant through the Supervisor proxy. The token is injected
// by the Supervisor (homeassistant_api: true) and never leaves the server.
const base = () => process.env.HD_HA_URL || 'http://supervisor/core/api';
const auth = () => ({ Authorization: 'Bearer ' + process.env.SUPERVISOR_TOKEN });

export const available = () => Boolean(process.env.SUPERVISOR_TOKEN);

const ha = path => getJson(base() + path, auth());

export async function fetchStates(entityIds) {
  return Promise.all(entityIds.map(async id => {
    try {
      const s = await ha('/states/' + encodeURIComponent(id));
      return {
        id,
        name: s.attributes?.friendly_name || id,
        state: s.state,
        unit: s.attributes?.unit_of_measurement || null,
        deviceClass: s.attributes?.device_class || null,
      };
    } catch (e) {
      return { id, name: id, state: null, error: e.message };
    }
  }));
}

/**
 * Entity ids in a Home Assistant area (by name or id), including entities of
 * devices placed in it, without hidden ones. The name is validated in config.
 */
export async function fetchAreaEntities(area) {
  const template = `{{ area_entities(${JSON.stringify(area)}) | reject('is_hidden_entity') | list | tojson }}`;
  const text = await request(`${base()}/template`, {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ template }),
  });
  const ids = JSON.parse(text);
  return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [];
}

/** All areas as [{ id, name }], for the settings page. */
export async function fetchAreas() {
  const template = "{% set ns = namespace(out=[]) %}{% for a in areas() %}{% set ns.out = ns.out + [{'id': a, 'name': area_name(a)}] %}{% endfor %}{{ ns.out | tojson }}";
  const text = await request(`${base()}/template`, {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ template }),
  });
  const areas = JSON.parse(text);
  return (Array.isArray(areas) ? areas : []).filter(a => typeof a?.id === 'string').map(a => ({ id: a.id, name: String(a.name || a.id) }));
}

/**
 * Every entity as { id, name, domain, deviceClass }, for searching on the
 * settings page. Persons also carry the user id of their login, if any.
 */
export async function fetchAllEntities() {
  const states = await ha('/states');
  return states
    .map(s => ({
      id: s.entity_id,
      name: s.attributes?.friendly_name || s.entity_id,
      domain: s.entity_id.split('.')[0],
      deviceClass: s.attributes?.device_class || null,
      ...(s.entity_id.startsWith('person.') && s.attributes?.user_id ? { userId: s.attributes.user_id } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}

/** Toggles a light/switch/fan/input_boolean. Callers must check permissions first. */
export async function toggle(entityId) {
  const domain = entityId.split('.')[0];
  await request(`${base()}/services/${domain}/toggle`, {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ entity_id: entityId }),
  });
}

/** Events between two YYYY-MM-DD dates (end exclusive) across calendars, sorted. */
export async function fetchEvents(calendarIds, startIso, endIso) {
  const lists = await Promise.all(calendarIds.map(async id => {
    const events = await ha(`/calendars/${encodeURIComponent(id)}?start=${startIso}T00:00:00&end=${endIso}T00:00:00`);
    return events.map(e => ({
      calendar: id,
      summary: e.summary || '(utan titel)',
      location: e.location || null,
      allDay: Boolean(e.start?.date),
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
    }));
  }));
  return lists.flat().sort((a, b) => String(a.start).localeCompare(String(b.start)));
}
