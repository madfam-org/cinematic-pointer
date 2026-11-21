/**
 * Live time: a page's own motion is frame-exact once its clock is frozen.
 *
 * Most pages here are served over HTTP and opened with `goto`, as a take opens them: a new document
 * replays Playwright's clock log, which `setContent` never does.
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { tmpdir } from 'os';
import path from 'path';

import { expect, Page, test } from '@playwright/test';
import sharp from 'sharp';

import { drawLivePointer, mountLivePointer, planLivePointer } from '../../src/pointer/live';
import { pointerAt } from '../../src/pointer/motion';
import { PERSONAS } from '../../src/pointer/persona';

import {
  checkDocument,
  EPOCH,
  installLiveTime,
  markDocument,
  settle,
} from '../../src/recorders/livetime';

const PAGE = `<!doctype html><html><body>
<div id="raf">0</div><div id="timer">0</div>
<div id="box" style="width:10px;height:10px;background:red;animation:slide 4s linear infinite"></div>
<style>@keyframes slide { from { margin-left: 0px } to { margin-left: 400px } }</style>
<script>
  var start = performance.now();
  function tick(now) { document.getElementById('raf').textContent = String(Math.round(now - start)); requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
  var count = 0;
  setInterval(function () { document.getElementById('timer').textContent = String(++count); }, 100);
</script></body></html>`;

const pages: Record<string, { type: string; body: string | Buffer }> = {
  '/canvas': {
    type: 'text/html',
    body: `<!doctype html><canvas id="c" width="200" height="200"></canvas><script>
      window.__start = performance.now(); window.__date = Date.now();
      var ctx = document.getElementById('c').getContext('2d'), t0 = performance.now();
      function draw(now) { var t = (now - t0) / 1000; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 200, 200);
        ctx.fillStyle = '#000'; ctx.fillRect(100 + 80 * Math.cos(t * 3), 100 + 80 * Math.sin(t * 3), 12, 12);
        requestAnimationFrame(draw); }
      requestAnimationFrame(draw);</script>`,
  },
  '/stamps': {
    type: 'text/html',
    body: `<!doctype html><script>
      window.__stamps = [];
      function f(t) { window.__stamps.push(t); requestAnimationFrame(f); }
      requestAnimationFrame(f);</script>`,
  },
  '/throws': {
    type: 'text/html',
    body: `<!doctype html><div id="n">0</div><script>
      setTimeout(function () { throw new Error('boom from a timer'); }, 50);
      setInterval(function () { throw new Error('boom every 200 ms'); }, 200);
      var n = 0;
      setInterval(function () { document.getElementById('n').textContent = String(++n); }, 100);
      requestAnimationFrame(function again() {
        requestAnimationFrame(again);
        if (performance.now() > 400 && !window.__threw) { window.__threw = true; throw new Error('boom in a frame'); }
      });</script>`,
  },
  '/zero': {
    type: 'text/html',
    body: `<!doctype html><script>
      window.__c = 0;
      setInterval(function () { window.__c++; }, 0);
      setInterval(function () { window.__c++; });
      setInterval(function () { window.__c++; }, 'soon');
      setTimeout(function again() { window.__c++; setTimeout(again, -5); }, -1);</script>`,
  },
  '/animations': {
    type: 'text/html',
    body: `<!doctype html><style>
      @keyframes slide { from { margin-left: 0px } to { margin-left: 400px } }
      div { width: 10px; height: 10px; background: red }
      #held { animation: slide 4s linear infinite paused }
      #reveal { animation: slide 4s linear infinite paused }
      @keyframes fade { from { opacity: 1 } to { opacity: 0.2 } }
      #pair { animation: slide 4s linear infinite, fade 4s linear infinite; animation-play-state: running, paused }</style>
      <div id="pair"></div>
      <div id="held"></div><div id="reveal"></div><div id="fast"></div><div id="once"></div><div id="stop"></div>
      <script>
      var frames = [{ marginLeft: '0px' }, { marginLeft: '400px' }];
      var fast = document.getElementById('fast').animate(frames, { duration: 4000, iterations: Infinity });
      fast.playbackRate = 2;
      setInterval(function () { fast.play(); }, 50);
      var once = document.getElementById('once').animate(frames, { duration: 300 });
      once.onfinish = function () { window.__finished = true; };
      var stop = document.getElementById('stop').animate(frames, { duration: 4000 });
      setTimeout(function () { stop.pause(); }, 200);
      setTimeout(function () { document.getElementById('reveal').style.animationPlayState = 'running'; }, 300);
      </script>`,
  },
  '/trusted': {
    type: 'text/html',
    body: `<!doctype html><html><head>
      <meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'">
      </head><body style="margin:0;height:3000px"><h1 style="margin:200px 0 0 100px;width:400px">Headline</h1></body></html>`,
  },
  '/redirect': {
    type: 'text/html',
    body: `<!doctype html><script>setTimeout(function () { location.href = '/canvas'; }, 100);</script>`,
  },
  '/poster.svg': {
    type: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#ff0000"/></svg>',
  },
  '/video': {
    type: 'text/html',
    body: `<!doctype html><body style="margin:0">
      <video id="click" width="160" height="120" poster="/poster.svg" src="/clip.webm" preload="auto" muted></video>
      <video id="auto" width="160" height="120" src="/clip.webm" preload="auto" autoplay muted loop></video></body>`,
  },
};

let server: Server;
let origin = '';
let clipDir = '';
let hasClip = false;

test.beforeAll(async () => {
  // A two-second green clip, made here so no recording is committed.
  clipDir = mkdtempSync(path.join(tmpdir(), 'cp-live-time-'));
  const clip = path.join(clipDir, 'clip.webm');
  const made = spawnSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x00ff00:s=160x120:d=2:r=10',
    '-c:v',
    'libvpx',
    '-b:v',
    '200k',
    clip,
  ]);
  hasClip = made.status === 0;
  if (hasClip) pages['/clip.webm'] = { type: 'video/webm', body: readFileSync(clip) };

  server = createServer((req, res) => {
    const found = pages[(req.url ?? '/').split('?')[0]];
    if (!found) {
      res.writeHead(404).end();
      return;
    }
    // Byte ranges, as a real server answers them: Chrome cannot seek a video without them.
    const body = typeof found.body === 'string' ? Buffer.from(found.body) : found.body;
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      res
        .writeHead(206, {
          'content-type': found.type,
          'accept-ranges': 'bytes',
          'content-range': `bytes ${start}-${end}/${body.length}`,
          'content-length': String(end - start + 1),
        })
        .end(body.subarray(start, end + 1));
      return;
    }
    res
      .writeHead(200, {
        'content-type': found.type,
        'accept-ranges': 'bytes',
        'content-length': String(body.length),
        'cache-control': 'no-store',
      })
      .end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(clipDir, { recursive: true, force: true });
});

const num = (page: Page, script: string) => page.evaluate(script) as Promise<number>;

test.describe('live time', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'one engine is enough for timing');

  test('script time, CSS animation and timers stop and advance exactly', async ({ page }) => {
    await installLiveTime(page);
    await page.setContent(PAGE);
    const clock = await settle(page, 0.5);
    const raf0 = Number(await page.textContent('#raf'));
    const timer0 = Number(await page.textContent('#timer'));
    const left0 = await page.$eval('#box', (el) => parseFloat(getComputedStyle(el).marginLeft));

    // Real time passes; nothing on the page may move.
    await page.waitForTimeout(400);
    expect(Number(await page.textContent('#raf'))).toBe(raf0);
    expect(await page.$eval('#box', (el) => parseFloat(getComputedStyle(el).marginLeft))).toBe(
      left0,
    );

    await clock.advanceTo(1);
    // Frame callbacks run at the frame's own time, not on a 16 ms grid.
    expect(Number(await page.textContent('#raf')) - raf0).toBe(1000);
    expect(Number(await page.textContent('#timer')) - timer0).toBe(10);
    const left1 = await page.$eval('#box', (el) => parseFloat(getComputedStyle(el).marginLeft));
    // 1 s of a 400 px, 4 s linear slide is 100 px, modulo the loop.
    expect(((left1 - left0 + 400) % 400).toFixed(3)).toBe('100.000');
  });

  test('two takes opened with goto start at the same instant and draw the same picture', async ({
    browser,
  }) => {
    const shots: Buffer[] = [];
    const starts: number[][] = [];
    for (let run = 0; run < 2; run++) {
      const page = await browser.newPage();
      await installLiveTime(page);
      // The second take's page is answered 700 ms late, and real time passes between its steps;
      // page time must not notice either.
      if (run === 1) {
        await page.route('**/canvas', async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 700));
          await route.continue();
        });
      }
      await page.goto(`${origin}/canvas`);
      const clock = await settle(page, 0.3);
      if (run === 1) await page.waitForTimeout(500);
      await clock.advanceTo(1.5);
      starts.push([await num(page, 'window.__start'), await num(page, 'window.__date')]);
      shots.push(await page.locator('#c').screenshot());
      await page.close();
    }
    expect(starts[0]).toEqual([0, EPOCH]);
    expect(starts[1]).toEqual(starts[0]);
    expect(shots[0].equals(shots[1])).toBe(true);
  });

  test('page time does not run while the page loads', async ({ page }) => {
    await installLiveTime(page);
    await page.setContent(
      '<div id="t"></div><script>document.getElementById("t").textContent = String(Date.now());</script>',
    );
    await page.waitForTimeout(300);
    expect(Number(await page.evaluate('Date.now()'))).toBe(Number(await page.textContent('#t')));
  });

  test('animation frames step by exactly one frame interval, once per frame', async ({ page }) => {
    const fps = 30;
    await installLiveTime(page);
    await page.goto(`${origin}/stamps`);
    const clock = await settle(page, 0.5, { fps });
    const settled = (await page.evaluate('window.__stamps')) as number[];
    expect(settled).toEqual(
      Array.from({ length: 15 }, (_, k) => Math.round(((k + 1) * 1000) / fps)),
    );
    let seen = settled.length;
    for (let i = 0; i <= 45; i++) {
      await clock.advanceTo(i / fps);
      const stamps = (await page.evaluate('window.__stamps')) as number[];
      expect(stamps.length - seen).toBe(i === 0 ? 0 : 1);
      seen = stamps.length;
      expect(stamps[stamps.length - 1] - 500).toBe(Math.round((i * 1000) / fps));
    }
  });

  test('a timer or frame that throws is a warning, and the take carries on', async ({ page }) => {
    const warnings: string[] = [];
    await installLiveTime(page);
    await page.goto(`${origin}/throws`);
    const clock = await settle(page, 0.5, { onWarning: (m) => warnings.push(m) });
    await clock.advanceTo(0.5);
    expect(Number(await page.textContent('#n'))).toBe(10);
    expect(warnings.some((w) => w.includes('boom from a timer'))).toBe(true);
    expect(warnings.some((w) => w.includes('boom in a frame'))).toBe(true);
    // The same error again and again is said once.
    expect(warnings.filter((w) => w.includes('boom every 200 ms'))).toHaveLength(1);
  });

  test('an interval of 0, none or NaN does not hang the clock', async ({ page }) => {
    test.setTimeout(30000);
    await installLiveTime(page);
    await page.goto(`${origin}/zero`);
    const clock = await settle(page, 0.3);
    await clock.advanceTo(0.1);
    // Each of the four runs every 1 ms of page time: 400 ms of it.
    expect(await num(page, 'window.__c')).toBe(1600);
  });

  test('CSS and Web Animations follow the page: held, rate, pause, reveal and finish', async ({
    page,
  }) => {
    await installLiveTime(page);
    await page.goto(`${origin}/animations`);
    const clock = await settle(page, 0.5);
    await clock.advanceTo(1);
    const at = (id: string) =>
      num(page, `document.getElementById('${id}').getAnimations()[0].currentTime`);
    // Held by CSS from the start: never moves.
    expect(await at('held')).toBe(0);
    // Twice as fast, for 1.5 s, though the page calls play() on it every 50 ms.
    expect(await at('fast')).toBe(3000);
    // Paused by the page at 200 ms.
    expect(await at('stop')).toBe(200);
    // Released by the page at 300 ms.
    expect(await at('reveal')).toBe(1200);
    // Two animations on one element, the second held by its own entry in the play-state list.
    expect(
      await page.evaluate(
        "document.getElementById('pair').getAnimations().map((a) => [a.animationName, a.currentTime])",
      ),
    ).toEqual([
      ['slide', 1500],
      ['fade', 0],
    ]);
    // A finite animation is finished once its end is passed, so its handlers run.
    await expect.poll(() => page.evaluate('window.__finished === true')).toBe(true);
  });

  test('a page that navigates away by itself says so', async ({ page }) => {
    await installLiveTime(page);
    await page.goto(`${origin}/redirect`);
    await markDocument(page);
    let error: Error | undefined;
    try {
      await settle(page, 0.5);
    } catch (e) {
      error = e as Error;
    }
    // The settle may see its document go mid-step; if it does not, the check after it must.
    if (error) expect(error.message).toMatch(/navigated away by itself/);
    await page.waitForURL(`${origin}/canvas`);
    await expect(checkDocument(page)).rejects.toThrow(/navigated away by itself/);
  });

  test('a click-to-play video keeps its poster; an autoplay one is held to page time', async ({
    page,
  }) => {
    test.skip(!hasClip, 'FFmpeg with libvpx is needed to make the clip');
    await installLiveTime(page);
    await page.setViewportSize({ width: 400, height: 300 });
    await page.goto(`${origin}/video`);
    await page.waitForFunction(
      "document.getElementById('click').readyState >= 1 && document.getElementById('auto').readyState >= 2",
      undefined,
      { polling: 100 },
    );
    const clock = await settle(page, 0.3);
    await clock.advanceTo(1);
    expect(await num(page, "document.getElementById('click').currentTime")).toBe(0);
    expect(await page.evaluate("document.getElementById('click').paused")).toBe(true);
    // 1.3 s into a looping 2 s clip, paused there.
    expect(await num(page, "document.getElementById('auto').currentTime")).toBeCloseTo(1.3, 3);
    expect(await page.evaluate("document.getElementById('auto').paused")).toBe(true);

    const shot = await page.locator('#click').screenshot();
    const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
    const i =
      (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    // The poster is red; the clip is green.
    expect(data[i]).toBeGreaterThan(200);
    expect(data[i + 1]).toBeLessThan(60);
  });

  test('the pointer layer is built without markup, so a Trusted Types page gets it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`${origin}/trusted`);
    // The page refuses markup from script.
    expect(
      await page.evaluate(
        "(() => { try { document.body.insertAdjacentHTML('beforeend', '<b>x</b>'); return 'allowed'; } catch (e) { return 'refused'; } })()",
      ),
    ).toBe('refused');
    const track = planLivePointer(
      { duration: 4, segments: [{ start: 0, end: 4, from: 0, to: 0 }] },
      [{ kind: 'h1', text: 'Headline', x: 100, y: 200, w: 400, h: 40 }],
      { viewport: { w: 1280, h: 720 }, persona: PERSONAS.guide },
    );
    await mountLivePointer(page, track);
    await drawLivePointer(page, 2);
    const drawn = () =>
      page.evaluate(`(() => {
        const hand = document.querySelector('#cp-live-pointer .cp-hand');
        const worn = [...hand.children].find((c) => c.style.display === 'block');
        return { opacity: hand.style.opacity, transform: hand.style.transform,
          outfit: worn && worn.getAttribute('data-outfit'), paths: worn ? worn.querySelectorAll('path').length : 0,
          svg: worn && worn.firstChild.namespaceURI };
      })()`);
    const pose = pointerAt(track, 2);
    const first = (await drawn()) as Record<string, unknown>;
    expect(first).toMatchObject({ outfit: pose.outfit, svg: 'http://www.w3.org/2000/svg' });
    expect(Number(first.opacity)).toBe(1);
    expect(first.paths as number).toBeGreaterThan(0);
    const moved = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(String(first.transform));
    expect(moved).not.toBeNull();
    expect(Number(moved![1])).toBeCloseTo(pose.x, 2);
    expect(Number(moved![2])).toBeCloseTo(pose.y, 2);
    // The page removes the layer; the next frame puts it back.
    await page.evaluate("document.getElementById('cp-live-pointer').remove()");
    await drawLivePointer(page, 2);
    expect(await drawn()).toEqual(first);
  });
});
