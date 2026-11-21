/**
 * Stepped recorder
 *
 * Draws a take one frame at a time: set the scroll offset for frame `i`, take a picture, move on.
 * Nothing depends on real time, so a slow or paused machine yields the same take as a fast one.
 *
 * The page's own motion is frame-exact too: once it has loaded, its clock is stopped and advanced
 * one frame interval per picture (see `livetime.ts`), so a three.js landing films the same way on
 * any machine. With a persona, the pointer plays its part over the live page (see `pointer/live.ts`).
 *
 * Limits, stated plainly: one picture per frame (no motion blur), and the pointer's press is drawn,
 * never clicked.
 */
import { spawn } from 'child_process';
import { mkdir, rm } from 'fs/promises';
import path from 'path';

import { chromium, firefox, Page, webkit } from 'playwright';

import { readLandmarks } from '../cinema/capture';
import { BrowserType } from '../drivers/playwright';
import { drawLivePointer, mountLivePointer, planLivePointer } from '../pointer/live';
import { PointerTrack } from '../pointer/motion';
import { Persona } from '../pointer/persona';
import { Journey } from '../types';

import { checkDocument, explainGone, installLiveTime, markDocument, settle } from './livetime';
import { buildScrollTimeline, frameCount, scrollAt } from './timeline';

/** Page time a page runs after loading and before the first frame. */
const SETTLE_SECONDS = 2;
/** Real time the network gets after settling, for what the page's timers asked for. */
const AFTER_SETTLE_LIMIT_MS = 5000;
/** The network counts as quiet after this long with nothing in flight. */
const QUIET_MS = 500;

/**
 * Count the page's requests from now on. `quiet()` resolves once none has been in flight for
 * `QUIET_MS`, or after `limit` ms whatever happens. (Playwright's `networkidle` cannot be waited
 * for twice: a document that reached it once reports it at once.)
 */
function watchNetwork(page: Page) {
  const inFlight = new Set<unknown>();
  let changed = Date.now();
  const start = (r: unknown) => {
    inFlight.add(r);
    changed = Date.now();
  };
  const end = (r: unknown) => {
    inFlight.delete(r);
    changed = Date.now();
  };
  page.on('request', start);
  page.on('requestfinished', end);
  page.on('requestfailed', end);
  return {
    async quiet(limit: number) {
      const until = Date.now() + limit;
      while (Date.now() < until) {
        if (inFlight.size === 0 && Date.now() - changed >= QUIET_MS) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      page.off('request', start);
      page.off('requestfinished', end);
      page.off('requestfailed', end);
    },
  };
}

export interface SteppedOptions {
  journey: Journey;
  outputPath: string;
  workDir: string;
  browserType?: BrowserType;
  fps?: number;
  /** Seconds of fade at each end. */
  fade?: number;
  /** Whose hand the pointer is. Omit for a take with no pointer. */
  persona?: Persona;
  onFrame?: (frame: number, total: number) => void;
}

export interface SteppedResult {
  outputPath: string;
  frames: number;
  fps: number;
  duration: number;
  pageHeight: number;
  /** Presses the pointer made; absent when the take has no pointer. */
  presses?: number;
}

function encode(framesDir: string, fps: number, duration: number, fade: number, out: string) {
  return new Promise<void>((resolve, reject) => {
    const filters = ['format=yuv420p'];
    if (fade > 0 && duration > fade * 2) {
      filters.unshift(
        `fade=t=in:st=0:d=${fade}`,
        `fade=t=out:st=${(duration - fade).toFixed(3)}:d=${fade}`,
      );
    }
    const args = [
      '-v',
      'error',
      '-y',
      '-framerate',
      String(fps),
      '-i',
      path.join(framesDir, '%06d.jpg'),
      '-vf',
      filters.join(','),
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-movflags',
      '+faststart',
      out,
    ];
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`)),
    );
  });
}

/** Record a read-only journey frame by frame and encode it to `outputPath`. */
export async function recordStepped(options: SteppedOptions): Promise<SteppedResult> {
  const { journey, outputPath, workDir } = options;
  const fps = options.fps ?? 30;
  const fade = options.fade ?? 0.5;
  const framesDir = path.join(workDir, 'frames');
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  await mkdir(path.dirname(outputPath), { recursive: true });

  const launcher = { chromium, firefox, webkit }[options.browserType ?? 'chromium'];
  const browser = await launcher.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: journey.meta.viewport.w, height: journey.meta.viewport.h },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await installLiveTime(page);
    await page.goto(journey.start.url, { waitUntil: 'load', timeout: 60000 });
    // Late content (fonts, lazy images) changes the page height; give the network a bounded chance.
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    // A mark on this document: if the page replaces itself while it settles, the mark is gone.
    await markDocument(page);
    const network = watchNetwork(page);
    // Then the same amount of page time on every take, so the page's own motion starts alike.
    const clock = await settle(page, SETTLE_SECONDS, { fps });
    // Timers only run while settling, so what they fetched may still be arriving; the page is
    // measured after it has had a bounded chance to land.
    await network.quiet(AFTER_SETTLE_LIMIT_MS);

    const { viewport } = journey.meta;
    let pageHeight: number;
    let track: PointerTrack | undefined;
    let timeline: ReturnType<typeof buildScrollTimeline>;
    try {
      await checkDocument(page);
      pageHeight = (await page.evaluate(
        'Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)',
      )) as number;
      timeline = buildScrollTimeline(journey, pageHeight - viewport.h);
      if (timeline.duration <= 0) {
        throw new Error('The journey has no duration: nothing to record');
      }
      if (options.persona) {
        // Wholly on the page and in reading order: an off-canvas or screen-reader-only control
        // is not something the pointer can be seen to attend to.
        const landmarks = await readLandmarks(page, viewport.w, pageHeight);
        track = planLivePointer(timeline, landmarks, { viewport, persona: options.persona });
        await mountLivePointer(page, track);
      }
    } catch (error) {
      throw explainGone(error);
    }

    const total = frameCount(timeline.duration, fps);
    for (let frame = 0; frame < total; frame++) {
      const t = frame / fps;
      const y = scrollAt(timeline, t);
      try {
        await page.evaluate(`window.scrollTo({ top: ${y}, left: 0, behavior: 'instant' })`);
        await clock.advanceTo(t);
        if (track) await drawLivePointer(page, t);
      } catch (error) {
        throw explainGone(error);
      }
      await page.screenshot({
        path: path.join(framesDir, `${String(frame).padStart(6, '0')}.jpg`),
        type: 'jpeg',
        quality: 92,
      });
      options.onFrame?.(frame + 1, total);
    }

    await encode(framesDir, fps, timeline.duration, fade, outputPath);
    return {
      outputPath,
      frames: total,
      fps,
      duration: timeline.duration,
      pageHeight,
      ...(track ? { presses: track.presses.length } : {}),
    };
  } finally {
    await browser.close();
    await rm(framesDir, { recursive: true, force: true });
  }
}
