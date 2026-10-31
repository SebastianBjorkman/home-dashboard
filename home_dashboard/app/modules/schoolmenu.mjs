import { request } from '../lib/http.mjs';

// Weekly school lunch menus published as Sitevision "archive" lists, which is
// how many Swedish municipalities publish each kitchen's menu.
const LABEL = /^(VECKANS GRÖNA|MÅNDAG|TISDAG|ONSDAG|TORSDAG|FREDAG)\s*:?\s*(.*)$/iu;
const DAY = { 'MÅNDAG': 1, 'TISDAG': 2, 'ONSDAG': 3, 'TORSDAG': 4, 'FREDAG': 5 };

export async function fetchMenu(url) {
  const weeks = parseSitevisionMenu(await request(url, { headers: { Accept: 'text/html' } }));
  if (!weeks.length) throw new Error('Hittade ingen matsedel på sidan – sidans uppbyggnad kan ha ändrats');
  return weeks;
}

/** Returns [{ week, green, days: { 1: 'dish', ... 5: 'dish' } }] */
export function parseSitevisionMenu(html) {
  const items = [...html.matchAll(/<li class="sv-channel-item">([\s\S]*?)<\/li>/g)].map(m => m[1]);
  return items.map(parseItem).filter(w => w.week && Object.keys(w.days).length);
}

function parseItem(itemHtml) {
  const lines = decodeEntities(
    itemHtml
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(span|h2|p|div|strong|a)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const heading = lines.find(l => /^vecka\s+\d+/i.test(l));
  const result = { week: heading ? Number(heading.match(/\d+/)[0]) : null, green: null, days: {} };

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LABEL);
    if (!m) continue;
    let text = m[2];
    if (!text && lines[i + 1] && !LABEL.test(lines[i + 1])) text = lines[++i];
    if (!text) continue;
    const label = m[1].toUpperCase();
    if (label === 'VECKANS GRÖNA') result.green = text;
    else result.days[DAY[label]] = text;
  }
  return result;
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', aring: 'å', auml: 'ä', ouml: 'ö', Aring: 'Å', Auml: 'Ä', Ouml: 'Ö', eacute: 'é' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return NAMED[e] ?? all;
  });
}
