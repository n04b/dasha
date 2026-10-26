// Which address of a remote host a tile should link to.
//
// A local service's link simply reuses the host in the address bar, but a
// service on another machine can't: that host is this dashboard's, not its
// own. So every remote host comes with all of its addresses (HOSTS on the
// server: LAN IP, Tailscale name, …), and the link takes the one on the same
// network the dashboard itself was opened over. Open it at 192.168.1.10 and a
// remote tile points at the other machine's LAN address; open it over
// Tailscale and it points at that machine's tailnet address instead.

const TAILSCALE = 'tailscale';
const LAN = 'lan';
const PUBLIC = 'public';

function ipv4(hostname) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  return m ? m.slice(1).map(Number) : null;
}

// The network a hostname belongs to: the tailnet (MagicDNS names under
// .ts.net, CGNAT 100.64.0.0/10, Tailscale's fd7a:115c:a1e0::/48), the local
// network (private and loopback ranges, mDNS and home-network suffixes,
// single-label names) or the public internet.
export function networkOf(rawHostname) {
  const hostname = String(rawHostname).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const ip = ipv4(hostname);
  if (ip) {
    const [a, b] = ip;
    if (a === 100 && b >= 64 && b <= 127) return TAILSCALE;
    if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) {
      return LAN;
    }
    return PUBLIC;
  }
  if (hostname.includes(':')) {
    if (hostname.startsWith('fd7a:115c:a1e0:')) return TAILSCALE;
    if (hostname === '::1' || /^f[cd]/.test(hostname) || /^fe[89ab]/.test(hostname)) return LAN;
    return PUBLIC;
  }
  if (hostname.endsWith('.ts.net')) return TAILSCALE;
  if (!hostname.includes('.') || /\.(local|lan|home|home\.arpa|internal|localdomain|intranet|corp)$/.test(hostname)) {
    return LAN;
  }
  return PUBLIC;
}

/**
 * Pick the address of a remote host to link to, given where this dashboard is
 * open (`window.location.hostname`): that very name if the host has it, else
 * the first address on the same network, else the first address at all.
 */
export function pickHostname(hostnames, current = window.location.hostname) {
  if (!hostnames?.length) return null;
  if (hostnames.includes(current)) return current;
  const network = networkOf(current);
  return hostnames.find((h) => networkOf(h) === network) || hostnames[0];
}
