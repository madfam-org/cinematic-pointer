import net from 'net';
import { URL } from 'url';

import {
  guardPage,
  hostAllowed,
  isPrivateAddress,
  refuseHost,
  refuseRequest,
  startEgressProxy,
} from '../cinema/egress';

const ALLOWED = ['enclii.dev', '.madfam.io'];

describe('host list', () => {
  it('an entry is exact and a leading dot is any subdomain', () => {
    expect(hostAllowed('enclii.dev', ALLOWED)).toBe(true);
    expect(hostAllowed('CV.madfam.io.', ALLOWED)).toBe(true);
    expect(hostAllowed('madfam.io', ALLOWED)).toBe(false);
    expect(hostAllowed('www.enclii.dev', ALLOWED)).toBe(false);
    expect(hostAllowed('evilmadfam.io', ALLOWED)).toBe(false);
    expect(hostAllowed('madfam.io.evil.com', ALLOWED)).toBe(false);
    expect(hostAllowed('enclii.dev', [])).toBe(false);
  });
});

describe('private addresses', () => {
  it.each([
    '10.0.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    '192.0.0.1',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '240.0.0.1',
    '2002:0a00:0001::1',
    '2001:0:1::1',
    '2001:db8::1',
    'fec0::1',
    '::ffff:7f00:1',
    'not-an-address',
  ])('%s is not public', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    '1.1.1.1',
    '172.32.0.1',
    '100.63.0.1',
    '192.0.78.1', // a real public range next to the reserved 192.0.0.0/24
    '2606:4700::1111',
    '::ffff:1.1.1.1',
  ])('%s is public', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe('refusing a request', () => {
  it('lets the page navigate to a listed host over https', () => {
    expect(refuseRequest('https://enclii.dev/pricing', true, ALLOWED)).toBeNull();
    expect(refuseRequest('https://cv.madfam.io/', true, ALLOWED)).toBeNull();
  });

  it.each([
    ['https://example.com/', 'not listed'],
    ['http://enclii.dev/', 'not https'],
    ['https://enclii.dev:8443/', 'default https port'],
    ['data:text/html,<h1>x</h1>', 'only navigate to a listed host'],
    ['https://10.0.0.1/', 'an address'],
  ])('refuses a navigation to %s', (url, reason) => {
    expect(refuseRequest(url, true, ALLOWED)).toContain(reason);
  });

  it('lets a sub-resource come from another public name, and inline data', () => {
    expect(refuseRequest('https://fonts.gstatic.com/a.woff2', false, ALLOWED)).toBeNull();
    expect(refuseRequest('data:image/png;base64,AAAA', false, ALLOWED)).toBeNull();
  });

  it.each([
    'http://fonts.example.com/a.woff2',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/',
    'https://localhost/',
    'https://redis/',
    'https://ceq-api.ceq.svc.cluster.local/',
    'https://db.internal/',
    'https://cdn.example.com:8443/x.js',
    'file:///etc/passwd',
    'ftp://example.com/x',
  ])('refuses the sub-resource %s', (url) => {
    expect(refuseRequest(url, false, ALLOWED)).not.toBeNull();
  });
});

describe('host names', () => {
  it.each([
    'localhost',
    'localhost.',
    'a.svc.cluster.local.',
    'redis',
    'db.internal',
    '10.0.0.1',
    '[::1]',
    'ex ample.com',
    'a_b.example.com',
    '',
  ])('refuses %s before any lookup', (host) => {
    expect(refuseHost(host)).not.toBeNull();
  });

  it('accepts a plain public name, with or without a trailing dot', () => {
    expect(refuseHost('cdn.example.com')).toBeNull();
    expect(refuseHost('CDN.Example.com.')).toBeNull();
  });

  it('numeric spellings of an address are addresses once the URL is parsed', () => {
    for (const url of ['https://2130706433/', 'https://0x7f.1/', 'https://127.1/']) {
      expect(refuseRequest(url, false, ALLOWED)).toBe('an address, not a name');
    }
  });
});

describe('egress proxy', () => {
  let upstream: net.Server;
  let upstreamPort: number;
  let reached: string[];

  beforeEach(async () => {
    reached = [];
    upstream = net.createServer((socket) => {
      socket.on('data', (chunk) => socket.write(`echo:${chunk.toString()}`));
    });
    await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', () => done()));
    upstreamPort = (upstream.address() as net.AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((done) => upstream.close(() => done()));
  });

  /** A proxy whose "internet" is the local echo server, and whose names resolve as given. */
  function proxy(names: Record<string, string[]>, maxHosts?: number) {
    return startEgressProxy({
      maxHosts,
      resolve: async (host) => {
        if (!(host in names)) throw new Error('ENOTFOUND');
        return names[host];
      },
      connect: (address) => {
        reached.push(address);
        return net.connect(upstreamPort, '127.0.0.1');
      },
    });
  }

  /** Send one raw request to the proxy and return what comes back first. */
  function send(server: string, head: string, after?: string): Promise<string> {
    const port = Number(new URL(server).port);
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1');
      let seen = '';
      socket.on('error', reject);
      socket.on('data', (chunk) => {
        seen += chunk.toString();
        if (after && seen.includes('200 Connection Established') && !seen.includes('echo:')) {
          socket.write(after);
          return;
        }
        socket.end();
      });
      socket.on('close', () => resolve(seen));
      socket.write(head);
    });
  }

  const connectTo = (target: string) => `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`;

  it('tunnels to a public name, connecting to the address it checked', async () => {
    const p = await proxy({ 'cdn.example.com': ['93.184.216.34'] });
    try {
      const reply = await send(p.server, connectTo('cdn.example.com:443'), 'ping');
      expect(reply).toContain('200 Connection Established');
      expect(reply).toContain('echo:ping');
      expect(reached).toEqual(['93.184.216.34']);
      expect(p.refused).toEqual([]);
    } finally {
      await p.close();
    }
  });

  it.each([
    ['rebind.example.com:443', 'resolves to an address that is not public'],
    ['mixed.example.com:443', 'resolves to an address that is not public'],
    ['gone.example.com:443', 'does not resolve'],
    ['cdn.example.com:8443', 'not the default https port'],
    ['cdn.example.com:80', 'not the default https port'],
    ['169.254.169.254:443', 'an address, not a name'],
    ['localhost:443', 'a local name'],
    ['ceq-api.ceq.svc.cluster.local:443', 'a local name'],
  ])('refuses CONNECT %s and opens no connection', async (target, reason) => {
    const p = await proxy({
      'cdn.example.com': ['93.184.216.34'],
      'rebind.example.com': ['10.42.0.7'],
      'mixed.example.com': ['93.184.216.34', '192.168.0.5'],
    });
    try {
      const reply = await send(p.server, connectTo(target));
      expect(reply).toContain('403');
      expect(reached).toEqual([]);
      expect(p.refused).toEqual([{ url: `https://${target}`, reason }]);
    } finally {
      await p.close();
    }
  });

  it('refuses every plain http request', async () => {
    const p = await proxy({});
    try {
      const reply = await send(
        p.server,
        'GET http://169.254.169.254/latest/meta-data/ HTTP/1.1\r\nHost: 169.254.169.254\r\n\r\n',
      );
      expect(reply).toContain('403');
      expect(reached).toEqual([]);
      expect(p.refused[0].reason).toBe('not https');
    } finally {
      await p.close();
    }
  });

  it('stops a page that asks for too many distinct hosts', async () => {
    const p = await proxy({ 'a.example.com': ['1.1.1.1'], 'b.example.com': ['1.1.1.1'] }, 1);
    try {
      expect(await send(p.server, connectTo('a.example.com:443'))).toContain('200');
      expect(await send(p.server, connectTo('b.example.com:443'))).toContain('403');
      expect(await send(p.server, connectTo('a.example.com:443'))).toContain('200');
    } finally {
      await p.close();
    }
  });
});

describe('page guard', () => {
  function fakeContext() {
    let handler: (route: unknown) => Promise<void> = async () => undefined;
    const pages: ((page: unknown) => void)[] = [];
    return {
      context: {
        route: async (_pattern: string, h: (route: unknown) => Promise<void>) => {
          handler = h;
        },
        routeWebSocket: async () => undefined,
        addInitScript: async () => undefined,
        on: (_event: string, listener: (page: unknown) => void) => pages.push(listener),
      },
      open(page: unknown) {
        pages.forEach((listener) => listener(page));
      },
      async send(url: string, request: Record<string, unknown> = {}) {
        const outcome = { aborted: false, continued: false };
        await handler({
          request: () => ({
            url: () => url,
            isNavigationRequest: () => false,
            frame: () => ({ parentFrame: () => null }),
            ...request,
          }),
          abort: async () => {
            outcome.aborted = true;
          },
          continue: async () => {
            outcome.continued = true;
          },
        });
        return outcome;
      },
    };
  }

  function fakePage() {
    const listeners: ((frame: unknown) => void)[] = [];
    const main = { url: () => 'about:blank' };
    return {
      closed: false,
      page: {
        mainFrame: () => main,
        on: (_event: string, listener: (frame: unknown) => void) => listeners.push(listener),
        close: async function (this: unknown) {
          return undefined;
        },
      },
      navigate(url: string, frame: { url: () => string } = main) {
        frame.url = () => url;
        listeners.forEach((listener) => listener(frame));
      },
    };
  }

  const top = { isNavigationRequest: () => true };

  it('lets the page open on a listed host and refuses an unlisted one', async () => {
    const fake = fakeContext();
    const guard = await guardPage(fake.context as never, ALLOWED);

    expect((await fake.send('https://cv.madfam.io/', top)).continued).toBe(true);
    expect((await fake.send('https://example.com/', top)).aborted).toBe(true);
    expect(guard.refused).toEqual([
      { url: 'https://example.com/', reason: 'host example.com is not listed' },
    ]);
  });

  it('a frame inside the page may load another public host', async () => {
    const fake = fakeContext();
    await guardPage(fake.context as never, ALLOWED);
    const inFrame = {
      isNavigationRequest: () => true,
      frame: () => ({ parentFrame: () => ({}) }),
    };

    expect((await fake.send('https://player.example.com/embed', inFrame)).continued).toBe(true);
  });

  it('a navigation with no frame yet is judged as the page itself', async () => {
    const fake = fakeContext();
    await guardPage(fake.context as never, ALLOWED);
    const popup = {
      isNavigationRequest: () => true,
      frame: () => {
        throw new Error('Frame for this navigation request is not available');
      },
    };

    expect((await fake.send('https://example.com/', popup)).aborted).toBe(true);
    expect((await fake.send('https://cv.madfam.io/', popup)).continued).toBe(true);
  });

  it('a request that breaks mid-decision is aborted, not thrown', async () => {
    const fake = fakeContext();
    await guardPage(fake.context as never, ALLOWED);
    const broken = {
      url: () => {
        throw new Error('Target closed');
      },
    };

    await expect(fake.send('https://cv.madfam.io/', broken)).resolves.toMatchObject({
      aborted: true,
    });
  });

  it('a page that ends up off the list, as after a redirect, is a violation', async () => {
    const fake = fakeContext();
    const guard = await guardPage(fake.context as never, ALLOWED);
    const first = fakePage();
    fake.open(first.page);

    first.navigate('https://cv.madfam.io/');
    expect(guard.violation()).toBeNull();
    first.navigate('https://player.example.com/', { url: () => '' }); // a sub-frame: ignored
    expect(guard.violation()).toBeNull();
    first.navigate('http://10.43.0.1:8080/admin');

    expect(guard.violation()).toContain('http://10.43.0.1:8080/admin');
    first.navigate('https://cv.madfam.io/');
    expect(guard.violation()).toContain('10.43.0.1'); // going back does not clear it
  });

  it('a second page is closed, not followed', async () => {
    const fake = fakeContext();
    await guardPage(fake.context as never, ALLOWED);
    const first = fakePage();
    const popup = fakePage();
    let closed = false;
    popup.page.close = async () => {
      closed = true;
      return undefined;
    };

    fake.open(first.page);
    fake.open(popup.page);

    expect(closed).toBe(true);
  });

  it('will not run with an empty list', async () => {
    await expect(guardPage(fakeContext().context as never, [])).rejects.toThrow('empty host list');
  });
});
