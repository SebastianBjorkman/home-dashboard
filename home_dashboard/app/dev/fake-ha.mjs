// A pretend Home Assistant for local development: answers states and toggles
// for whatever entity ids you ask about. Start with `npm run dev:ha`, then
// `npm run dev` with HD_HA_URL=http://127.0.0.1:8123 SUPERVISOR_TOKEN=dev.
import http from 'node:http';

const states = new Map();
const nameOf = id => id.split('.')[1].replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const stateOf = id => {
  if (!states.has(id)) states.set(id, id.startsWith('sensor.') ? String(Math.round(15 + Math.random() * 10)) : 'off');
  return states.get(id);
};

// Every area contains the same pretend room.
const ROOM = ['light.taklampa', 'light.lavalampa', 'switch.laddare', 'sensor.rumstemperatur', 'sensor.batteri'];

function fakeAttributes(id) {
  const attributes = { friendly_name: nameOf(id) };
  if (id.startsWith('sensor.')) {
    const battery = id.includes('batteri');
    attributes.device_class = battery ? 'battery' : 'temperature';
    attributes.unit_of_measurement = battery ? '%' : '°C';
  }
  return attributes;
}

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/template') {
    req.resume();
    req.on('end', () => res.writeHead(200, { 'Content-Type': 'text/plain' }).end(JSON.stringify(ROOM)));
    return;
  }
  const toggle = req.url.match(/^\/services\/\w+\/toggle$/);
  if (req.method === 'POST' && toggle) {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const { entity_id: id } = JSON.parse(body);
      states.set(id, stateOf(id) === 'on' ? 'off' : 'on');
      console.log(`toggle ${id} -> ${states.get(id)}`);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('[]');
    });
    return;
  }
  const m = req.url.match(/^\/states\/(.+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    res.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ state: stateOf(id), attributes: fakeAttributes(id) }));
    return;
  }
  res.writeHead(404).end();
}).listen(8123, '127.0.0.1', () => console.log('Fake Home Assistant: http://127.0.0.1:8123'));
