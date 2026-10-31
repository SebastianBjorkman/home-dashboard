// Calendar helpers that work on local dates in the household's time zone,
// so the container's clock setting never shifts "today".

export function localDay(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map(p => [p.type, p.value]),
  );
  const iso = `${parts.year}-${parts.month}-${parts.day}`;
  return { iso, minutes: Number(parts.hour) * 60 + Number(parts.minute), ...isoWeek(iso) };
}

/** ISO 8601 week, weekday (1 = Monday) and year for a YYYY-MM-DD date. */
export function isoWeek(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return { dow, week: Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7), weekYear: d.getUTCFullYear() };
}

export function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / 86_400_000);
}

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
