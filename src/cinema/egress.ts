/**
 * Egress guard
 *
 * Limits what a capture may reach when it is given a list of hosts. A capture run on our own
 * infrastructure opens pages from inside a cluster, so the page must not be able to steer the
 * browser to an address that is only reachable from there.
 *
 * Two rules, applied to every request the browser makes:
 *
 * 1. A navigation of the page itself goes only to a listed host, over https.
 * 2. Nothing, navigation or not, goes to an address that is not public: no IP literal, no
 *    local name, and no name that resolves to a private, loopback or link-local address.
 *
 * Other public hosts stay reachable as sub-resources, because real pages load fonts and scripts
 * from them. This guard is one layer. A name can change what it resolves to between the check and
 * the connection, so the network policy around the process is what finally stops a request.
 */
import { lookup } from 'dns/promises';
import { isIP } from 'net';

import { BrowserContext } from 'playwright';

/** `enclii.dev` matches that host only; `.madfam.io` matches any subdomain, not the bare domain. */
export function hostAllowed(host: string, allowed: string[]): boolean {
  const name = host.toLowerCase().replace(/\.$/, '');
  return allowed.some((raw) => {
    const entry = raw.toLowerCase().trim();
    if (!entry) return false;
    return entry.startsWith('.')
      ? name.endsWith(entry) && name.length > entry.length
      : name === entry;
  });
}

/** Whether an IP address is one only reachable from inside a network, or not routable at all. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      lower === '::' ||
      lower === '::1' ||
      /^f[cd]/.test(lower) || // unique local
      /^fe[89ab]/.test(lower) || // link local
      lower.startsWith('ff') || // multicast
      lower.startsWith('64:ff9b:') || // NAT64
      lower.startsWith('::ffff:')
    );
  }
  return true; // not an address at all
}

const LOCAL_NAME = /(^|\.)(localhost|local|internal|lan|home|corp|svc|cluster\.local)$/;

/**
 * Why a request is refused before any lookup, or null when only its address is left to check.
 * `navigation` is true for a navigation of the page's own (top) frame.
 */
export function refuseRequest(url: string, navigation: boolean, allowed: string[]): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'not a url';
  }
  if (parsed.protocol === 'data:' || parsed.protocol === 'blob:' || parsed.protocol === 'about:') {
    return navigation ? 'the page may only navigate to a listed host' : null;
  }
  if (parsed.protocol !== 'https:') return `scheme ${parsed.protocol} is not https`;
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return 'an address, not a name';
  if (!host.includes('.') || LOCAL_NAME.test(host.toLowerCase())) return 'a local name';
  if (parsed.port && parsed.port !== '443') return 'not the default https port';
  if (navigation && !hostAllowed(host, allowed)) return `host ${host} is not listed`;
  return null;
}

export interface EgressGuard {
  /** Requests refused so far, most recent last (capped). */
  blocked: { url: string; reason: string }[];
}

/** Install the guard on a browser context. Call before the first page is opened. */
export async function guardEgress(
  context: BrowserContext,
  allowed: string[],
  resolve: (host: string) => Promise<string[]> = async (host) =>
    (await lookup(host, { all: true })).map((entry) => entry.address),
): Promise<EgressGuard> {
  if (allowed.length === 0) throw new Error('An empty host list allows no capture');
  const guard: EgressGuard = { blocked: [] };
  const verdicts = new Map<string, Promise<string | null>>();

  const addressVerdict = (host: string): Promise<string | null> => {
    let verdict = verdicts.get(host);
    if (!verdict) {
      verdict = resolve(host).then(
        (addresses) =>
          addresses.length === 0 || addresses.some(isPrivateAddress)
            ? 'resolves to an address that is not public'
            : null,
        () => 'does not resolve',
      );
      verdicts.set(host, verdict);
    }
    return verdict;
  };

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    const navigation = request.isNavigationRequest() && request.frame().parentFrame() === null;
    let reason = refuseRequest(url, navigation, allowed);
    if (!reason && url.startsWith('https:')) reason = await addressVerdict(new URL(url).hostname);
    if (reason) {
      if (guard.blocked.length < 200) guard.blocked.push({ url: url.slice(0, 300), reason });
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  // A WebSocket is not a request the route above sees. A still picture needs none.
  await context.routeWebSocket(/.*/, (socket) => socket.close());
  return guard;
}
