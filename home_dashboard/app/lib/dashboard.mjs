import { addDays, isoWeek, localDay, toMinutes } from './time.mjs';
import { filterGroup, fetchWeek, resolveClass } from '../modules/skola24.mjs';
import { fetchMenu } from '../modules/schoolmenu.mjs';
import { nextHoliday } from '../modules/countdown.mjs';
import * as ha from '../modules/homeassistant.mjs';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Builds everything one viewer may see. A child only gets their own schedule,
 * lunch and the countdown; family calendars and home devices are for parents.
 */
export async function buildDashboard({ cfg, cache, identity, view, now = new Date() }) {
  const today = localDay(now, cfg.timezone);
  const isChild = identity.role === 'child';

  // On weekends, school info is about the coming Monday.
  const schoolIso = today.dow > 5 ? addDays(today.iso, 8 - today.dow) : today.iso;
  const schoolDay = { iso: schoolIso, ...isoWeek(schoolIso), isToday: schoolIso === today.iso };

  const kids = isChild ? cfg.children.filter(c => c.id === identity.childId) : cfg.children;
  const result = {
    role: identity.role,
    view: isChild || view === 'kid' ? 'kid' : 'family',
    user: { name: identity.user.displayName },
    today: { iso: today.iso, dow: today.dow, week: today.week, minutes: today.minutes },
    schoolDay: { iso: schoolDay.iso, dow: schoolDay.dow, isToday: schoolDay.isToday },
    children: await Promise.all(kids.map(c => childData(c, { cache, today, schoolDay }))),
    countdown: nextHoliday(cfg.holidays, today.iso),
    status: [],
  };

  if (!isChild) Object.assign(result, await homeData(cfg, cache, today, result.status));
  return result;
}

async function childData(child, { cache, today, schoolDay }) {
  const out = { id: child.id, name: child.name, className: child.skola24?.className || null, schedule: null, week: null, lunch: null, status: [] };

  if (child.skola24) {
    const s = child.skola24;
    const refKey = `s24ref:${s.host}:${s.unit}:${s.className}`.toLowerCase();
    const ref = await cache.get(refKey, 24 * HOUR, () => resolveClass(s));
    let entry = ref;
    if (ref.data) {
      const mondayIso = addDays(schoolDay.iso, 1 - schoolDay.dow);
      entry = await cache.get(`${refKey}:${schoolDay.weekYear}-${schoolDay.week}`, HOUR,
        () => fetchWeek(ref.data, { weekYear: schoolDay.weekYear, week: schoolDay.week, mondayIso }));
      if (entry.data) {
        const lessons = filterGroup(entry.data, s.group);
        out.schedule = summarizeDay(lessons, schoolDay.dow, schoolDay.isToday ? today.minutes : -1);
        out.week = summarizeWeek(lessons);
      }
    }
    note(out.status, 'Skolschema', entry);
  }

  if (child.menuUrl) {
    const menu = await cache.get('menu:' + child.menuUrl, 3 * HOUR, () => fetchMenu(child.menuUrl));
    const week = menu.data?.find(w => w.week === schoolDay.week);
    if (week) out.lunch = { week: week.week, today: week.days[schoolDay.dow] || null, green: week.green, days: week.days };
    note(out.status, 'Skolmat', menu);
  }

  return out;
}

async function homeData(cfg, cache, today, status) {
  if (!cfg.calendars.length && !cfg.entities.length) return {};
  if (!ha.available()) {
    status.push({ source: 'Home Assistant', message: 'Inte ansluten (körs utanför Home Assistant)' });
    return {};
  }
  const out = {};
  if (cfg.calendars.length) {
    const tomorrow = addDays(today.iso, 1);
    const cal = await cache.get('calendar:' + today.iso, 5 * MINUTE, () => ha.fetchEvents(cfg.calendars, today.iso, addDays(today.iso, 2)));
    const events = cal.data || [];
    out.calendar = {
      today: events.filter(e => String(e.start).slice(0, 10) <= today.iso && String(e.end).slice(0, 10) >= today.iso),
      tomorrow: events.filter(e => String(e.start).slice(0, 10) === tomorrow),
    };
    note(status, 'Kalender', cal);
  }
  if (cfg.entities.length) {
    const states = await cache.get('states', 30_000, () => ha.fetchStates(cfg.entities));
    out.entities = states.data || [];
    note(status, 'Home Assistant', states);
  }
  return out;
}

export function summarizeDay(lessons, dow, nowMinutes) {
  const day = lessons.filter(l => l.day === dow);
  if (!day.length) return { lessons: [], start: null, end: null, current: [], next: null };
  const end = day.reduce((max, l) => (l.end > max ? l.end : max), day[0].end);
  return {
    lessons: day,
    start: day[0].start,
    end,
    current: day.filter(l => toMinutes(l.start) <= nowMinutes && nowMinutes < toMinutes(l.end)),
    next: day.find(l => toMinutes(l.start) > nowMinutes) || null,
  };
}

export function summarizeWeek(lessons) {
  return [1, 2, 3, 4, 5].map(day => {
    const l = lessons.filter(x => x.day === day);
    return { day, start: l[0]?.start || null, end: l.reduce((max, x) => (x.end > max ? x.end : max), '') || null };
  });
}

function note(list, source, entry) {
  if (!entry.error) return;
  list.push({
    source,
    message: entry.code === 'blocked' ? 'Webbplatsen tillåter inte automatisk hämtning just nu' : entry.error,
    stale: entry.data != null,
    since: entry.at,
  });
}
