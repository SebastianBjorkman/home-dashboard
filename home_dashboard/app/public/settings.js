'use strict';

const MAX_RESULTS = 30;
const SKOLA24_LINK = /timetable-viewer\/([a-z0-9-]+\.skola24\.se)\/([^/?#]+)/i;
const DAYS = ['', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag'];

const $ = sel => document.querySelector(sel);

// All content is added with textContent, never as HTML.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

let options;
let catalog = { areas: [], entities: [] };
let haAvailable = false;
let uid = 0;

async function api(path, init = {}) {
  const res = await fetch(path, { cache: 'no-store', ...init });
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? null : res.json();
}

const query = params => new URLSearchParams(params).toString();

function showError(message) {
  $('#error').textContent = message;
  $('#error').hidden = false;
}

async function init() {
  try {
    const s = await api('api/settings');
    options = s.options;
    haAvailable = s.haAvailable;
  } catch (e) {
    $('#main').replaceChildren();
    return showError('Kunde inte hämta inställningarna: ' + e.message);
  }
  if (haAvailable) {
    try {
      catalog = await api('api/ha/catalog');
    } catch (e) {
      showError('Kunde inte hämta rum och enheter från Home Assistant: ' + e.message);
    }
  } else {
    showError('Home Assistant är inte ansluten, så rum, enheter och kalendrar kan inte väljas just nu. Skola, matsedel och lov går bra.');
  }
  // Rooms set by name in older add-on options become the area's id here.
  for (const c of options.children) {
    const match = catalog.areas.find(a => a.id === c.area || a.name.toLowerCase() === c.area.toLowerCase());
    if (match) c.area = match.id;
  }
  render();
}

function render() {
  const addChild = el('button', 'secondary', '+ Lägg till barn');
  addChild.type = 'button';
  addChild.addEventListener('click', () => {
    options.children.push({ name: '', ha_user: '', ha_user_id: '', skola24_host: '', skola24_unit: '', skola24_class: '', skola24_group: '', school_menu_url: '', area: '', entities: [], exclude: [] });
    render();
  });
  const addRow = el('div', 'add-row');
  addRow.append(addChild);
  $('#main').replaceChildren(...options.children.map(childSection), addRow, holidaySection(), familySection(), saveBar());
}

const nameOf = id => catalog.entities.find(e => e.id === id)?.name || id;

// ---------- Form helpers ----------

function field(labelText, control, hint) {
  const wrap = el('div', 'field');
  control.id ||= 'f' + ++uid;
  const label = el('label', 'field-label', labelText);
  label.htmlFor = control.id;
  wrap.append(label, control);
  if (hint) wrap.append(el('p', 'muted hint', hint));
  return wrap;
}

function textInput(value, onInput, attrs = {}) {
  const input = el('input');
  input.type = attrs.type || 'text';
  input.value = value || '';
  Object.assign(input, attrs);
  input.addEventListener('input', () => onInput(input.value.trim()));
  return input;
}

/** Fills a select; keeps the current value as an option even if the list lacks it. */
function fillSelect(select, values, current, emptyLabel) {
  select.replaceChildren(new Option(emptyLabel, ''));
  const all = current && !values.includes(current) ? [current, ...values] : values;
  for (const v of all) select.append(new Option(v, v));
  select.value = current || '';
}

// ---------- Child ----------

function childSection(c, index) {
  const card = el('section', 'card');
  const title = el('h2', null, c.name || 'Nytt barn');
  card.append(title);

  card.append(field('Namn', textInput(c.name, v => { c.name = v; title.textContent = v || 'Nytt barn'; })));

  const persons = catalog.entities.filter(e => e.domain === 'person' && e.userId);
  const account = el('select');
  account.append(new Option('Inget eget konto', ''));
  for (const p of persons) account.append(new Option(p.name, p.userId));
  account.value = c.ha_user_id || '';
  account.addEventListener('change', () => { c.ha_user_id = account.value; });
  card.append(field('Barnets konto i Home Assistant', account,
    c.ha_user && !c.ha_user_id ? `Kopplad via användarnamnet "${c.ha_user}". Välj personen här för att byta.` : 'När barnet loggar in med sitt konto visas bara barnvyn.'));

  card.append(el('h3', null, 'Skola'));
  card.append(...schoolFields(c));

  card.append(el('h3', null, 'Matsedel'));
  card.append(menuField(c));

  if (haAvailable) {
    card.append(el('h3', null, 'Rum och lampor'));
    card.append(...roomFields(c));
  }

  const remove = el('button', 'danger', 'Ta bort barnet');
  remove.type = 'button';
  remove.addEventListener('click', () => {
    if (!confirm(`Ta bort ${c.name || 'barnet'}? Det gäller först när du sparar.`)) return;
    options.children.splice(index, 1);
    render();
  });
  card.append(remove);
  return card;
}

function schoolFields(c) {
  const link = textInput('', v => {
    const m = v.match(SKOLA24_LINK);
    if (!m) return;
    c.skola24_host = m[1].toLowerCase();
    c.skola24_unit = decodeURIComponent(m[2]);
    c.skola24_class = '';
    c.skola24_group = '';
    host.value = c.skola24_host;
    loadUnits();
  }, { type: 'url', placeholder: 'https://web.skola24.se/timetable/timetable-viewer/…' });

  const host = textInput(c.skola24_host, v => { c.skola24_host = v.toLowerCase(); }, { placeholder: 'kommun.skola24.se' });
  host.addEventListener('change', () => loadUnits());
  const unit = el('select');
  const cls = el('select');
  const group = el('select');
  const status = el('p', 'muted hint');

  async function load(select, path, params, current, emptyLabel) {
    select.disabled = true;
    try {
      fillSelect(select, await api(`api/school/${path}?${query(params)}`), current, emptyLabel);
      status.textContent = '';
    } catch (e) {
      fillSelect(select, [], current, emptyLabel);
      status.textContent = e.message;
    }
    select.disabled = false;
  }
  async function loadUnits() {
    if (!c.skola24_host) return fillSelect(unit, [], '', 'Välj skola');
    await load(unit, 'units', { host: c.skola24_host }, c.skola24_unit, 'Välj skola');
    loadClasses();
  }
  async function loadClasses() {
    if (!c.skola24_unit) return fillSelect(cls, [], '', 'Välj klass');
    await load(cls, 'classes', { host: c.skola24_host, unit: c.skola24_unit }, c.skola24_class, 'Välj klass');
    loadGroups();
  }
  async function loadGroups() {
    if (!c.skola24_class) return fillSelect(group, [], '', 'Hela klassen');
    await load(group, 'groups', { host: c.skola24_host, unit: c.skola24_unit, class: c.skola24_class }, c.skola24_group, 'Hela klassen');
  }

  unit.addEventListener('change', () => { c.skola24_unit = unit.value; c.skola24_class = ''; c.skola24_group = ''; loadClasses(); });
  cls.addEventListener('change', () => { c.skola24_class = cls.value; c.skola24_group = ''; loadGroups(); });
  group.addEventListener('change', () => { c.skola24_group = group.value; });
  fillSelect(unit, [], c.skola24_unit, 'Välj skola');
  fillSelect(cls, [], c.skola24_class, 'Välj klass');
  fillSelect(group, [], c.skola24_group, 'Hela klassen');
  loadUnits();

  return [
    field('Schemalänk', link, 'Öppna schemat i Skola24, kopiera adressen och klistra in den här, så fylls kommun och skola i.'),
    field('Kommun i Skola24', host),
    field('Skola', unit),
    field('Klass', cls),
    field('Halvklass', group, 'Välj om klassen delas för vissa lektioner, så visas bara barnets lektioner.'),
    status,
  ];
}

function menuField(c) {
  const input = textInput(c.school_menu_url, v => { c.school_menu_url = v; }, { type: 'url', placeholder: 'https://…' });
  const test = el('button', 'secondary', 'Testa');
  test.type = 'button';
  const result = el('p', 'muted hint');
  test.addEventListener('click', async () => {
    if (!c.school_menu_url) return (result.textContent = 'Klistra in länken först.');
    test.disabled = true;
    result.textContent = 'Hämtar …';
    try {
      const week = await api('api/school/menu?' + query({ url: c.school_menu_url }));
      const first = Object.entries(week.days)[0];
      result.textContent = `Fungerar! Vecka ${week.week}, ${DAYS[first[0]].toLowerCase()}: ${first[1]}`;
    } catch (e) {
      result.textContent = 'Fungerar inte: ' + e.message;
    }
    test.disabled = false;
  });
  const row = el('div', 'inline');
  row.append(input, test);
  const wrap = field('Länk till matsedeln', row, 'Sidan där kommunen visar veckans meny för köket som lagar skolans mat.');
  wrap.append(result);
  return wrap;
}

function roomFields(c) {
  const select = el('select');
  select.append(new Option('Inget rum', ''));
  for (const a of [...catalog.areas].sort((x, y) => x.name.localeCompare(y.name, 'sv'))) select.append(new Option(a.name, a.id));
  select.value = c.area || '';
  const room = el('div', 'room');
  select.addEventListener('change', () => {
    c.area = select.value;
    loadRoom(c, room);
  });
  loadRoom(c, room);
  return [
    field('Rum', select),
    room,
    field('Fler enheter', picker(c.entities, catalog.entities, 'Sök lampa, sensor …'), 'T.ex. lampor utanför rummet. Visas under "Annat".'),
  ];
}

async function loadRoom(c, box) {
  if (!c.area) return box.replaceChildren();
  box.replaceChildren(el('p', 'muted', 'Hämtar rummets enheter …'));
  let items;
  try {
    items = await api('api/ha/area?id=' + encodeURIComponent(c.area));
  } catch (e) {
    return box.replaceChildren(el('p', 'status', 'Kunde inte hämta rummet: ' + e.message));
  }
  if (!items.length) return box.replaceChildren(el('p', 'muted', 'Inga lampor, strömbrytare eller temperatursensorer i det här rummet.'));

  const list = el('ul', 'checklist');
  for (const item of items) {
    const check = el('input');
    check.type = 'checkbox';
    check.checked = !c.exclude.includes(item.id);
    check.addEventListener('change', () => {
      c.exclude = check.checked ? c.exclude.filter(id => id !== item.id) : [...c.exclude, item.id];
    });
    const label = el('label');
    label.append(check, el('span', null, item.name), el('span', 'muted entity-id', item.id));
    const li = el('li');
    li.append(label);
    list.append(li);
  }
  box.replaceChildren(el('p', 'muted', 'Bocka ur det som inte ska synas eller kunna styras.'), list);
}

// ---------- Holidays ----------

function holidaySection() {
  const card = el('section', 'card');
  card.append(el('h2', null, 'Lov'), el('p', 'muted', 'Första lovdagen för nedräkningen "sovningar kvar". Datumen finns under läsårstider på kommunens webbplats.'));
  const list = el('div', 'holidays');

  function draw() {
    list.replaceChildren(...options.holidays.map((h, i) => {
      const row = el('div', 'holiday-row');
      const name = textInput(h.name, v => { h.name = v; }, { placeholder: 'Jullovet' });
      name.setAttribute('aria-label', 'Lovets namn');
      const date = textInput(h.start, v => { h.start = v; }, { type: 'date' });
      date.setAttribute('aria-label', 'Första lovdagen');
      const remove = el('button', 'icon', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Ta bort ' + (h.name || 'lovet'));
      remove.addEventListener('click', () => { options.holidays.splice(i, 1); draw(); });
      row.append(name, date, remove);
      return row;
    }));
  }

  const add = el('button', 'secondary', '+ Lägg till lov');
  add.type = 'button';
  add.addEventListener('click', () => {
    options.holidays.push({ name: '', start: '' });
    draw();
    list.lastElementChild?.querySelector('input')?.focus();
  });
  draw();
  card.append(list, add);
  return card;
}

// ---------- Family ----------

function familySection() {
  const card = el('section', 'card');
  card.append(el('h2', null, 'Familjevyn'), el('p', 'muted', 'Visas bara för vuxna.'));
  if (!haAvailable) {
    card.append(el('p', 'muted', 'Kräver att Home Assistant är ansluten.'));
    return card;
  }
  card.append(
    field('Enheter', picker(options.entities, catalog.entities, 'Sök enhet …')),
    field('Kalendrar', picker(options.calendars, catalog.entities.filter(e => e.domain === 'calendar'), 'Sök kalender …')),
  );
  return card;
}

// ---------- Search picker ----------

/** Chips for the chosen ids plus a search box that adds to `list` in place. */
function picker(list, choices, placeholder) {
  const wrap = el('div', 'picker');
  const chips = el('div', 'chips');
  const input = el('input');
  input.type = 'search';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  const results = el('ul', 'results');

  function drawChips() {
    chips.replaceChildren(...list.map(id => {
      const chip = el('span', 'chip', nameOf(id));
      const remove = el('button', null, '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Ta bort ' + nameOf(id));
      remove.addEventListener('click', () => {
        list.splice(list.indexOf(id), 1);
        drawChips();
      });
      chip.append(remove);
      return chip;
    }));
  }

  function search() {
    const q = input.value.trim().toLowerCase();
    const matches = choices
      .filter(o => !list.includes(o.id) && (!q || o.name.toLowerCase().includes(q) || o.id.includes(q)))
      .slice(0, MAX_RESULTS);
    results.replaceChildren(...matches.map(o => {
      const btn = el('button');
      btn.type = 'button';
      btn.append(el('span', null, o.name), el('span', 'muted entity-id', o.id));
      btn.addEventListener('click', () => {
        list.push(o.id);
        input.value = '';
        drawChips();
        results.replaceChildren();
        input.focus();
      });
      const li = el('li');
      li.append(btn);
      return li;
    }));
  }

  input.addEventListener('input', search);
  input.addEventListener('focus', search);
  input.addEventListener('keydown', e => { if (e.key === 'Escape') results.replaceChildren(); });
  // Close the results when focus leaves the picker, but not while clicking a result.
  wrap.addEventListener('focusout', e => { if (!wrap.contains(e.relatedTarget)) results.replaceChildren(); });
  drawChips();
  wrap.append(chips, input, results);
  return wrap;
}

// ---------- Save ----------

function saveBar() {
  const bar = el('div', 'save-bar');
  const button = el('button', 'primary', 'Spara');
  button.type = 'button';
  const status = el('span', 'muted');
  button.addEventListener('click', async () => {
    const unnamed = options.children.some(c => !c.name);
    const badHoliday = options.holidays.some(h => !h.name || !h.start);
    if (unnamed || badHoliday) {
      status.textContent = unnamed ? 'Ge alla barn ett namn.' : 'Fyll i namn och datum för alla lov, eller ta bort raden.';
      return;
    }
    button.disabled = true;
    status.textContent = 'Sparar …';
    try {
      await api('api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Home-Dashboard': '1' },
        body: JSON.stringify({ options }),
      });
      status.textContent = 'Sparat ✓';
    } catch (e) {
      status.textContent = 'Kunde inte spara: ' + e.message;
    }
    button.disabled = false;
  });
  bar.append(button, status);
  return bar;
}

init();
