/**
 * Stepped recorder
 *
 * Draws a take one frame at a time: set the scroll offset for frame `i`, take a picture, move on.
 * Nothing depends on real time, so a slow or paused machine yields the same take as a fast one.
 *
 * Limits, stated plainly: the page's own animations and videos still run on the wall clock, so they
 * are not frame-accurate here (that needs virtualised browser time), and there is no cursor overlay.
 */
import { spawn } from 'child_process';
import { mkdir, rm } from 'fs/promises';
import path from 'path';

import { chromium, firefox, webkit } from 'playwright';

import { BrowserType } from '../drivers/playwright';
import { Journey } from '../types';

import { buildScrollTimeline, frameCount, scrollAt } from './timeline';

export interface SteppedOptions {
  journey: Journey;
  outputPath: string;
  workDir: string;
  browserType?: BrowserType;
  fps?: number;
  /** Seconds of fade at each end. */
  fade?: number;
  onFrame?: (frame: number, total: number) => void;
}

export interface SteppedResult {
  outputPath: string;
  frames: number;
  fps: number;
  duration: number;
  pageHeight: number;
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
    await page.goto(journey.start.url, { waitUntil: 'load', timeout: 60000 });
    // Late content (fonts, lazy images) changes the page height; give the network a bounded chance.
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);

    const pageHeight = (await page.evaluate(
      'Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)',
    )) as number;
    const timeline = buildScrollTimeline(journey, pageHeight - journey.meta.viewport.h);
    if (timeline.duration <= 0) {
      throw new Error('The journey has no duration: nothing to record');
    }

    const total = frameCount(timeline.duration, fps);
    for (let frame = 0; frame < total; frame++) {
      const y = scrollAt(timeline, frame / fps);
      await page.evaluate(`window.scrollTo({ top: ${y}, left: 0, behavior: 'instant' })`);
      await page.screenshot({
        path: path.join(framesDir, `${String(frame).padStart(6, '0')}.jpg`),
        type: 'jpeg',
        quality: 92,
      });
      options.onFrame?.(frame + 1, total);
    }

    await encode(framesDir, fps, timeline.duration, fade, outputPath);
    return { outputPath, frames: total, fps, duration: timeline.duration, pageHeight };
  } finally {
    await browser.close();
    await rm(framesDir, { recursive: true, force: true });
  }
}
