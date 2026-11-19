import { guardEgress, hostAllowed, isPrivateAddress, refuseRequest } from '../cinema/egress';

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
    'not-an-address',
  ])('%s is not public', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['1.1.1.1', '172.32.0.1', '100.63.0.1', '2606:4700::1111', '::ffff:1.1.1.1'])(
    '%s is public',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
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

describe('guard', () => {
  function fakeContext() {
    let handler: (route: unknown) => Promise<void> = async () => undefined;
    return {
      context: {
        route: async (_pattern: string, h: (route: unknown) => Promise<void>) => {
          handler = h;
        },
        routeWebSocket: async () => undefined,
      },
      async send(url: string, navigation = false) {
        const outcome = { aborted: false, continued: false };
        await handler({
          request: () => ({
            url: () => url,
            isNavigationRequest: () => navigation,
            frame: () => ({ parentFrame: () => null }),
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

  it('refuses a public-looking name that resolves inside the network', async () => {
    const fake = fakeContext();
    const guard = await guardEgress(fake.context as never, ALLOWED, async (host) =>
      host === 'rebind.madfam.io' ? ['10.42.0.7'] : ['1.1.1.1'],
    );

    expect((await fake.send('https://cv.madfam.io/', true)).continued).toBe(true);
    expect((await fake.send('https://rebind.madfam.io/', true)).aborted).toBe(true);
    expect((await fake.send('https://cdn.example.com/x.js')).continued).toBe(true);
    expect(guard.blocked).toEqual([
      {
        url: 'https://rebind.madfam.io/',
        reason: 'resolves to an address that is not public',
      },
    ]);
  });

  it('refuses a name that does not resolve, and one with any private address', async () => {
    const fake = fakeContext();
    await guardEgress(fake.context as never, ALLOWED, async (host) => {
      if (host === 'gone.madfam.io') throw new Error('ENOTFOUND');
      return ['1.1.1.1', '192.168.0.5'];
    });

    expect((await fake.send('https://gone.madfam.io/', true)).aborted).toBe(true);
    expect((await fake.send('https://mixed.madfam.io/', true)).aborted).toBe(true);
  });

  it('will not run with an empty list', async () => {
    await expect(guardEgress(fakeContext().context as never, [])).rejects.toThrow(
      'empty host list',
    );
  });
});
