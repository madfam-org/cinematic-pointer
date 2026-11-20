/**
 * Page capture
 *
 * One still of the whole page plus its landmarks: the headline, the section headings and the calls
 * to action. Read-only: it scrolls to wake lazy content and takes a picture. It clicks nothing.
 */
import { rm } from 'fs/promises';
import path from 'path';

import { chromium, firefox, Page, webkit } from 'playwright';
import sharp from 'sharp';

import { BrowserType } from '../drivers/playwright';

import { GUARDED_CHROMIUM_ARGS, guardPage, Refusal, startEgressProxy } from './egress';
import { Landmark, PageCapture } from './types';

export interface CaptureOptions {
  url: string;
  outDir: string;
  /** Width the page is laid out at. */
  width?: number;
  /** Stills taller than this are cut off; a browser cannot texture an unbounded image. */
  maxHeight?: number;
  browserType?: BrowserType;
}

/** Runs in the page. Returns visible headings and prominent links or buttons, in page pixels. */
export const LANDMARK_SCRIPT = `(() => {
  const out = [];
  const seen = new Set();
  const add = (kind, el, weight) => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (r.width < 24 || r.height < 12) return;
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return;
    const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    if (!text) return;
    const x = Math.round(r.left + window.scrollX), y = Math.round(r.top + window.scrollY);
    const key = kind + ':' + x + ':' + y;
    if (seen.has(key)) return;
    seen.add(key);
    const mark = { kind, text, x, y, w: Math.round(r.width), h: Math.round(r.height) };
    if (weight !== undefined) mark.weight = weight;
    out.push(mark);
  };
  // Any CSS colour as [r, g, b, a] in sRGB bytes, or null when it paints nothing. The browser does
  // the parsing: a 1x1 canvas takes any notation the page can use (rgb, hex, oklch, color-mix
  // results) and returns the bytes it paints. A string it cannot parse paints nothing.
  const pad = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const parse = (c) => {
    if (!pad || !c || c === 'transparent' || c === 'none') return null;
    pad.clearRect(0, 0, 1, 1);
    pad.fillStyle = 'rgba(0, 0, 0, 0)';
    pad.fillStyle = c;
    pad.fillRect(0, 0, 1, 1);
    const d = pad.getImageData(0, 0, 1, 1).data;
    return d[3] > 0 ? [d[0], d[1], d[2], d[3] / 255] : null;
  };
  // The first colour stop of a gradient, or null. Only a gradient that is the element's only
  // background layer and covers the whole box counts: an underline drawn with a sized gradient, or
  // a tint laid over a photograph, is not a fill.
  const STOP = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\([^()]*\\)|#[0-9a-fA-F]{3,8}\\b|\\b[a-z]+\\b/g;
  const gradientFill = (style) => {
    const image = style.backgroundImage || '';
    if (image.indexOf('url(') >= 0 || image.split('gradient(').length !== 2) return null;
    const size = style.backgroundSize || 'auto';
    if (!/^(auto|auto auto|cover|100% 100%|100%)$/.test(size.trim())) return null;
    const body = image.slice(image.indexOf('gradient(') + 'gradient('.length);
    for (const token of body.match(STOP) || []) {
      if (/^(to|at|in|deg|turn|rad|circle|ellipse|closest|farthest|side|corner|left|right|top|bottom|center|from|srgb|oklab|oklch|hsl|lab|lch|longer|shorter|increasing|decreasing|hue)$/.test(token)) continue;
      const colour = parse(token);
      if (colour) return colour;
      if (token.indexOf('(') >= 0 || token[0] === '#') return null;
    }
    return null;
  };
  // What an element is filled with, its own opacity included.
  const fill = (el) => {
    const style = getComputedStyle(el);
    const c = gradientFill(style) || parse(style.backgroundColor);
    if (!c) return null;
    const opacity = Number(style.opacity);
    return [c[0], c[1], c[2], c[3] * (Number.isFinite(opacity) ? opacity : 1)];
  };
  // How much a control stands out: how solid its fill is, times how far that fill is from what is
  // behind it. A solid brand-coloured button scores high; a faint outline button scores near zero.
  const prominence = (el, own) => {
    let behind = [255, 255, 255, 1];
    for (let p = el.parentElement; p; p = p.parentElement) {
      const c = fill(p);
      if (c && c[3] >= 0.5) { behind = c; break; }
    }
    const d = Math.hypot(own[0] - behind[0], own[1] - behind[1], own[2] - behind[2]) / 441.673;
    const w = Math.round(own[3] * d * 1000) / 1000;
    return Number.isFinite(w) ? Math.min(1, Math.max(0, w)) : undefined;
  };
  // A bar pinned to the screen (a header, a cookie banner) is not the page's call to action.
  const pinned = (el) => {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const position = getComputedStyle(p).position;
      if (position === 'fixed' || position === 'sticky') return true;
    }
    return false;
  };
  document.querySelectorAll('h1').forEach((el) => add('h1', el));
  document.querySelectorAll('h2').forEach((el) => add('h2', el));
  document.querySelectorAll('a, button').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.height < 36 || r.width < 110 || r.width > 420) return;
    const own = fill(el);
    if (own && !pinned(el)) add('cta', el, prominence(el, own));
  });
  return out;
})()`;

const PAGE_FACTS_SCRIPT = `(() => ({
  title: document.title || '',
  width: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
  height: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
  background: (() => {
    const b = getComputedStyle(document.body).backgroundColor;
    const h = getComputedStyle(document.documentElement).backgroundColor;
    const clear = (c) => !c || c === 'transparent' || /rgba\\(.*,\\s*0\\)$/.test(c);
    return !clear(b) ? b : !clear(h) ? h : 'rgb(255, 255, 255)';
  })(),
}))()`;

