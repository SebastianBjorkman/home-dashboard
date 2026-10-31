import fs from 'node:fs';
import path from 'node:path';

const ERROR_RETRY_MS = 5 * 60_000;

/**
 * Small TTL cache that keeps serving the last good value when a source fails,
 * and persists to disk so a restart does not start from nothing.
 * Entries: { data, at, error?, code?, errorAt? }
 */
export function createCache({ file = null, now = Date.now } = {}) {
  const store = new Map(load(file));
  const pending = new Map();
  let saveTimer = null;

  function save() {
    if (!file || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify([...store]), { mode: 0o600 });
        fs.renameSync(tmp, file);
      } catch (e) {
        console.error('Cache: kunde inte spara: ' + e.message);
      }
    }, 1000);
    saveTimer.unref?.();
  }

  async function get(key, ttlMs, fetcher) {
    const hit = store.get(key);
    if (hit && !hit.error && now() - hit.at < ttlMs) return hit;
    if (hit?.error && now() - hit.errorAt < ERROR_RETRY_MS) return hit;
    if (pending.has(key)) return pending.get(key);

    const job = (async () => {
      try {
        const entry = { data: await fetcher(), at: now() };
        store.set(key, entry);
        save();
        return entry;
      } catch (e) {
        const entry = {
          data: hit?.data ?? null,
          at: hit?.at ?? null,
          error: e.message,
          code: e.code || 'error',
          errorAt: now(),
        };
        store.set(key, entry);
        return entry;
      } finally {
        pending.delete(key);
      }
    })();
    pending.set(key, job);
    return job;
  }

  return { get };
}

function load(file) {
  if (!file || !fs.existsSync(file)) return [];
  try {
    const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Only good values are worth keeping across restarts.
    return entries.filter(([, v]) => v && v.data != null).map(([k, v]) => [k, { data: v.data, at: v.at }]);
  } catch {
    return [];
  }
}
