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
