'use strict';

const DAYS = ['', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];
const SHORT_DAYS = ['', 'Mån', 'Tis', 'Ons', 'Tor', 'Fre'];
const REFRESH_MS = 60_000;

const $ = sel => document.querySelector(sel);
const params = new URLSearchParams(location.search);

// All content is added with textContent, never as HTML.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
const toMinutes = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const nights = n => `${n} ${n === 1 ? 'sovning' : 'sovningar'}`;

function tickClock() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  $('#date').textContent = capitalize(now.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }));
}

async function load() {
  const view = params.get('view');
  try {
    const res = await fetch('api/dashboard' + (view ? '?view=' + encodeURIComponent(view) : ''), { cache: 'no-store' });
    if (!res.ok) throw new Error(await res.text());
    render(await res.json());
    $('#offline').hidden = true;
  } catch (e) {
    $('#offline').textContent = 'Kunde inte uppdatera: ' + e.message;
    $('#offline').hidden = false;
  }
}

function render(d) {
  document.body.dataset.view = d.view;
  const first = d.children[0];
  $('#greeting').textContent = d.view === 'kid' && first ? `Hej ${first.name}!` : `Hej ${d.user.name}`;

  const sw = $('#switch');
  sw.hidden = d.role !== 'parent';
  sw.textContent = d.view === 'kid' ? 'Familjevy' : 'Barnvy';
  sw.href = d.view === 'kid' ? '?' : '?view=kid';

  const cards = d.view === 'kid' ? kidView(d) : familyView(d);
  $('#main').replaceChildren(...cards);
}

// ---------- Family view ----------

function familyView(d) {
  const cards = d.children.map(c => childCard(c, d));
  if (d.countdown) cards.push(countdownCard(d.countdown));
  if (d.calendar) cards.push(calendarCard(d.calendar));
  if (d.entities?.length) cards.push(entitiesCard(d.entities));
  if (d.status.length) cards.push(statusCard(d.status));
  if (!cards.length) cards.push(el('p', 'empty', 'Inget att visa ännu. Lägg till barn, kalendrar eller enheter i tilläggets inställningar.'));
  return cards;
}

function childCard(c, d) {
  const card = el('section', 'card child');
  const head = el('h2', null, c.name);
  if (c.className) head.append(el('span', 'muted', ' · ' + c.className));
  card.append(head);

  const s = c.schedule;
  const dayLabel = d.schoolDay.isToday ? 'Idag' : capitalize(DAYS[d.schoolDay.dow]);
  if (s?.start) {
    card.append(el('p', 'span', `${dayLabel} ${s.start}–${s.end}`));
    const list = el('ol', 'lessons');
    for (const l of s.lessons) {
      const li = el('li', lessonState(l, d));
      li.append(el('span', 'time', `${l.start}–${l.end}`), el('span', 'subject', l.subject));
      if (l.room) li.append(el('span', 'room', l.room));
      list.append(li);
    }
    card.append(list);
  } else if (c.schedule) {
    card.append(el('p', 'span', `${dayLabel}: ingen skola enligt schemat`));
  }

  if (c.lunch?.today) {
    const lunch = el('p', 'lunch');
    lunch.append(el('span', 'label', 'Lunch '), document.createTextNode(c.lunch.today));
    card.append(lunch);
  }
  if (c.devices?.length) card.append(...childDevices(c.devices));
  card.append(...c.status.map(statusLine));
  return card;
}

/** Room devices under "Mitt rum", hand-picked ones from elsewhere under "Annat". */
function childDevices(devices) {
  const room = devices.filter(d => d.inRoom);
  const other = devices.filter(d => !d.inRoom);
  if (!room.length) return [el('p', 'label', 'Mina lampor'), deviceTiles(other)];
  const nodes = [el('p', 'label', 'Mitt rum'), deviceTiles(room)];
  if (other.length) nodes.push(el('p', 'label', 'Annat'), deviceTiles(other));
  return nodes;
}

function lessonState(l, d) {
  if (!d.schoolDay.isToday) return '';
  const now = d.today.minutes;
  if (toMinutes(l.end) <= now) return 'past';
  if (toMinutes(l.start) <= now) return 'now';
  return '';
}

function countdownCard(cd) {
  const card = el('section', 'card countdown');
  card.append(el('p', 'big', nights(cd.nights)), el('p', null, `kvar till ${cd.name.toLowerCase()}`));
  return card;
}

function calendarCard(cal) {
  const card = el('section', 'card calendar');
  card.append(el('h2', null, 'Kalender'));
  for (const [label, events] of [['Idag', cal.today], ['Imorgon', cal.tomorrow]]) {
    card.append(el('h3', null, label));
    if (!events.length) { card.append(el('p', 'muted', 'Inget inplanerat')); continue; }
    const list = el('ul', 'events');
    for (const e of events) {
      const li = el('li');
      li.append(el('span', 'time', e.allDay ? 'Heldag' : new Date(e.start).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })), el('span', null, e.summary));
      list.append(li);
    }
    card.append(list);
  }
  return card;
}

