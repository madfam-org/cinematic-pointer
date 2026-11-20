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
const LANDMARK_SCRIPT = `(() => {
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
  // A colour as [r, g, b, a], or null when it paints nothing.
  const parse = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c || '');
    if (!m) return null;
    const n = m[1].split(/[,\\s\\/]+/).filter(Boolean).map(parseFloat);
    const a = n.length > 3 ? n[3] : 1;
    return n.length >= 3 && a > 0 ? [n[0], n[1], n[2], a] : null;
  };
  // What an element is filled with: its background colour, or the first stop of its gradient.
  const fill = (el) => {
    const style = getComputedStyle(el);
    const image = style.backgroundImage || '';
    return (image.indexOf('gradient') >= 0 ? parse(image) : null) || parse(style.backgroundColor);
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
    return Math.round(own[3] * d * 1000) / 1000;
  };
  document.querySelectorAll('h1').forEach((el) => add('h1', el));
  document.querySelectorAll('h2').forEach((el) => add('h2', el));
  document.querySelectorAll('a, button').forEach((el) => {
    const r = el.getBoundingClientRect();
    const own = fill(el);
    // A fill in a notation this script cannot read still counts as filled; it only goes unweighed.
    const bg = getComputedStyle(el).backgroundColor;
    const filled = own || (bg && bg !== 'transparent' && !/rgba\\(.*,\\s*0\\)$/.test(bg));
    if (filled && r.height >= 36 && r.width >= 110 && r.width <= 420) {
      add('cta', el, own ? prominence(el, own) : undefined);
    }
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
