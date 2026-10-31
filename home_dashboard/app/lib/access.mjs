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

  const child = cfg.children.find(c => c.haUser && c.haUser === user.name);
  return { ok: true, user, role: child ? 'child' : 'parent', childId: child?.id ?? null };
}
