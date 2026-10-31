'use strict';

const MAX_RESULTS = 30;

const $ = sel => document.querySelector(sel);

// All content is added with textContent, never as HTML.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

let state;
let catalog;

async function api(path, options = {}) {
  const res = await fetch(path, { cache: 'no-store', ...options });
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? null : res.json();
}

function showError(message) {
  $('#error').textContent = message;
  $('#error').hidden = false;
  $('#main').replaceChildren();
}

async function init() {
  try {
    state = await api('api/settings');
    if (!state.haAvailable) return showError('Home Assistant är inte ansluten. Starta om tillägget och titta i loggen.');
    catalog = await api('api/ha/catalog');
  } catch (e) {
    return showError('Kunde inte hämta inställningarna: ' + e.message);
  }
  // Rooms set by name in the add-on options become the area's id here.
  for (const c of state.children) {
    const match = catalog.areas.find(a => a.id === c.area || a.name.toLowerCase() === c.area.toLowerCase());
    c.area = match ? match.id : '';
  }
  render();
}

function render() {
  $('#main').replaceChildren(...state.children.map(childSection), familySection(), saveBar());
}

const nameOf = id => catalog.entities.find(e => e.id === id)?.name || id;

// ---------- Child ----------

function childSection(c) {
  const card = el('section', 'card');
  card.append(el('h2', null, c.name));

  const select = el('select');
  select.id = 'area-' + c.key;
  select.append(new Option('Inget rum', ''));
  for (const a of [...catalog.areas].sort((x, y) => x.name.localeCompare(y.name, 'sv'))) select.append(new Option(a.name, a.id));
  select.value = c.area;

  const label = el('label', 'field-label', 'Rum');
  label.htmlFor = select.id;
  const room = el('div', 'room');
  select.addEventListener('change', () => {
    c.area = select.value;
    loadRoom(c, room);
  });
  card.append(label, select, room);
  loadRoom(c, room);

  card.append(
    el('h3', null, 'Fler enheter'),
    el('p', 'muted', 'T.ex. lampor utanför rummet. Visas under "Annat".'),
    picker(c.entities, catalog.entities, 'Sök lampa, sensor …'),
  );
  return card;
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
    const box2 = el('input');
    box2.type = 'checkbox';
    box2.checked = !c.exclude.includes(item.id);
    box2.addEventListener('change', () => {
      c.exclude = box2.checked ? c.exclude.filter(id => id !== item.id) : [...c.exclude, item.id];
    });
    const label = el('label');
    label.append(box2, el('span', null, item.name), el('span', 'muted entity-id', item.id));
    const li = el('li');
    li.append(label);
    list.append(li);
  }
  box.replaceChildren(el('p', 'muted', 'Bocka ur det som inte ska synas eller kunna styras.'), list);
}

// ---------- Family ----------

function familySection() {
  const card = el('section', 'card');
  card.append(
    el('h2', null, 'Familjevyn'),
    el('p', 'muted', 'Visas bara för vuxna.'),
    el('h3', null, 'Enheter'),
    picker(state.entities, catalog.entities, 'Sök enhet …'),
    el('h3', null, 'Kalendrar'),
    picker(state.calendars, catalog.entities.filter(e => e.domain === 'calendar'), 'Sök kalender …'),
  );
  return card;
}

// ---------- Search picker ----------

/** Chips for the chosen ids plus a search box that adds to `list` in place. */
function picker(list, options, placeholder) {
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
    const matches = options
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
    button.disabled = true;
    status.textContent = 'Sparar …';
    try {
      await api('api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Home-Dashboard': '1' },
        body: JSON.stringify({
          children: Object.fromEntries(state.children.map(c => [c.key, { area: c.area, entities: c.entities, exclude: c.exclude }])),
          entities: state.entities,
          calendars: state.calendars,
        }),
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
