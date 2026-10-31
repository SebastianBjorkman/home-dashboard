import { postJson } from '../lib/http.mjs';

// Skola24's public timetable viewer (web.skola24.se/timetable/timetable-viewer).
// Not an official API: these are the same calls the viewer makes. Class
// timetables are only available where the school allows anonymous viewing.
const API = 'https://web.skola24.se/api/';
const SCOPE = '8a22163c-8662-4535-9050-bc5e1923df48';
const CLASS_SELECTION = 0;

const HIDDEN = new Set(['RAST', 'OMBYTE']);

export const SUBJECTS = {
  BL: 'Bild', EN: 'Engelska', HKK: 'Hemkunskap', IDH: 'Idrott', LUNCH: 'Lunch',
  MA: 'Matte', MU: 'Musik', NO: 'NO', SL: 'Slöjd', SO: 'SO', SV: 'Svenska',
  SVA: 'Svenska som andraspråk', TK: 'Teknik', ML: 'Modersmål',
};

async function call(path, body) {
  const res = await postJson(API + path, body, { 'X-Scope': SCOPE, 'X-Requested-With': 'XMLHttpRequest' });
  if (res.error || res.exception) throw new Error('Skola24: ' + (res.error || res.exception));
  if (res.validation?.length) throw new Error('Skola24: ' + res.validation.map(v => v.message).join(', '));
  return res.data;
}

/** Looks up the ids Skola24 needs for a school + class. Cache the result (it rarely changes). */
export async function resolveClass({ host, unit, className }) {
  const units = await call('services/skola24/get/timetable/viewer/units', { getTimetableViewerUnitsRequest: { hostName: host } });
  const found = units.getTimetableViewerUnitsResponse.units.find(u => u.unitId.toLowerCase() === unit.toLowerCase());
  if (!found) throw new Error(`Hittar inte skolan "${unit}" på ${host}`);
  if (!found.anonymous?.classes) throw new Error(`${found.unitId} visar inte klasscheman utan inloggning`);

  const years = await call('get/active/school/years', { hostName: host, checkSchoolYearsFeatures: false });
  const selection = await call('get/timetable/selection', {
    hostName: host,
    unitGuid: found.unitGuid,
    filters: { class: true, course: false, group: false, period: false, room: false, student: false, subject: false, teacher: false },
  });
  const cls = selection.classes.find(c => c.groupName.toLowerCase() === className.toLowerCase());
  if (!cls) throw new Error(`Hittar inte klassen "${className}" på ${found.unitId}`);

  return {
    host,
    unitGuid: found.unitGuid,
    groupGuid: cls.groupGuid,
    schoolYears: years.activeSchoolYears.map(y => ({ guid: y.guid, from: y.from.slice(0, 10), to: y.to.slice(0, 10) })),
  };
}

/** Raw lessons for one ISO week. `mondayIso` picks the right school year. */
export async function fetchWeek(ref, { weekYear, week, mondayIso }) {
  const year = ref.schoolYears.find(y => y.from <= mondayIso && mondayIso <= y.to) || ref.schoolYears[0];
  if (!year) throw new Error('Skola24 har inget aktivt läsår');
  const { key } = await call('get/timetable/render/key', null);
  const data = await call('render/timetable', {
    renderKey: key, host: ref.host, unitGuid: ref.unitGuid, schoolYear: year.guid,
    startDate: null, endDate: null, scheduleDay: 0, blackAndWhite: false, width: 1200, height: 800,
    selectionType: CLASS_SELECTION, selection: ref.groupGuid, showHeader: false, periodText: '',
    week, year: weekYear, privateFreeTextMode: null, privateSelectionMode: false, customerKey: '',
  });
  return parseLessons(data.lessonInfo || []);
}

/**
 * Normalizes Skola24 lessonInfo. texts are [subject, teachers, "room,group"].
 * Teacher initials are deliberately dropped: the dashboard does not need them.
 */
export function parseLessons(lessonInfo) {
  return lessonInfo
    .map(l => {
      const [code = '', , place = ''] = l.texts || [];
      const comma = place.lastIndexOf(',');
      const subject = code.trim();
      return {
        day: l.dayOfWeekNumber,
        start: l.timeStart.slice(0, 5),
        end: l.timeEnd.slice(0, 5),
        code: subject.toUpperCase(),
        subject: SUBJECTS[subject.toUpperCase()] || subject,
        room: (comma >= 0 ? place.slice(0, comma) : '').trim(),
        group: (comma >= 0 ? place.slice(comma + 1) : place).trim(),
      };
    })
    .filter(l => l.code && !HIDDEN.has(l.code))
    .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

/**
 * Keeps lessons for the whole class plus the chosen sub-group.
 * "2B" = whole class, "2B:1" / "2B:2/SVA" = half-class lessons.
 */
export function filterGroup(lessons, group) {
  if (!group) return lessons;
  const want = group.toLowerCase();
  return lessons.filter(l => {
    const sub = l.group.split('/')[0].toLowerCase();
    return !sub.includes(':') || sub === want;
  });
}
