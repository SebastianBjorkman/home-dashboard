import { daysBetween } from '../lib/time.mjs';

/** Next holiday that has not started yet, as nights left ("sovningar kvar"). */
export function nextHoliday(holidays, todayIso) {
  const upcoming = holidays
    .filter(h => h.start > todayIso)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  return upcoming ? { name: upcoming.name, start: upcoming.start, nights: daysBetween(todayIso, upcoming.start) } : null;
}
