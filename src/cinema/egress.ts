/**
 * Egress guard
 *
 * Limits what a capture may reach when it is given a list of hosts. A capture run on our own
 * infrastructure opens pages from inside a cluster, so the page must not be able to steer the
 * browser to an address that is only reachable from there.
 *
 * The guard is a forwarding proxy inside this process, and the browser is started so that every
 * connection it makes goes through it. That is the point of doing it as a proxy: a redirect, a
 * frame, a popup, a WebSocket and a preconnect are all just connections, and none can go around
 * it. For each connection the proxy:
 *
 *   - accepts only `CONNECT host:443` (so only https; a plain http request is refused);
 *   - refuses an IP literal and a local name;
 *   - resolves the name itself, refuses it if any address is not public, and connects to the
 *     address it checked. The browser never resolves the name, so the name cannot answer one
 *     thing to the check and another to the connection.
 *
 * On top of that, the page itself (its top frame) may only be on a listed host. Other public
 * hosts stay reachable as sub-resources, because real pages load fonts and scripts from them.
 * A capture whose top frame leaves the list is failed, not pictured.
 *
 * Chromium only. The network policy around the process remains the outer stop.
 */
import { lookup } from 'dns/promises';
import http from 'http';
import net, { isIP } from 'net';

import { BrowserContext, Page } from 'playwright';

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

/** Whether an IPv4 address is one only reachable from inside a network, or not routable at all. */
function isPrivateV4(address: string): boolean {
  const [a, b, c] = address.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/**
 * Whether an IP address is one only reachable from inside a network, or not routable at all.
 * IPv6 is judged conservatively: only global unicast (2000::/3) outside the ranges that embed or
 * tunnel an IPv4 address counts as public.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateV4(address);
  if (version === 6) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateV4(mapped[1]);
    if (!/^[23]/.test(lower)) return true; // not global unicast
    return (
      lower.startsWith('2002:') || // 6to4
      /^2001:0?0?0?0?:/.test(lower) || // Teredo
      lower.startsWith('2001:db8:') // documentation
    );
  }
  return true; // not an address at all
}

const LOCAL_NAME = /(^|\.)(localhost|local|internal|lan|home|corp|svc|cluster\.local)$/;

/** Why a host name may not be connected to before any lookup, or null. */
export function refuseHost(rawHost: string): string | null {
  const host = rawHost
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!host) return 'no host';
  if (isIP(host)) return 'an address, not a name';
  if (!/^[a-z0-9.-]+$/.test(host)) return 'not a plain host name';
  if (!host.includes('.') || LOCAL_NAME.test(host)) return 'a local name';
  return null;
}

/**
 * Why a request is refused before any connection, or null. Used for the page's own navigations,
 * where the answer should name the rule instead of surfacing as a failed connection.
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
  const reason = refuseHost(parsed.hostname);
  if (reason) return reason;
  if (parsed.port && parsed.port !== '443') return 'not the default https port';
  if (navigation && !hostAllowed(parsed.hostname, allowed)) {
    return `host ${parsed.hostname.replace(/\.$/, '')} is not listed`;
  }
  return null;
}

export interface Refusal {
  url: string;
  reason: string;
}

export interface EgressProxy {
  /** `http://127.0.0.1:<port>`, for the browser's proxy setting. */
  server: string;
  /** Connections and requests refused so far (the first 200). */
  refused: Refusal[];
  close(): Promise<void>;
}

export interface EgressProxyOptions {
  /** Injected for tests. Returns every address of a name. */
  resolve?: (host: string) => Promise<string[]>;
  /** Injected for tests. Opens the upstream connection. */
  connect?: (address: string, port: number) => net.Socket;
  /** Distinct names one capture may connect to. A page asking for more is not a page. */
  maxHosts?: number;
  /** Where refusals are recorded; shared with the page guard so a manifest lists both. */
  refused?: Refusal[];
}

