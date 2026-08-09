import { useCallback, useEffect, useMemo, useState } from 'react';

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
  const [data, setData] = useState({ services: [], files: [], todos: [], lastBuild: null });
  const [cfg, setCfg] = useState({ checkInterval: 30 });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
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

  const openCompose = useCallback(async (id) => {
    try {
      const json = await getJson(`/api/compose/${id}`);
      setViewer(json);
    } catch (e) {
      setViewer({ path: 'error', content: e.message });
    }
  }, []);

  // Only services with a resolvable URL are shown on the dashboard.
  const services = useMemo(
    () => data.services.filter((s) => s.url).sort((a, b) => a.name.localeCompare(b.name)),
    [data.services],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <LogoMark />
          <div>
            <h1>Dasha Dashboard</h1>
            <p className="subtitle">
              {services.length} service{services.length === 1 ? '' : 's'} · {data.files.length} file
              {data.files.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
      </header>

      {error && <div className="banner error">Could not reach the API: {error}</div>}

      <main>
        {loading ? (
          <div className="empty">Loading…</div>
        ) : services.length === 0 ? (
          <div className="empty">
            <p>No services found.</p>
            <p className="muted">Mount your compose files into the container to see them here.</p>
          </div>
        ) : (
          <div className="grid">
            {services.map((s) => (
              <ServiceCard key={s.id} service={s} onView={() => openCompose(s.fileId)} />
            ))}
          </div>
        )}

        {!loading && data.todos?.length > 0 && <TodoBlock todos={data.todos} />}
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

// Dedicated block listing all TODO/FIXME comments found in the compose files,
// grouped by file.
function TodoBlock({ todos }) {
  const groups = useMemo(() => {
    const byFile = new Map();
    for (const t of todos) {
      if (!byFile.has(t.file)) byFile.set(t.file, []);
      byFile.get(t.file).push(t);
    }
    return [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [todos]);

  return (
    <section className="todo-block">
      <div className="todo-block-head">
        <h2>TODO / FIXME</h2>
        <span className="todo-count">{todos.length}</span>
      </div>
      {groups.map(([file, items]) => (
        <div key={file} className="todo-group">
          <div className="todo-group-file">{file}</div>
          <ul className="todo-list">
            {items.map((t, i) => (
              <li key={i} className="todo-item">
                <span className={`todo-kw ${t.keyword.toLowerCase()}`}>{t.keyword}</span>
                <span className="todo-text">{t.text || '(no description)'}</span>
                <span className="todo-loc">:{t.line}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
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
