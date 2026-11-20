// @ts-check
// The landing's contract: hosts, headers, both languages, the clip's byte ranges, no third-party
// request, and the deployment files agreeing with each other. Run: node --test site/server/test/*.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { INDEXABLE, configFromEnv } from '../config.mjs';
import { byteRange, createApp, matches } from '../server.mjs';
import { buildSite, fill } from '../site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (/** @type {string} */ path) => readFileSync(join(ROOT, path), 'utf8');
const HOST = 'trailer.madfam.io';
const site = buildSite();
const config = configFromEnv({ TRAILER_ENV: 'production', TRAILER_REVISION: 'test' });
/** @type {import('node:http').Server} */
let server;
let base = '';

before(async () => {
  server = createServer(createApp(config, site));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  base = `http://127.0.0.1:${address.port}`;
});
after(() => server.close());

/** fetch() may not set Host, so requests go through node:http. */
async function get(
  /** @type {string} */ path,
  /** @type {Record<string, string>} */ headers = {},
  method = 'GET',
) {
  const { request } = await import('node:http');
  return new Promise((resolve, reject) => {
    const req = request(base + path, { method, headers: { Host: HOST, ...headers } }, (res) => {
      /** @type {Buffer[]} */
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

test('both languages are served, with the same structure', async () => {
  const es = await get('/');
  const en = await get('/en');
  assert.equal(es.status, 200);
  assert.equal(en.status, 200);
  assert.equal(es.headers['content-language'], 'es');
  assert.equal(en.headers['content-language'], 'en');
  const tags = (/** @type {Buffer} */ b) =>
    (b.toString().match(/<[a-z][a-z0-9]*/g) ?? []).join(' ');
  assert.equal(tags(es.body), tags(en.body));
  assert.match(es.body.toString(), /<html lang="es">/);
  assert.match(en.body.toString(), /<html lang="en">/);
  assert.doesNotMatch(es.body.toString(), /\{\{/);
});

test('every response is unindexed and carries the security headers', async () => {
  assert.equal(INDEXABLE, false, 'indexing is switched on by the owner, in code');
  for (const path of ['/', '/en', '/landing.css', '/footage/shot-1.webp', '/nope']) {
    const res = await get(path);
    assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow', path);
    assert.equal(res.headers['x-content-type-options'], 'nosniff', path);
    assert.match(String(res.headers['content-security-policy']), /default-src 'none'/, path);
    assert.match(String(res.headers['strict-transport-security']), /max-age=31536000/, path);
    assert.equal(res.headers['set-cookie'], undefined, path);
  }
  assert.match(
    (await get('/')).body.toString(),
    /<meta name="robots" content="noindex, nofollow">/,
  );
  assert.equal((await get('/robots.txt')).body.toString(), 'User-agent: *\nDisallow: /\n');
});

test('another host is refused, health answers on any host, metrics is not on this port', async () => {
  assert.equal((await get('/', { Host: 'other.example' })).status, 421);
  const health = await get('/health', { Host: 'anything' });
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body.toString()), {
    status: 'ok',
    service: 'cinematic-pointer-landing',
    revision: 'test',
  });
  const ready = JSON.parse((await get('/ready', { Host: 'anything' })).body.toString());
  assert.equal(ready.status, 'ok');
  assert.deepEqual(ready.languages, ['en', 'es']);
  assert.equal((await get('/metrics')).status, 404);
  assert.equal((await get('/', {}, 'POST')).status, 405);
  assert.equal((await get('/nope')).status, 404);
});

test('the page makes no request to another origin', () => {
  const allowed = ['https://github.com/madfam-org/cinematic-pointer'];
  for (const [name, page] of Object.entries(site.pages)) {
    const html = page.body.toString();
    for (const m of html.matchAll(/(?:src|poster|action)="([^"]+)"|<link[^>]+href="([^"]+)"/g)) {
      const url = m[1] ?? m[2];
      assert.ok(url.startsWith('/') && !url.startsWith('//'), `${name}: ${url} is not same-origin`);
    }
    for (const m of html.matchAll(/<a[^>]+href="(https?:[^"]+)"/g))
      assert.ok(allowed.includes(m[1]), `${name}: link to ${m[1]}`);
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc="\/)/, `${name}: inline script`);
    assert.doesNotMatch(html, /\sstyle="/, `${name}: inline style, which the policy refuses`);
  }
  const css = /** @type {{ body: Buffer }} */ (site.assets.get('/landing.css')).body.toString();
  assert.doesNotMatch(css, /url\(["']?(?:https?:)?\/\//);
  const js = /** @type {{ body: Buffer }} */ (site.assets.get('/landing.js')).body.toString();
  assert.doesNotMatch(js, /fetch\(|XMLHttpRequest|sendBeacon|https?:\/\//);
});

test('the copy states no price and the real count of filmable products', () => {
  const catalog = JSON.parse(read('catalog/products.json'));
  for (const page of Object.values(site.pages)) {
    const text = page.body.toString().replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(text, /[$€]\s?\d|\d\s?(?:USD|MXN|EUR)\b/);
    assert.match(
      text,
      new RegExp(
        `(?:lista hoy|lists) ${catalog.products.length} (?:productos filmables|filmable products)`,
      ),
    );
  }
});

test('the clip answers byte ranges', async () => {
  const path = '/footage/enclii-landing-take.mp4';
  const whole = await get(path);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers['accept-ranges'], 'bytes');
  const size = whole.body.length;
  const part = await get(path, { Range: 'bytes=0-99' });
  assert.equal(part.status, 206);
  assert.equal(part.headers['content-range'], `bytes 0-99/${size}`);
  assert.equal(part.body.length, 100);
  assert.deepEqual(part.body, whole.body.subarray(0, 100));
  const tail = await get(path, { Range: 'bytes=-10' });
  assert.equal(tail.status, 206);
  assert.equal(tail.headers['content-range'], `bytes ${size - 10}-${size - 1}/${size}`);
  const stale = await get(path, { Range: 'bytes=0-99', 'If-Range': '"another"' });
  assert.equal(stale.status, 200);
  assert.equal(stale.body.length, size);
  const fresh = await get(path, { Range: 'bytes=0-99', 'If-Range': String(whole.headers.etag) });
  assert.equal(fresh.status, 206);
  assert.deepEqual(tail.body, whole.body.subarray(size - 10));
  assert.equal((await get(path, { Range: `bytes=${size}-` })).status, 416);
  assert.equal((await get(path, { 'If-None-Match': String(whole.headers.etag) })).status, 304);
});

test('helpers', () => {
  assert.deepEqual(byteRange('bytes=5-', 10), { start: 5, end: 9 });
  assert.deepEqual(byteRange('bytes=0-999', 10), { start: 0, end: 9 });
  assert.equal(byteRange('bytes=0-1,3-4', 10), null);
  assert.equal(byteRange('bytes=-0', 10), false);
  assert.equal(matches('W/"a", "b"', '"b"'), true);
  assert.equal(matches(undefined, '"b"'), false);
  assert.equal(fill('{{t:a}} {{v:b}} {{h:c}}', { a: '<' }, { b: 1 }, { c: '<i>' }), '&lt; 1 <i>');
  assert.throws(() => fill('{{t:missing}}', {}, {}, {}));
  assert.throws(() => configFromEnv({ TRAILER_ENV: 'prod' }));
  assert.throws(() => configFromEnv({ TRAILER_PORT: '9090' }));
});

test('every shipped footage and typeface file has a record', () => {
  const footage = JSON.parse(read('site/web/footage/SOURCE.json'));
  const fonts = JSON.parse(read('site/web/fonts/SOURCE.json'));
  const recorded = new Set([
    ...Object.keys(footage.files).map((f) => `/footage/${f}`),
    ...Object.values(fonts.families).flatMap((f) =>
      f.files.map((/** @type {string} */ n) => `/fonts/${n}`),
    ),
  ]);
  for (const url of site.assets.keys()) {
    if (url.startsWith('/footage/') || url.startsWith('/fonts/'))
      assert.ok(recorded.has(url), `${url} has no record`);
  }
  for (const family of Object.values(fonts.families))
    assert.match(read(`site/web/fonts/${family.licence}`), /SIL OPEN FONT LICENSE/i);
});

test('the deployment files agree with each other', () => {
  const name = 'cinematic-pointer-landing';
  const enclii = read('enclii.yaml');
  const deployment = read('infra/k8s/production/deployment.yaml');
  const kustomization = read('infra/k8s/production/kustomization.yaml');
  const workflow = read('.github/workflows/landing.yml');
  const dockerfile = read('site/Dockerfile');
  assert.match(enclii, new RegExp(`- name: ${HOST}\\n\\s+environment: production\\n\\s+port: 80`));
  assert.match(enclii, /autoDeploy: false/);
  assert.equal(
    (enclii.match(/^\s+- name: [a-z0-9-]+\.madfam\.io$/gm) ?? []).length,
    1,
    'one host, one level under madfam.io',
  );
  assert.match(deployment, new RegExp(`name: TRAILER_PUBLIC_HOSTS\\n\\s+value: ${HOST}`));
  for (const needle of [
    'replicas: 2',
    'maxUnavailable: 0',
    'readOnlyRootFilesystem: true',
    'enableServiceLinks: false',
    'automountServiceAccountToken: false',
    'drop: [ALL]',
  ]) {
    assert.ok(deployment.includes(needle), needle);
  }
  assert.doesNotMatch(deployment + kustomization, /secretKeyRef|kind: Secret|ExternalSecret/);
  assert.match(
    deployment,
    new RegExp(`^\\s+image: ghcr\\.io/madfam-org/${name}:latest$`, 'm'),
    'the image name the digest pin rewrites',
  );
  assert.match(workflow, new RegExp(`default: ${name}\\n`), 'a dispatch always builds the service');
  assert.match(
    kustomization,
    new RegExp(`digest: sha256:[0-9a-f]{64}\\n\\s+name: ghcr.io/madfam-org/${name}`),
  );
  assert.match(workflow, new RegExp(`"name":"${name}", "dockerfile":"site/Dockerfile"`));
  assert.doesNotMatch(workflow, /^\s+(push|pull_request|schedule):/m, 'dispatch only');
  assert.match(workflow, /build-publish\.yml@[0-9a-f]{40} /);
  const copied = [...dockerfile.matchAll(/^COPY (?!--from)(\S+) /gm)].map((m) => m[1]);
  assert.deepEqual(copied, ['site/server', 'site/web', 'catalog/products.json']);
  const paths = /"paths":"([^"]+)"/.exec(workflow)?.[1].split(' ') ?? [];
  for (const source of copied)
    assert.ok(paths.includes(source), `${source} is copied but not watched`);
  assert.match(dockerfile, /^FROM node:22-slim@sha256:[0-9a-f]{64} AS runtime$/m);
  assert.match(dockerfile, /^USER 1001:1001$/m);
});
