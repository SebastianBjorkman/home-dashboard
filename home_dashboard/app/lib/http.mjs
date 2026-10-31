import fs from 'node:fs';

const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Identify honestly so site owners can see what is fetching and get in touch.
export const USER_AGENT = `home-dashboard/${version} (+https://github.com/SebastianBjorkman/home-dashboard)`;

const MAX_BYTES = 2 * 1024 * 1024;

export class HttpError extends Error {
  constructor(status, host) {
    super(`HTTP ${status} från ${host}`);
    this.status = status;
    this.code = status === 401 || status === 403 ? 'blocked' : 'http';
  }
}

export async function request(url, { method = 'GET', headers = {}, body, timeout = 10_000 } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'User-Agent': USER_AGENT, ...headers },
    body,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new HttpError(res.status, new URL(url).host);
  if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('Svaret är för stort');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('Svaret är för stort');
  return buf.toString('utf8');
}

export async function getJson(url, headers = {}) {
  return JSON.parse(await request(url, { headers: { Accept: 'application/json', ...headers } }));
}

export async function postJson(url, payload, headers = {}) {
  const text = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  return JSON.parse(text);
}