function entitiesCard(entities) {
  const card = el('section', 'card entities');
  card.append(el('h2', null, 'Hemma'), deviceTiles(entities));
  return card;
}

const STATE_TEXT = { on: 'På', off: 'Av', unavailable: 'Ej nåbar' };

function deviceTiles(devices) {
  const grid = el('div', 'tiles');
  for (const e of devices) {
    const on = e.state === 'on';
    const tile = el(e.switchable ? 'button' : 'div', 'tile' + (e.error ? ' error' : '') + (on ? ' on' : ''));
    const state = e.error ? 'Saknas' : STATE_TEXT[e.state] || `${e.state}${e.unit ? ' ' + e.unit : ''}`;
    tile.append(el('span', 'tile-name', e.name), el('span', 'tile-state', state));
    if (e.switchable) {
      tile.type = 'button';
      tile.setAttribute('aria-pressed', String(on));
      tile.addEventListener('click', () => toggleDevice(e.id, tile));
    }
    grid.append(tile);
  }
  return grid;
}

async function toggleDevice(entityId, tile) {
  tile.disabled = true;
  tile.classList.toggle('on');
  try {
    const res = await fetch('api/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Home-Dashboard': '1' },
      body: JSON.stringify({ entity_id: entityId }),
    });
    if (!res.ok) throw new Error(await res.text());
  } catch (e) {
    tile.classList.toggle('on');
    $('#offline').textContent = 'Kunde inte styra: ' + e.message;
    $('#offline').hidden = false;
  }
  load();
}

function statusCard(status) {
  const card = el('section', 'card');
  card.append(...status.map(statusLine));
  return card;
}

function statusLine(s) {
  return el('p', 'status', `${s.source}: ${s.message}${s.stale ? ' (visar senast hämtade)' : ''}`);
}

// ---------- Kid view ----------

function kidView(d) {
  const c = d.children[0];
  if (!c) return [el('p', 'empty', 'Inget barn kopplat till den här användaren ännu.')];
  const cards = [kidToday(c, d)];
  if (c.devices?.length) {
    const lights = el('section', 'card kid-devices');
    lights.append(...childDevices(c.devices));
    cards.push(lights);
  }
  if (c.lunch?.today) {
    const lunch = el('section', 'card kid-lunch');
    lunch.append(el('p', 'label', d.schoolDay.isToday ? 'Lunch idag' : `Lunch på ${DAYS[d.schoolDay.dow]}`), el('p', 'big-text', c.lunch.today));
    cards.push(lunch);
  }
  if (d.countdown) cards.push(countdownCard(d.countdown));
  if (c.week) cards.push(weekStrip(c.week, d));
  cards.push(...c.status.map(statusLine));
  return cards;
}

function kidToday(c, d) {
  const card = el('section', 'card kid-hero');
  const s = c.schedule;
  if (!s?.start) {
    card.append(el('p', 'big-text', d.schoolDay.isToday ? 'Ingen skola idag!' : 'Ingen skola i schemat.'));
    return card;
  }
  if (!d.schoolDay.isToday) {
    card.append(el('p', 'big-text', 'Det är helg!'), el('p', null, `På ${DAYS[d.schoolDay.dow]} börjar skolan ${s.start}.`));
    return card;
  }
  const now = d.today.minutes;
  if (now >= toMinutes(s.end)) {
    card.append(el('p', 'big-text', 'Skolan är slut för idag.'));
  } else if (now < toMinutes(s.start)) {
    card.append(el('p', 'big-text', `Skolan börjar ${s.start}`), el('p', null, `och slutar ${s.end}`));
  } else {
    const current = s.current.map(l => l.subject).join(' / ');
    card.append(el('p', 'label', 'Nu'), el('p', 'big-text', current || 'Rast'));
    if (s.next) card.append(el('p', null, `Sedan: ${s.next.subject} ${s.next.start}`));
    card.append(el('p', 'muted', `Skolan slutar ${s.end}`));
  }
  return card;
}

function weekStrip(week, d) {
  const card = el('section', 'card week');
  const row = el('div', 'week-row');
  for (const w of week) {
    const day = el('div', 'week-day' + (w.day === d.schoolDay.dow ? ' current' : ''));
    day.append(el('span', 'week-name', SHORT_DAYS[w.day]), el('span', 'week-time', w.start ? `${w.start}–${w.end}` : 'Ledigt'));
    row.append(day);
  }
  card.append(row);
  return card;
}

tickClock();
setInterval(tickClock, 10_000);
load();
setInterval(load, REFRESH_MS);
