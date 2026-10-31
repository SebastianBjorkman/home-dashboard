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

http.createServer((req, res) => {
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
      .end(JSON.stringify({ state: stateOf(id), attributes: { friendly_name: nameOf(id), unit_of_measurement: id.startsWith('sensor.') ? '°C' : undefined } }));
    return;
  }
  res.writeHead(404).end();
}).listen(8123, '127.0.0.1', () => console.log('Fake Home Assistant: http://127.0.0.1:8123'));
