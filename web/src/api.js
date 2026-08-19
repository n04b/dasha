// Thin fetch wrapper for the dashboard's REST API.

const REQUEST_TIMEOUT = 10000;

// fetch() never times out on its own, so a hung server would leave the UI
// stuck on "Loading…" forever. Abort every request after REQUEST_TIMEOUT.
export async function getJson(url, { signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), REQUEST_TIMEOUT);
  const onAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw Object.assign(new Error('request timed out'), { name: 'AbortError' });
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
