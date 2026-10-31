import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLessons, filterGroup } from '../modules/skola24.mjs';
import { parseSitevisionMenu } from '../modules/schoolmenu.mjs';
import { nextHoliday } from '../modules/countdown.mjs';
import { summarizeDay, summarizeWeek } from '../lib/dashboard.mjs';
import { isoWeek, localDay } from '../lib/time.mjs';

const fixture = name => fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');

test('Skola24 lessons are normalized, sorted and stripped of breaks and teachers', () => {
  const { data } = JSON.parse(fixture('skola24-render.json'));
  const lessons = parseLessons(data.lessonInfo);
  assert.ok(lessons.length > 20);
  assert.ok(lessons.every(l => l.code !== 'RAST' && l.code !== 'OMBYTE'));
  assert.ok(lessons.every(l => !('teacher' in l) && !JSON.stringify(l).includes('XX')));
  const monday = lessons.filter(l => l.day === 1);
  assert.equal(monday[0].start, '08:00');
  const slojd = monday.find(l => l.room === 'Träslöjd');
  assert.deepEqual({ subject: slojd.subject, group: slojd.group }, { subject: 'Slöjd', group: '2B:1' });
});

test('sub-group filter keeps whole-class lessons and the chosen half', () => {
  const lessons = [
    { day: 1, start: '08:00', end: '09:00', code: 'SV', group: '2B:2/SV' },
    { day: 1, start: '08:00', end: '09:25', code: 'SL', group: '2B:1' },
    { day: 1, start: '09:50', end: '10:25', code: 'SO', group: '2B' },
  ];
  assert.deepEqual(filterGroup(lessons, '2B:1').map(l => l.code), ['SL', 'SO']);
  assert.deepEqual(filterGroup(lessons, '2b:2').map(l => l.code), ['SV', 'SO']);
  assert.equal(filterGroup(lessons, '').length, 3);
});

test('day summary finds start, end, current and next lesson', () => {
  const lessons = [
    { day: 2, start: '08:00', end: '09:00', subject: 'Matte' },
    { day: 2, start: '09:20', end: '10:00', subject: 'Svenska' },
    { day: 2, start: '12:00', end: '13:45', subject: 'Idrott' },
    { day: 3, start: '08:30', end: '12:00', subject: 'Bild' },
  ];
  const s = summarizeDay(lessons, 2, 8 * 60 + 30);
  assert.equal(s.start, '08:00');
  assert.equal(s.end, '13:45');
  assert.deepEqual(s.current.map(l => l.subject), ['Matte']);
  assert.equal(s.next.subject, 'Svenska');
  assert.equal(summarizeDay(lessons, 2, 9 * 60 + 10).current.length, 0);
  assert.deepEqual(summarizeWeek(lessons).map(w => w.start), [null, '08:00', '08:30', null, null]);
});

test('Sitevision menu page is parsed into week, green dish and weekdays', () => {
  const [week] = parseSitevisionMenu(fixture('sitevision-menu.html'));
  assert.equal(week.week, 45);
  assert.equal(week.green, 'Pasta Paprigano');
  assert.equal(week.days[2], 'Festlig fiskgratäng, potatis');
  assert.match(week.days[3], /^KLIMATONSDAG: Ärtfalafel/);
  assert.deepEqual(Object.keys(week.days), ['1', '2', '3', '4', '5']);
});

test('menu parser handles entities and returns nothing for unrelated pages', () => {
  const html = '<li class="sv-channel-item"><h2><a><span>Vecka 2</span></a></h2><span><strong>M&Aring;NDAG:</strong></span><span>Fisk &amp; potatis</span></li>';
  assert.deepEqual(parseSitevisionMenu(html), [{ week: 2, green: null, days: { 1: 'Fisk & potatis' } }]);
  assert.deepEqual(parseSitevisionMenu('<html><body>Hej</body></html>'), []);
});

test('countdown counts nights to the next holiday that has not started', () => {
  const holidays = [{ name: 'Jullov', start: '2026-12-21' }, { name: 'Höstlov', start: '2026-10-26' }];
  assert.deepEqual(nextHoliday(holidays, '2026-12-14'), { name: 'Jullov', start: '2026-12-21', nights: 7 });
  assert.equal(nextHoliday(holidays, '2026-12-21'), null);
});

test('ISO weeks and local days follow the household time zone', () => {
  assert.deepEqual(isoWeek('2026-11-02'), { dow: 1, week: 45, weekYear: 2026 });
  assert.deepEqual(isoWeek('2027-01-01'), { dow: 5, week: 53, weekYear: 2026 });
  const late = localDay(new Date('2026-10-31T23:30:00Z'), 'Europe/Stockholm');
  assert.equal(late.iso, '2026-11-01');
  assert.equal(late.dow, 7);
});
