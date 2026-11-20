// @ts-check
/**
 * The server behind trailer.madfam.io: one host, one stateless page in two languages.
 *
 * - `/` (Spanish, the source language) and `/en`, built once at start-up.
 * - `/health` (liveness) and `/ready` (the site was built) answer GET and HEAD on any host, so the
 *   kubelet's probes need no Host header.
 * - `/metrics` answers only on the internal metrics port, which is never routed.
 * - Everything carries `X-Robots-Tag: noindex, nofollow` and `/robots.txt` disallows all until the
 *   owner says to index (config.INDEXABLE).
 * - In production any other host gets 421.
 * - The clip answers byte ranges, which some browsers require before they play a video.
 *
 * No database, no sign-in, no cookie, no analytics, no outbound call, no secret.
 */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { INDEXABLE, SERVICE, configFromEnv } from './config.mjs';
import * as metrics from './metrics.mjs';
import { buildSite } from './site.mjs';

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; " +
  "media-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const TEXT = 'text/plain; charset=utf-8';
const ROBOTS = INDEXABLE ? 'User-agent: *\nAllow: /\n' : 'User-agent: *\nDisallow: /\n';
const PAGE_OF = /** @type {Record<string, string>} */ ({ '/': 'es', '/en': 'en', '/en/': 'en' });

/**
 * Weak comparison of an If-None-Match header against one validator: a list, a `W/` prefix and `*`
 * all count, as a cache in front of the server may send any of them.
 * @param {string | undefined} header @param {string} etag
 */
export function matches(header, etag) {
  if (!header) return false;
  const strip = (/** @type {string} */ v) => v.trim().replace(/^W\//, '');
  return header.trim() === '*' || header.split(',').some((v) => strip(v) === etag);
}

/**
 * One byte range of a body: `bytes=a-b`, `bytes=a-` or `bytes=-n`. Returns null for anything else
 * (several ranges, another unit), which the caller answers with the whole body, and `false` for a
 * range that cannot be satisfied.
 * @param {string | undefined} header @param {number} size
 * @returns {{ start: number, end: number } | null | false}
 */
export function byteRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return false;
    start = Math.max(size - n, 0);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return false;
  return { start, end };
}

/**
 * @typedef {{ route: string, status: number, type: string, body: Buffer | string, extra: Record<string, string> }} Answer
 */

/**
 * @param {import('./config.mjs').Config} config
 * @param {import('./site.mjs').Site} site
 */
