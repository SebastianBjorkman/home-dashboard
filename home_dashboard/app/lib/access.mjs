// The Supervisor's Ingress proxy always connects from this address. Anything
// else reaching the port (another add-on, a misconfigured network) is refused.
export const INGRESS_PROXY = '172.30.32.2';

const LOOPBACK = new Set(['127.0.0.1', '::1']);

/**
 * Works out who is asking. Returns { ok, status, user, role }.
 * Ingress has already authenticated the user and passes who they are in
 * X-Remote-User-* headers; those headers are only trusted from the proxy.
 */
export function identify(req, cfg, { dev = false, devUser = 'dev' } = {}) {
  const remote = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');

  let user;
  if (dev) {
    if (!LOOPBACK.has(remote)) return { ok: false, status: 403 };
    user = { id: 'dev', name: devUser.toLowerCase(), displayName: devUser };
  } else {
    if (remote !== INGRESS_PROXY) return { ok: false, status: 403 };
    const name = String(req.headers['x-remote-user-name'] || '').toLowerCase();
    const id = String(req.headers['x-remote-user-id'] || '');
    if (!name || !id) return { ok: false, status: 401 };
    user = { id, name, displayName: String(req.headers['x-remote-user-display-name'] || name) };
  }

  // A child is linked by their Home Assistant user id (picked as a person on the
  // settings page) or, from older add-on options, by username.
  const child = cfg.children.find(c => (c.haUserId && c.haUserId === user.id) || (c.haUser && c.haUser === user.name));
  return { ok: true, user, role: child ? 'child' : 'parent', childId: child?.id ?? null };
}

// Only simple on/off devices can be switched from the dashboard.
export const SWITCHABLE = new Set(['light', 'switch', 'fan', 'input_boolean']);

/**
 * Entities this viewer may switch: a child only their own devices, a parent
 * everything the dashboard shows. `entitiesOf(child)` resolves a child's
 * devices (room + extra − excluded), the same list the views show.
 */
export async function switchableEntities(cfg, identity, entitiesOf) {
  const isChild = identity.role === 'child';
  const kids = isChild ? cfg.children.filter(c => c.id === identity.childId) : cfg.children;
  const ids = (await Promise.all(kids.map(entitiesOf))).flat();
  if (!isChild) ids.push(...cfg.entities);
  return new Set(ids.filter(id => SWITCHABLE.has(id.split('.')[0])));
}

/**
 * Write requests must come from our own page: a custom header cannot be sent
 * cross-site without a CORS preflight we never answer, and browsers mark
 * cross-site requests in Sec-Fetch-Site.
 */
export function isSameOriginWrite(req) {
  if (req.headers['x-home-dashboard'] !== '1') return false;
  const site = req.headers['sec-fetch-site'];
  return !site || site === 'same-origin';
}

/** Fixed-window limit per user, enough for tapping a lamp but not for spamming. */
export function createRateLimiter({ max = 10, windowMs = 10_000, now = Date.now } = {}) {
  const hits = new Map();
  return key => {
    const t = now();
    const entry = hits.get(key);
    if (!entry || t - entry.start >= windowMs) {
      hits.set(key, { start: t, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  };
}
