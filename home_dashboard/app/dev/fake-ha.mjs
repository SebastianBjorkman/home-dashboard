// A pretend Home Assistant for local development, with a few rooms and
// entities to pick from. Start with `npm run dev:ha`, then `npm run dev` with
// HD_HA_URL=http://127.0.0.1:8123 SUPERVISOR_TOKEN=dev.
import http from 'node:http';

const AREAS = [
  { id: 'barnens_rum', name: 'Barnens rum', entities: ['light.taklampa', 'light.lavalampa', 'switch.laddare', 'sensor.rumstemperatur', 'sensor.batteri'] },
  { id: 'kok', name: 'Kök', entities: ['light.koksbank', 'sensor.kyl_temperatur'] },
  { id: 'hall', name: 'Hall', entities: ['light.hallen'] },
];
const OTHER = ['sensor.utetemperatur', 'calendar.familj', 'calendar.skolan', 'media_player.vardagsrum'];
const ALL = [...AREAS.flatMap(a => a.entities), ...OTHER];

const states = new Map();
const nameOf = id => id.split('.')[1].replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const stateOf = id => {
  if (!states.has(id)) states.set(id, id.startsWith('sensor.') ? String(Math.round(15 + Math.random() * 10)) : 'off');
  return states.get(id);
};

function attributesOf(id) {
  const attributes = { friendly_name: nameOf(id) };
  if (id.startsWith('sensor.')) {
    const battery = id.includes('batteri');
    attributes.device_class = battery ? 'battery' : 'temperature';
    attributes.unit_of_measurement = battery ? '%' : '°C';
  }
  return attributes;
}

const stateObject = id => ({ entity_id: id, state: stateOf(id), attributes: attributesOf(id) });

http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    const json = data => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
    if (req.method === 'POST' && req.url === '/template') {
      const { template } = JSON.parse(body);
      if (template.includes('areas()')) return json(AREAS.map(({ id, name }) => ({ id, name })));
      const ref = JSON.parse(template.match(/area_entities\(("[^"]*")\)/)[1]);
      return json(AREAS.find(a => a.id === ref || a.name === ref)?.entities || []);
    }
    if (req.method === 'POST' && /^\/services\/\w+\/toggle$/.test(req.url)) {
      const { entity_id: id } = JSON.parse(body);
      states.set(id, stateOf(id) === 'on' ? 'off' : 'on');
      console.log(`toggle ${id} -> ${states.get(id)}`);
      return json([]);
    }
    if (req.url === '/states') return json(ALL.map(stateObject));
    const m = req.url.match(/^\/states\/(.+)$/);
    if (m) return json(stateObject(decodeURIComponent(m[1])));
    res.writeHead(404).end();
  });
}).listen(8123, '127.0.0.1', () => console.log('Fake Home Assistant: http://127.0.0.1:8123'));
