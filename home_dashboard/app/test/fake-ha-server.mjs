import http from 'node:http';

// A stand-in for Home Assistant's REST API that records every toggle.
export async function fakeHomeAssistant() {
  const states = {
    'light.alva_tak': 'off', 'light.hallen': 'off', 'light.theo_tak': 'off', 'light.kok': 'on',
    'switch.alva_laddare': 'on', 'sensor.alva_temp': '21', 'sensor.alva_batteri': '80', 'sensor.ute': '7',
    'calendar.familj': 'off',
  };
  const deviceClass = { 'sensor.alva_temp': 'temperature', 'sensor.alva_batteri': 'battery', 'sensor.ute': 'temperature' };
  const areas = [{ id: 'alvas_rum', name: 'Alvas rum' }, { id: 'kok', name: 'Kök' }];
  const areaEntities = { alvas_rum: ['light.alva_tak', 'switch.alva_laddare', 'sensor.alva_temp', 'sensor.alva_batteri', 'media_player.alva'] };
  const calls = [];
  const state = id => ({ entity_id: id, state: states[id], attributes: { friendly_name: id, device_class: deviceClass[id] } });

  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer test-token') { res.writeHead(401).end(); return; }
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const json = data => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
      const toggle = req.url.match(/^\/services\/(\w+)\/toggle$/);
      if (req.method === 'POST' && toggle) {
        const { entity_id } = JSON.parse(body);
        calls.push(entity_id);
        states[entity_id] = states[entity_id] === 'on' ? 'off' : 'on';
        return json([]);
      }
      if (req.method === 'POST' && req.url === '/template') {
        const { template } = JSON.parse(body);
        if (template.includes('areas()')) return json(areas);
        const ref = JSON.parse(template.match(/area_entities\(("[^"]*")\)/)[1]);
        const area = areas.find(a => a.id === ref || a.name === ref);
        return json(area ? areaEntities[area.id] || [] : []);
      }
      if (req.method === 'GET' && req.url === '/states') return json(Object.keys(states).map(state));
      const id = decodeURIComponent(req.url.replace('/states/', ''));
      if (req.method === 'GET' && id in states) return json(state(id));
      res.writeHead(404).end();
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, calls, states, url: `http://127.0.0.1:${server.address().port}` };
}