export interface PageFacts {
  title: string;
  /** The page's own scroll size, which can exceed the width it was laid out at. */
  width: number;
  height: number;
  background: string;
  /** HTTP status of the document, or null when the browser got no response. */
  status: number | null;
  /** Where the browser ended up after redirects. */
  finalUrl: string;
  /** Requests the egress guard refused. Empty when no host list was given. */
  blocked: { url: string; reason: string }[];
}

type MeasuredFacts = Omit<PageFacts, 'status' | 'finalUrl' | 'blocked'>;

/** Measure the page as it stands now. */
export async function measurePage(page: Page): Promise<MeasuredFacts> {
  return (await page.evaluate(PAGE_FACTS_SCRIPT)) as MeasuredFacts;
}

/**
 * Opens the page, walks it once so lazy images and reveal-on-scroll sections are in place, and
 * hands the settled page to `use`. Read-only: it scrolls and looks. It clicks nothing.
 */
export async function withSettledPage<T>(
  options: {
    url: string;
    width: number;
    walkHeight: number;
    browserType?: BrowserType;
    /** When given, the browser may navigate only to these hosts and reach only public addresses. */
    allowHosts?: string[];
  },
  /** `hold` throws once the page has broken a rule; call it before each picture. */
  use: (page: Page, facts: PageFacts, hold: () => void) => Promise<T>,
): Promise<T> {
  const guarded = options.allowHosts !== undefined;
  if (guarded && (options.browserType ?? 'chromium') !== 'chromium') {
    throw new Error('A host list is enforced with Chromium only');
  }
  const refused: Refusal[] = [];
  // With a host list, every connection the browser makes goes through the egress proxy.
  const proxy = guarded ? await startEgressProxy({ refused }) : undefined;
  const launcher = { chromium, firefox, webkit }[options.browserType ?? 'chromium'];
  const browser = await launcher
    .launch({
      headless: true,
      ...(proxy ? { proxy: { server: proxy.server }, args: GUARDED_CHROMIUM_ARGS } : {}),
    })
    .catch(async (error: unknown) => {
      await proxy?.close();
      throw error;
    });
  try {
    const context = await browser.newContext({
      viewport: { width: options.width, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
      serviceWorkers: guarded ? 'block' : 'allow',
    });
    const guard = options.allowHosts
      ? await guardPage(context, options.allowHosts, refused)
      : undefined;
    /** Fail the capture the moment the page has left the list: it must not be pictured. */
    const hold = () => {
      const violation = guard?.violation();
      if (violation) throw new Error(`The capture was stopped: ${violation}`);
    };
    const page = await context.newPage();
    const response = await page
      .goto(options.url, { waitUntil: 'load', timeout: 60000 })
      .catch((error: unknown) => {
        hold();
        // When the guard refused the page itself, say that instead of a browser error.
        const host = new URL(options.url).host;
        const first = refused.find(
          (entry) => entry.url.startsWith(options.url) || entry.url === `https://${host}:443`,
        );
        if (first) throw new Error(`The page was refused: ${first.reason}`);
        throw error;
      });
    hold();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);

    // The height is re-read as the walk goes: content that appears on scroll makes the page longer,
    // and that part has to be walked too or its lazy images are pictured unloaded.
    for (let y = 0; y < Math.min((await measurePage(page)).height, options.walkHeight); y += 700) {
      await page.evaluate(`window.scrollTo(0, ${y})`);
      await page.waitForTimeout(120);
    }
    await page.evaluate('window.scrollTo(0, 0)');
    await page.waitForTimeout(300);
    hold();

    const result = await use(
      page,
      {
        ...(await measurePage(page)),
        status: response ? response.status() : null,
        finalUrl: page.url(),
        blocked: refused,
      },
      hold,
    );
    // Checked once more after the pictures: a page that left the list while it was being
    // pictured fails here, and the caller discards what was written.
    hold();
    return result;
  } finally {
    try {
      await browser.close();
    } finally {
      await proxy?.close();
    }
  }
}

/** The landmarks that lie wholly inside a capture of `width` by `height`, top to bottom. */
export async function readLandmarks(
  page: Page,
  width: number,
  height: number,
): Promise<Landmark[]> {
  return ((await page.evaluate(LANDMARK_SCRIPT)) as Landmark[])
    .filter((m) => m.y + m.h <= height && m.x >= 0 && m.x + m.w <= width)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export async function capturePage(options: CaptureOptions): Promise<PageCapture> {
  const width = options.width ?? 1440;
  const maxHeight = options.maxHeight ?? 12000;
  return withSettledPage(
    { url: options.url, width, walkHeight: maxHeight, browserType: options.browserType },
    async (page, facts) => {
      const height = Math.min(facts.height, maxHeight);
      const image = 'page.png';
      const full = path.join(options.outDir, 'page-full.png');
      const target = path.join(options.outDir, image);
      // fullPage captures beyond the viewport without resizing it, so viewport-height layouts keep
      // their shape. A page taller than the limit is cut to it afterwards.
      await page.screenshot({ path: facts.height > maxHeight ? full : target, fullPage: true });
      if (facts.height > maxHeight) {
        await sharp(full).extract({ left: 0, top: 0, width, height }).toFile(target);
        await rm(full, { force: true });
      }
      return {
        url: options.url,
        title: facts.title,
        width,
        height,
        image,
        background: facts.background,
        landmarks: await readLandmarks(page, width, height),
      };
    },
  );
}
