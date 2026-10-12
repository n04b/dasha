import { useCallback, useEffect, useRef, useState } from 'react';

// Can the browser reach the dashboard's server — and if not, can it reach the
// same server at one of its fallback addresses (typically a Tailscale MagicDNS
// name)? They are tried in order; the first that answers is where the page
// goes, keeping its path, query and hash.
//
// status: 'unknown' until the first check has answered, then 'online',
// 'offline', or 'switching' while the page is on its way to the fallback.

// GET /api/ping on `origin`: true only if a Dasha answered within `timeout`.
// The body is checked, not just the status code — a reverse proxy or another
// app on that host and port answers too, and must not be taken for the server.
export async function ping(origin, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(new URL('/api/ping', origin), { cache: 'no-store', signal: controller.signal });
    return res.ok && (await res.json())?.app === 'dasha';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// The current URL — path, query and hash — moved onto a fallback origin. Built
// by setting the parts rather than resolving a string, so no path can carry the
// page off to some other host. Null for anything but an http(s) origin.
export function fallbackUrl(origin, current = window.location) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  url.pathname = current.pathname;
  url.search = current.search;
  url.hash = current.hash;
  return url;
}

function referrerOrigin() {
  try {
    return document.referrer ? new URL(document.referrer).origin : null;
  } catch {
    return null;
  }
}

const warnedMixedContent = new Set();

// What keeps switching from turning into a loop: never "switch" to where the
// page already is, nor back to where it just came from until this address has
// answered at least once (`cameFrom`) — and never from https to http, which the
// browser would block as mixed content anyway.
function canSwitchTo(target, cameFrom) {
  if (target.origin === window.location.origin || target.origin === cameFrom) return false;
  if (window.location.protocol === 'https:' && target.protocol === 'http:') {
    if (!warnedMixedContent.has(target.origin)) {
      console.warn(`Dasha: skipping fallback ${target.origin} — an https page can't reach an http address.`);
      warnedMixedContent.add(target.origin);
    }
    return false;
  }
  return true;
}

export function useConnection(config) {
  const [status, setStatus] = useState('unknown');
  const [checking, setChecking] = useState(false);
  const [target, setTarget] = useState(null); // host being switched to
  const configRef = useRef(config);
  configRef.current = config;
  const inFlight = useRef(null);
  const switching = useRef(false);
  // The address a switch (or a link) brought the page from. Going straight
  // back there would be a ping-pong; once this address has answered, the page
  // has settled, and a later outage may send it anywhere on the list again.
  const cameFrom = useRef(referrerOrigin());
  const current = useRef(status); // the status, readable mid-check

  // Once the page is leaving for a fallback, nothing changes its mind.
  const update = useCallback((next) => {
    if (switching.current) return;
    if (next === 'online') cameFrom.current = null;
    current.current = next;
    setStatus(next);
  }, []);

  // One check at a time; callers arriving mid-check share its result.
  const check = useCallback(() => {
    if (switching.current) return Promise.resolve();
    inFlight.current ??= (async () => {
      setChecking(true);
      const { fallbackUrls, connectTimeout } = configRef.current || {};
      const timeout = Math.max(500, connectTimeout || 3000);
      try {
        if (await ping(window.location.origin, timeout)) return update('online');
        update('offline');
        // In order, one at a time: the first address that answers wins.
        for (const origin of Array.isArray(fallbackUrls) ? fallbackUrls : []) {
          // Walking a long list takes a while; the server may be back meanwhile.
          if (current.current === 'online') return;
          const url = fallbackUrl(origin);
          if (!url || !canSwitchTo(url, cameFrom.current)) continue;
          if (!(await ping(url.origin, timeout))) continue;
          setStatus('switching');
          setTarget(url.host);
          switching.current = true;
          window.location.replace(url.href); // replace: Back mustn't lead back here
          return;
        }
      } finally {
        inFlight.current = null;
        setChecking(false);
      }
    })();
    return inFlight.current;
  }, [update]);

  // Any request that got through proves the server is there.
  const markOnline = useCallback(() => update('online'), [update]);

  // Check straight away: the page may have come out of the service worker's
  // cache, and only the server answering says the server is there.
  useEffect(() => {
    check();
  }, [check]);

  // Look again whenever the network or the tab comes back. Connecting a VPN
  // fires no `online` event — the device was online all along — so a tab being
  // shown again, and the retry timer below, are what notice Tailscale coming up.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    window.addEventListener('online', check);
    window.addEventListener('offline', check);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', check);
      window.removeEventListener('offline', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  // While nothing answers, keep trying.
  const interval = Math.max(5, config?.reconnectInterval || 15) * 1000;
  useEffect(() => {
    if (status !== 'offline') return undefined;
    const t = setInterval(check, interval);
    return () => clearInterval(t);
  }, [status, interval, check]);

  return { status, checking, target, check, markOnline };
}
