import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STATUS_META = {
  online: { label: 'Online', cls: 'online' },
  offline: { label: 'Offline', cls: 'offline' },
  timeout: { label: 'Timeout', cls: 'timeout' },
  unknown: { label: 'Checking…', cls: 'unknown' },
  'no-url': { label: 'No URL', cls: 'nourl' },
};

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

export default function App() {
  const [data, setData] = useState({ services: [], files: [], lastBuild: null });
  const [cfg, setCfg] = useState({ checkInterval: 30 });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useTheme();
  const [viewer, setViewer] = useState(null); // { id, path, content }

  const load = useCallback(async () => {
    try {
      const json = await getJson('/api/services');
      setData(json);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + config, then poll on the server's check interval.
  useEffect(() => {
    getJson('/api/config').then(setCfg).catch(() => {});
    load();
  }, [load]);

  useEffect(() => {
    const ms = Math.max(5, cfg.checkInterval || 30) * 1000;
    const t = setInterval(load, ms);
    return () => clearInterval(t);
  }, [cfg.checkInterval, load]);

  const onReload = useCallback(async () => {
    setReloading(true);
    try {
      await fetch('/api/reload', { method: 'POST' });
      await load();
    } finally {
      setReloading(false);
    }
  }, [load]);

  const openCompose = useCallback(async (id) => {
    try {
      const json = await getJson(`/api/compose/${id}`);
      setViewer(json);
    } catch (e) {
      setViewer({ path: 'error', content: e.message });
    }
  }, []);

  const services = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...data.services].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return list;
    return list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.image || '').toLowerCase().includes(q) ||
        (s.service || '').toLowerCase().includes(q),
    );
  }, [data.services, query]);

  const counts = useMemo(() => {
    const c = { online: 0, offline: 0, timeout: 0, total: data.services.length };
    for (const s of data.services) if (c[s.status] != null) c[s.status] += 1;
    return c;
  }, [data.services]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <LogoMark />
          <div>
            <h1>Compose Dashboard</h1>
            <p className="subtitle">
              {counts.total} service{counts.total === 1 ? '' : 's'} · {data.files.length} file
              {data.files.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        <div className="controls">
          <input
            className="search"
            type="search"
            placeholder="Filter services…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter services"
          />
          <div className="stat-pills" aria-hidden="true">
            <span className="pill online" title="Online">{counts.online}</span>
            <span className="pill offline" title="Offline">{counts.offline}</span>
            <span className="pill timeout" title="Timeout">{counts.timeout}</span>
          </div>
          <button className="btn" onClick={onReload} disabled={reloading} title="Rescan compose files">
            <span className={reloading ? 'spin' : ''}>⟳</span>
          </button>
          <button
            className="btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title="Toggle theme"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      {error && <div className="banner error">Could not reach the API: {error}</div>}

      <main>
        {loading ? (
          <div className="empty">Loading…</div>
        ) : services.length === 0 ? (
          <div className="empty">
            <p>No services found.</p>
            <p className="muted">
              Mount your compose files into the container and press <span className="kbd">⟳</span>.
            </p>
          </div>
        ) : (
          <div className="grid">
            {services.map((s) => (
              <ServiceCard key={s.id} service={s} onView={() => openCompose(s.fileId)} />
            ))}
          </div>
        )}
      </main>

      <footer className="footer">
        {data.lastBuild && <span>Last rebuild: {new Date(data.lastBuild).toLocaleTimeString()}</span>}
      </footer>

      {viewer && <ComposeModal file={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}

function ServiceCard({ service, onView }) {
  const meta = STATUS_META[service.status] || STATUS_META.unknown;
  const port = service.ports?.find((p) => p.published != null)?.published;
  const CardTag = service.url ? 'a' : 'div';
  const linkProps = service.url
    ? { href: service.url, target: '_blank', rel: 'noreferrer noopener' }
    : {};

  return (
    <div className="card">
      <CardTag className="card-main" {...linkProps}>
        <div className="icon">
          <img src={service.icon} alt="" loading="lazy" />
        </div>
        <div className="card-body">
          <div className="card-title">{service.name}</div>
          <div className="card-sub">{service.image || service.service}</div>
        </div>
        <div className={`status ${meta.cls}`} title={meta.label}>
          <span className="dot" />
          <span className="status-label">{meta.label}</span>
        </div>
      </CardTag>
      <div className="card-foot">
        <span className="meta">
          {port ? `:${port}` : 'no port'}
          {service.responseTime != null && service.status === 'online' ? ` · ${service.responseTime}ms` : ''}
        </span>
        <button className="link-btn" onClick={onView}>compose</button>
      </div>
    </div>
  );
}

function ComposeModal({ file, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-path">{file.path}</span>
          <button className="btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {file.error && <div className="banner error">{file.error}</div>}
        <pre className="code"><code>{file.content}</code></pre>
      </div>
    </div>
  );
}

function LogoMark() {
  return (
    <svg className="logo" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  );
}

// Theme hook: persists choice, defaults to system preference.
function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const first = useRef(true);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (!first.current) localStorage.setItem('theme', theme);
    first.current = false;
  }, [theme]);
  return [theme, setTheme];
}