/** Start the forwarding proxy every browser connection must pass through. */
export async function startEgressProxy(options: EgressProxyOptions = {}): Promise<EgressProxy> {
  const resolve =
    options.resolve ??
    (async (host: string) =>
      (await lookup(host, { all: true, family: 4 })).map((entry) => entry.address));
  const connect = options.connect ?? ((address, port) => net.connect(port, address));
  const maxHosts = options.maxHosts ?? 300;
  const refused = options.refused ?? [];
  const verdicts = new Map<string, Promise<{ address: string } | { reason: string }>>();
  // Tunnels are detached from the http server, so they are tracked here to be closed with it.
  const sockets = new Set<net.Socket>();

  const note = (url: string, reason: string) => {
    if (refused.length < 200) refused.push({ url: url.slice(0, 300), reason });
  };

  const judge = (host: string) => {
    let verdict = verdicts.get(host);
    if (!verdict) {
      if (verdicts.size >= maxHosts) {
        return Promise.resolve({ reason: `more than ${maxHosts} distinct hosts` });
      }
      verdict = resolve(host).then(
        (addresses) =>
          addresses.length === 0 || addresses.some(isPrivateAddress)
            ? { reason: 'resolves to an address that is not public' }
            : // The address that was checked is the one connected to.
              { address: addresses[0] },
        () => ({ reason: 'does not resolve' }),
      );
      verdicts.set(host, verdict);
    }
    return verdict;
  };

  const server = http.createServer((request, response) => {
    // Anything that is not CONNECT is a plain http request. None is allowed.
    note(String(request.url), 'not https');
    response.writeHead(403, { Connection: 'close' });
    response.end();
  });

  server.on('connect', (request, client: net.Socket) => {
    const target = String(request.url);
    const refuse = (reason: string) => {
      note(`https://${target}`, reason);
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    };
    client.on('error', () => client.destroy());
    sockets.add(client);
    client.on('close', () => sockets.delete(client));

    const match = target.match(/^(.+):(\d+)$/);
    if (!match) return refuse('not a host and port');
    const [, rawHost, port] = match;
    if (port !== '443') return refuse('not the default https port');
    const early = refuseHost(rawHost);
    if (early) return refuse(early);
    const host = rawHost.toLowerCase().replace(/\.$/, '');

    void judge(host).then((verdict) => {
      if ('reason' in verdict) return refuse(verdict.reason);
      // The browser may have gone away while the name was being looked up.
      if (client.destroyed) return;
      const upstream = connect(verdict.address, 443);
      let established = false;
      sockets.add(upstream);
      upstream.setTimeout(30000, () => upstream.destroy());
      upstream.on('error', () => {
        // A 502 is only meaningful before the tunnel exists; after, the bytes belong to TLS.
        if (!established && !client.destroyed) {
          client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
        } else {
          client.destroy();
        }
        upstream.destroy();
      });
      upstream.once('connect', () => {
        established = true;
        upstream.setTimeout(0);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        upstream.pipe(client);
        client.pipe(upstream);
      });
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => {
        sockets.delete(upstream);
        client.destroy();
      });
    });
  });

  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => done());
  });
  const { port } = server.address() as net.AddressInfo;

  return {
    server: `http://127.0.0.1:${port}`,
    refused,
    close: () =>
      new Promise<void>((done) => {
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections?.();
        server.close(() => done());
      }),
  };
}

/**
 * Chromium flags that go with the proxy. Without the first, Chromium talks to loopback addresses
 * directly; the rest close the paths that are not ordinary connections.
 */
export const GUARDED_CHROMIUM_ARGS = [
  '--proxy-bypass-list=<-loopback>',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--dns-prefetch-disable',
  '--disable-quic',
  // No `--disable-features` here: Playwright passes its own, and a second one would replace it.
];

export interface PageGuard {
  /** Why the capture must be failed, once the page has broken a rule. */
  violation(): string | null;
  /** Requests refused at the page level. */
  refused: Refusal[];
}

/**
 * The page-level half: the top frame stays on a listed host, and there is one page.
 * Call before the first page is opened.
 */
export async function guardPage(
  context: BrowserContext,
  allowed: string[],
  refused: Refusal[] = [],
): Promise<PageGuard> {
  if (allowed.length === 0) throw new Error('An empty host list allows no capture');
  let violation: string | null = null;
  let first: Page | undefined;

  let left = false;
  const watch = (page: Page) => {
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      const url = frame.url();
      // Only the blank page a new tab starts on is exempt. Going back to it later is leaving.
      if (url === 'about:blank' && !left) return;
      left = true;
      const reason = refuseRequest(url, true, allowed);
      // A redirect is not seen as a request, so the place the page ends up is judged here.
      if (reason) violation ??= `the page went to ${url.slice(0, 200)}: ${reason}`;
    });
  };

  context.on('page', (page) => {
    if (!first) {
      first = page;
      watch(page);
      return;
    }
    // A capture is one page. A popup is closed, not followed.
    void page.close().catch(() => undefined);
  });

  await context.route('**/*', async (route) => {
    try {
      const request = route.request();
      const url = request.url();
      let navigation = false;
      if (request.isNavigationRequest()) {
        try {
          navigation = request.frame().parentFrame() === null;
        } catch {
          // No frame yet: a new page's first navigation. Judge it as a top-level one.
          navigation = true;
        }
      }
      const reason = refuseRequest(url, navigation, allowed);
      if (reason) {
        if (refused.length < 200) refused.push({ url: url.slice(0, 300), reason });
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    } catch {
      // The page or request went away mid-decision. Never let that take the process down.
      await route.abort('blockedbyclient').catch(() => undefined);
    }
  });
  await context.routeWebSocket(/.*/, (socket) => socket.close());
  // Belt and braces for what the flags already turn off.
  await context.addInitScript(
    'for (const k of ["RTCPeerConnection","webkitRTCPeerConnection","SharedWorker"]) { try { delete window[k]; } catch (e) {} }',
  );

  return { violation: () => violation, refused };
}
