// Resolve and locally cache service icons from https://iconify.design.
//
// For each service we get an ordered list of candidates (see resolver.js).
// Explicit Iconify ids ("prefix:name") are fetched verbatim; plain words are
// resolved through the Iconify search API, preferring brand/logo collections;
// http(s) and data: URLs are downloaded/decoded as is (SVG or a raster image).
// Every icon is written to ICONS_DIR and served from /icons/<file>.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config as defaultConfig } from './config.js';
import { createLogger } from './logger.js';

// Collections that tend to hold real service/brand logos, best first.
const PREFERRED_PREFIXES = ['light', 'logos', 'simple-icons', 'skill-icons', 'devicon', 'mdi', 'cib'];

const DEFAULT_ICON = 'default.svg';

// Icons given as a URL: anything bigger is not an icon.
const MAX_URL_ICON_BYTES = 1024 * 1024;

// Formats accepted from an icon URL, recognised by their leading bytes rather
// than the Content-Type, which servers often get wrong.
const IMAGE_SIGNATURES = [
  { ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', test: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  { ext: 'webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { ext: 'ico', test: (b) => b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 },
  { ext: 'svg', test: (b) => b.subarray(0, 4096).toString('utf8').includes('<svg') },
];

// Circuit breaker: when Iconify is unreachable every lookup would otherwise burn
// a full timeout, turning a rebuild into minutes of waiting. After a few
// consecutive failures we stop calling out for a cooldown and fall back to the
// default icon.
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 60_000;

/**
 * Create an icon resolver bound to a config, logger and fetch implementation.
 * All mutable state (the resolve memo, cache-writability flag and circuit
 * breaker) lives inside the closure, so two resolvers never share state and a
 * test can inject a fake `fetchImpl` instead of hitting the network.
 */
export function createIcons({ config = defaultConfig, log = createLogger('icons'), fetchImpl = fetch } = {}) {
  // In-memory memo: candidate string -> resolved relative url (or null).
  const memo = new Map();

  // True once we've confirmed the icon cache directory is writable. When false
  // the app still runs, it just can't persist downloaded icons (cards fall back
  // to the built-in default served by the API).
  let cacheWritable = false;

  let consecutiveFailures = 0;
  let breakerUntil = 0;

  async function ensureIconsDir() {
    try {
      await fs.mkdir(config.iconsDir, { recursive: true });
      // Ship a neutral fallback so cards always render something.
      const fallback = path.join(config.iconsDir, DEFAULT_ICON);
      try {
        await fs.access(fallback);
      } catch {
        await fs.writeFile(fallback, FALLBACK_SVG, 'utf8');
      }
      cacheWritable = true;
    } catch (err) {
      // Don't crash — the API serves the fallback icon inline, so the dashboard
      // still works; only local icon caching is disabled.
      log.warn(`icon cache dir not writable (${config.iconsDir}); caching disabled`, err.message);
      cacheWritable = false;
    }
  }

  function isCacheWritable() {
    return cacheWritable;
  }

  function defaultIconUrl() {
    return `/icons/${DEFAULT_ICON}`;
  }

  /**
   * Resolve an icon for a list of candidates.
   * Returns a relative url like "/icons/simple-icons-grafana.svg", or the
   * default icon url if nothing matched.
   */
  async function resolveIcon(candidates) {
    for (const candidate of candidates) {
      // URL paths are case-sensitive, so a URL is memoized verbatim.
      const key = candidate.url
        ? `url:${candidate.value}`
        : `${candidate.explicit ? 'id:' : 'q:'}${candidate.value.toLowerCase()}`;
      if (memo.has(key)) {
        const cached = memo.get(key);
        if (cached) return cached;
        continue; // known miss, try next candidate
      }

      let url;
      if (candidate.url) url = await downloadUrl(candidate.value);
      else if (candidate.explicit) url = await fetchAndCache(candidate.value);
      else url = await searchAndCache(candidate.value);

      memo.set(key, url);
      if (url) {
        log.info(`icon for "${candidate.url ? shortUrl(candidate.value) : candidate.value}" -> ${url}`);
        return url;
      }
    }
    return defaultIconUrl();
  }

  // Fetch an explicit Iconify id and cache it. "simple-icons:grafana"
  async function fetchAndCache(iconId) {
    if (!iconId.includes(':')) return null;
    const [prefix, name] = iconId.split(':');
    return downloadSvg(prefix, name);
  }

  // Search Iconify for a word, pick the best id, then fetch+cache it.
  async function searchAndCache(query) {
    const cleaned = query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!cleaned) return null;
    const iconId = await searchIcon(cleaned);
    if (!iconId) {
      log.debug(`no icon found for "${query}"`);
      return null;
    }
    const [prefix, name] = iconId.split(':');
    return downloadSvg(prefix, name);
  }

  async function searchIcon(query) {
    const url = `${config.iconifyApi}/search?query=${encodeURIComponent(query)}&limit=32`;
    const json = await fetchJson(url);
    const icons = json?.icons;
    if (!Array.isArray(icons) || icons.length === 0) return null;

    // Prefer an exact-name match inside a preferred (brand) collection.
    for (const prefix of PREFERRED_PREFIXES) {
      const exact = icons.find((id) => id === `${prefix}:${query.replace(/\s+/g, '-')}`);
      if (exact) return exact;
      const inCollection = icons.find((id) => id.startsWith(`${prefix}:`));
      if (inCollection) return inCollection;
    }
    return icons[0];
  }

  async function downloadSvg(prefix, name) {
    const file = `${sanitize(prefix)}-${sanitize(name)}.svg`;
    const dest = path.join(config.iconsDir, file);
    const rel = `/icons/${file}`;

    // Already cached on disk? (survives restarts on a persisted volume)
    try {
      await fs.access(dest);
      return rel;
    } catch {
      /* not cached yet */
    }

    const svgUrl = `${config.iconifyApi}/${prefix}/${name}.svg`;
    const svg = await fetchText(svgUrl);
    if (!svg || !svg.includes('<svg')) {
      log.warn(`icon download failed: ${prefix}:${name}`);
      return null;
    }
    try {
      await fs.writeFile(dest, svg, 'utf8');
      log.debug(`cached icon ${rel}`);
      return rel;
    } catch (err) {
      log.error(`cannot write icon ${dest}`, err.message);
      return null;
    }
  }

  // Download an icon from an arbitrary URL and cache it as url-<hash>.<ext>.
  // A data: URL goes through fetch too, which decodes it per the spec.
  // The extension comes from the image's own bytes, so express.static serves
  // it with the right type. Once cached it is never re-fetched, like Iconify
  // icons: clearing ICONS_DIR picks up a changed image.
  async function downloadUrl(iconUrl) {
    const base = `url-${crypto.createHash('sha1').update(iconUrl).digest('hex').slice(0, 12)}`;
    for (const { ext } of IMAGE_SIGNATURES) {
      try {
        await fs.access(path.join(config.iconsDir, `${base}.${ext}`));
        return `/icons/${base}.${ext}`;
      } catch {
        /* not cached under this extension */
      }
    }

    const body = await fetchImage(iconUrl);
    if (!body) return null;
    const format = IMAGE_SIGNATURES.find((s) => s.test(body));
    if (!format) {
      log.warn(`icon url is not an image: ${shortUrl(iconUrl)}`);
      return null;
    }
    const file = `${base}.${format.ext}`;
    try {
      await fs.writeFile(path.join(config.iconsDir, file), body);
      log.debug(`cached icon /icons/${file} from ${shortUrl(iconUrl)}`);
      return `/icons/${file}`;
    } catch (err) {
      log.error(`cannot write icon ${file}`, err.message);
      return null;
    }
  }

  // Fetch an icon URL as bytes. Deliberately outside the Iconify circuit
  // breaker: one dead self-hosted URL says nothing about Iconify.
  async function fetchImage(iconUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.iconTimeout);
    try {
      const res = await fetchImpl(iconUrl, { signal: controller.signal, headers: { 'user-agent': 'compose-dashboard' } });
      if (!res.ok) {
        log.warn(`icon url answered ${res.status}: ${shortUrl(iconUrl)}`);
        return null;
      }
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length > MAX_URL_ICON_BYTES) {
        log.warn(`icon url too large (${body.length} bytes): ${shortUrl(iconUrl)}`);
        return null;
      }
      return body;
    } catch (err) {
      log.warn(`icon url fetch failed: ${shortUrl(iconUrl)}`, err.message);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function breakerOpen() {
    if (breakerUntil && Date.now() < breakerUntil) return true;
    if (breakerUntil) {
      // Cooldown elapsed — allow traffic again.
      breakerUntil = 0;
      consecutiveFailures = 0;
    }
    return false;
  }

  function noteFailure() {
    consecutiveFailures += 1;
    if (consecutiveFailures >= FAILURE_THRESHOLD && !breakerUntil) {
      breakerUntil = Date.now() + COOLDOWN_MS;
      log.warn(`Iconify unreachable; pausing icon lookups for ${COOLDOWN_MS / 1000}s`);
    }
  }

  async function fetchJson(url) {
    const text = await fetchText(url);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async function fetchText(url) {
    if (breakerOpen()) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.iconTimeout);
    try {
      const res = await fetchImpl(url, { signal: controller.signal, headers: { 'user-agent': 'compose-dashboard' } });
      if (!res.ok) return null;
      consecutiveFailures = 0;
      return await res.text();
    } catch (err) {
      noteFailure();
      log.debug(`fetch failed ${url}`, err.message);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return { ensureIconsDir, isCacheWritable, defaultIconUrl, resolveIcon };
}

// A data: URL can be kilobytes of base64; keep log lines readable.
function shortUrl(url) {
  return url.length > 80 ? `${url.slice(0, 77)}...` : url;
}

function sanitize(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`;
