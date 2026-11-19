/**
 * Stage recorder
 *
 * Records anything that implements the stage contract (`window.__stage.ready`, `.duration`,
 * `.seek(t)`): seek, take a picture, next frame. Motion blur comes from drawing several sub-frames
 * per output frame and averaging them, which is what a film shutter does.
 */
import { spawn } from 'child_process';
import { mkdir, rm } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

import { chromium } from 'playwright';

export interface StageRecordOptions {
  /** A stage document on disk. */
  stagePath: string;
  outputPath: string;
  workDir: string;
  frame: { w: number; h: number };
  fps?: number;
  /** Sub-frames averaged into each output frame. 1 turns motion blur off. */
  shutter?: number;
  /** Colour grade applied at encode time. */
  grade?: boolean;
  onFrame?: (frame: number, total: number) => void;
  /** Extra Chromium flags, e.g. to draw WebGL in software or let a local stage load local files. */
  launchArgs?: string[];
  /** Stop after this many seconds of stage time: a timed sample of a longer stage. */
  maxSeconds?: number;
}

export interface StageRecordResult {
  outputPath: string;
  frames: number;
  subFrames: number;
  fps: number;
  duration: number;
  /** What the stage says about itself (`window.__stage.info`), when it says anything. */
  info?: Record<string, unknown>;
  /** Wall-clock seconds spent seeking and picturing, without the encode. */
  drawSeconds: number;
}

/** Sub-frames per frame at full quality, and in a draft (no motion blur, a fifth of the work). */
export const FULL_SHUTTER = 5;
export const DRAFT_SHUTTER = 1;

/** What a take's quality setting means: how many sub-frames, and the note results carry. */
export function takeQuality(draft: boolean): { shutter: number; note: string } {
  return draft
    ? { shutter: DRAFT_SHUTTER, note: 'draft: no motion blur, not a finished take' }
    : { shutter: FULL_SHUTTER, note: `full: 180 degree shutter, ${FULL_SHUTTER} sub-frames` };
}

/** The share of each frame interval the shutter is open: 0.5 is the 180 degree shutter of film. */
export const SHUTTER_OPEN = 0.5;

/**
 * The stage time of sub-frame `i`. Sub-frames are packed into the open part of their frame's
 * interval, so a fast move smears into a blur instead of leaving separate ghosts a frame apart.
 */
export function subFrameTime(i: number, fps: number, shutter: number): number {
  const frame = Math.floor(i / shutter);
  const k = i % shutter;
  return (frame + (SHUTTER_OPEN * k) / shutter) / fps;
}

/** The FFmpeg filter chain for a take: shutter blend, cadence, grade. Exported for tests. */
export function stageFilters(fps: number, shutter: number, grade: boolean): string {
  const filters: string[] = [];
  if (shutter > 1) {
    filters.push(`tmix=frames=${shutter}:weights='${Array(shutter).fill('1').join(' ')}'`);
    filters.push(`fps=${fps}`);
  }
  if (grade) {
    // A restrained film grade: a touch more contrast, cool shadows, warm highlights.
    filters.push('eq=contrast=1.06:saturation=1.04');
    filters.push('colorbalance=rs=-0.03:bs=0.04:rh=0.03:bh=-0.03');
  }
  filters.push('format=yuv420p');
  return filters.join(',');
}

function encode(framesDir: string, inputFps: number, filters: string, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-framerate',
      String(inputFps),
      '-i',
      path.join(framesDir, '%06d.jpg'),
      '-vf',
      filters,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '17',
      '-movflags',
      '+faststart',
      out,
    ]);
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

export async function recordStage(options: StageRecordOptions): Promise<StageRecordResult> {
  const fps = options.fps ?? 24;
  const shutter = Math.max(1, Math.round(options.shutter ?? FULL_SHUTTER));
  const framesDir = path.join(options.workDir, 'stage-frames');
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  await mkdir(path.dirname(options.outputPath), { recursive: true });

  const browser = await chromium.launch({ headless: true, args: options.launchArgs ?? [] });
  try {
    const context = await browser.newContext({
      viewport: { width: options.frame.w, height: options.frame.h },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.goto(pathToFileURL(path.resolve(options.stagePath)).href, { waitUntil: 'load' });
    await page.evaluate('window.__stage.ready');
    const full = (await page.evaluate('window.__stage.duration')) as number;
    if (!(full > 0)) throw new Error('The stage reports no duration');
    const duration = options.maxSeconds ? Math.min(full, options.maxSeconds) : full;
    const info = (await page.evaluate('window.__stage.info ?? null')) as Record<
      string,
      unknown
    > | null;
    const drawStarted = Date.now();

    const captureFps = fps * shutter;
    const subFrames = Math.max(shutter, Math.round(duration * fps) * shutter);
    for (let i = 0; i < subFrames; i++) {
      await page.evaluate(`window.__stage.seek(${subFrameTime(i, fps, shutter).toFixed(6)})`);
      await page.screenshot({
        path: path.join(framesDir, `${String(i).padStart(6, '0')}.jpg`),
        type: 'jpeg',
        quality: 93,
      });
      options.onFrame?.(i + 1, subFrames);
    }

    const drawSeconds = (Date.now() - drawStarted) / 1000;

    await encode(
      framesDir,
      captureFps,
      stageFilters(fps, shutter, options.grade ?? true),
      options.outputPath,
    );
    return {
      outputPath: options.outputPath,
      frames: Math.round(subFrames / shutter),
      subFrames,
      fps,
      duration,
      ...(info ? { info } : {}),
      drawSeconds,
    };
  } finally {
    await browser.close();
    await rm(framesDir, { recursive: true, force: true });
  }
}