export function createApp(config, site) {
  /** @param {string} type */
  const headers = (type) => ({
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Content-Security-Policy': CSP,
    ...(config.production
      ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }
      : {}),
    ...(INDEXABLE ? {} : { 'X-Robots-Tag': 'noindex, nofollow' }),
  });
  const json = (/** @type {unknown} */ value) => Buffer.from(JSON.stringify(value));

  /**
   * @param {string} method @param {string} host @param {string} path
   * @param {{ ifNoneMatch?: string, range?: string }} conditions
   * @returns {Answer}
   */
  function route(method, host, path, conditions) {
    const noStore = { 'Cache-Control': 'no-store' };
    const reads = method === 'GET' || method === 'HEAD';
    if (path === '/health' && reads) {
      const body = json({ status: 'ok', service: SERVICE, revision: config.revision });
      return { route: 'health', status: 200, type: 'application/json', body, extra: noStore };
    }
    if (path === '/ready' && reads) {
      const languages = Object.keys(site.pages).sort();
      const ok = languages.length === 2 && site.facts.products > 0 && site.facts.assets > 0;
      const body = json({ status: ok ? 'ok' : 'unready', ...site.facts, languages });
      return {
        route: 'health',
        status: ok ? 200 : 503,
        type: 'application/json',
        body,
        extra: noStore,
      };
    }
    if (config.production && !config.hosts.includes(host)) {
      return {
        route: 'refused',
        status: 421,
        type: TEXT,
        body: 'this host is not served here\n',
        extra: noStore,
      };
    }
    if (!reads) {
      return {
        route: 'refused',
        status: 405,
        type: TEXT,
        body: 'GET only\n',
        extra: { ...noStore, Allow: 'GET, HEAD' },
      };
    }
    if (path === '/robots.txt') {
      return {
        route: 'static',
        status: 200,
        type: TEXT,
        body: ROBOTS,
        extra: { 'Cache-Control': 'public, max-age=600' },
      };
    }
    const lang = PAGE_OF[path];
    const found = lang ? site.pages[lang] : site.assets.get(path);
    if (found) {
      // Outside production nothing is cached, so an edit shows on the next load. In production the
      // typefaces and the footage are cached by time (their names change when they do); the page,
      // the stylesheet and the script revalidate on every load (a cheap 304).
      const longLived =
        found.type === 'font/woff2' || found.type === 'video/mp4' || found.type === 'image/webp';
      const cache = !config.production
        ? 'no-store'
        : longLived
          ? 'public, max-age=604800'
          : 'no-cache';
      const name = lang ? 'page' : 'static';
      /** @type {Record<string, string>} */
      const extra = { ETag: found.etag, 'Cache-Control': cache };
      if (lang) extra['Content-Language'] = lang;
      if (found.type === 'video/mp4') extra['Accept-Ranges'] = 'bytes';
      if (config.production && matches(conditions.ifNoneMatch, found.etag)) {
        return { route: name, status: 304, type: found.type, body: '', extra };
      }
      if (found.type === 'video/mp4') {
        const size = found.body.length;
        const range = byteRange(conditions.range, size);
        if (range === false) {
          return {
            route: name,
            status: 416,
            type: TEXT,
            body: 'range not satisfiable\n',
            extra: { ...noStore, 'Content-Range': `bytes */${size}` },
          };
        }
        if (range) {
          extra['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
          return {
            route: name,
            status: 206,
            type: found.type,
            body: found.body.subarray(range.start, range.end + 1),
            extra,
          };
        }
      }
      return { route: name, status: 200, type: found.type, body: found.body, extra };
    }
    const missingLang = path.startsWith('/en/') ? 'en' : 'es';
    const page = site.missing[missingLang];
    return {
      route: 'missing',
      status: 404,
      type: page.type,
      body: page.body,
      extra: { ...noStore, 'Content-Language': missingLang },
    };
  }

  /** @type {import('node:http').RequestListener} */
  return (req, res) => {
    const started = process.hrtime.bigint();
    const method = (req.method ?? 'GET').toUpperCase();
    const host = (req.headers.host ?? '').split(':')[0].toLowerCase();
    /** @type {Answer} */
    let answer;
    try {
      let path;
      // A request target the URL parser refuses is the client's error, not ours: 400, and no trace.
      try {
        path = new URL(req.url ?? '/', 'http://local').pathname;
      } catch {
        path = null;
      }
      answer =
        path === null
          ? {
              route: 'refused',
              status: 400,
              type: TEXT,
              body: 'bad request target\n',
              extra: { 'Cache-Control': 'no-store' },
            }
          : route(method, host, path, {
              ifNoneMatch: req.headers['if-none-match'],
              range: req.headers.range,
            });
    } catch (error) {
      console.error(error); // never leak a trace to the client
      answer = { route: 'error', status: 500, type: TEXT, body: 'unexpected error\n', extra: {} };
    }
    // HEAD reports the length GET would send; 304 carries no body and no length.
    const length =
      answer.status === 304 ? {} : { 'Content-Length': Buffer.byteLength(answer.body) };
    res.writeHead(answer.status, { ...headers(answer.type), ...answer.extra, ...length });
    res.end(method === 'HEAD' || answer.status === 304 ? undefined : answer.body);
    metrics.observe(answer.route, answer.status, Number(process.hrtime.bigint() - started) / 1e9);
  };
}

/** @type {import('node:http').RequestListener} */
function metricsApp(req, res) {
  const ok = req.url === '/metrics' && req.method === 'GET';
  const body = ok ? metrics.render() : 'not found\n';
  res.writeHead(ok ? 200 : 404, {
    'Content-Type': 'text/plain; version=0.0.4',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Start both listeners. Returns them so a caller can close them. */
export async function start(config = configFromEnv()) {
  const site = buildSite();
  // Outside production the site is rebuilt for every request, so an edit shows on the next load.
  const main = createServer(
    config.production
      ? createApp(config, site)
      : (req, res) => createApp(config, buildSite())(req, res),
  );
  const side = createServer(metricsApp);
  main.keepAliveTimeout = 75_000;
  await new Promise((resolve) => main.listen(config.port, () => resolve(undefined)));
  await new Promise((resolve) => side.listen(config.metricsPort, () => resolve(undefined)));
  console.log(
    JSON.stringify({
      msg: 'listening',
      service: SERVICE,
      env: config.env,
      port: config.port,
      metricsPort: config.metricsPort,
      hosts: config.hosts,
      revision: config.revision,
      ...site.facts,
    }),
  );
  const stop = () => {
    main.close();
    side.close();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  return { main, side, site, stop };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
