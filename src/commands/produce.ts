import { mkdir, stat, writeFile } from 'fs/promises';
import path from 'path';

import chalk from 'chalk';

import { buildTrailers, loadCatalog, selectTrailers, serializeJourney, Trailer } from '../catalog';
import {
  exitCodeFor,
  parseAspects,
  parseViewport,
  ProduceResults,
  RenderProof,
  RESULTS_SCHEMA,
  TrailerResult,
} from '../catalog/results';
import { capturePage } from '../cinema/capture';
import { direct } from '../cinema/screenplay';
import { addScore, hasAudio } from '../cinema/sound';
import { buildStageHtml } from '../cinema/stage';
import { BrowserType } from '../drivers/playwright';
import { executeJourneyFile } from '../executor';
import { loadPersona } from '../pointer/persona';
import {
  checkFFmpegAvailable,
  hasFFmpegFilter,
  probe,
  reframeVideo,
  runPipeline,
} from '../postprod';
import { grabFrame } from '../postprod/proof';
import { recordStage, takeQuality } from '../recorders/stage';
import { recordStepped } from '../recorders/stepped';

/** A rendered file shorter than this did not film a tour. */
const MIN_SECONDS = 5;

export interface ProduceOptions {
  catalog: string;
  out: string;
  filter?: string;
  aspects: string;
  browser: string;
  headed?: boolean;
  dryRun?: boolean;
  /** `stepped` draws frame by frame (default); `realtime` records the live page with the overlay. */
  recorder?: string;
  /** `--no-score` leaves a cinematic take silent. */
  score?: boolean;
  /** `--draft` renders a cinematic take without motion blur, for a constrained machine. */
  draft?: boolean;
  /** Whose hand the pointer is in a cinematic take: a built-in name or a `.json` file. */
  persona?: string;
  /** `--no-pointer` films a cinematic take with no pointer in it. */
  pointer?: boolean;
  /** `WxH`. Overrides every journey's viewport, e.g. to record smaller on a constrained machine. */
  viewport?: string;
}

/** The page must answer 2xx before it is filmed: an error page is not a trailer. */
export async function preflight(url: string): Promise<{ ok: boolean; status: number }> {
  try {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** Measure a rendered file. Throws when it is absent, empty or too short to be a tour. */
export { grabFrame };

export async function proveRender(filePath: string, aspect: string): Promise<RenderProof> {
  const { size } = await stat(filePath);
  if (size === 0) throw new Error(`${filePath} is empty`);
  const info = await probe(filePath);
  if (!(info.duration >= MIN_SECONDS)) {
    throw new Error(`${filePath} lasts ${info.duration}s, under the ${MIN_SECONDS}s floor`);
  }
  // A file can have the right length and still show one held frame. Two moments of a tour differ.
  const early = await grabFrame(filePath, info.duration * 0.25);
  const late = await grabFrame(filePath, info.duration * 0.75);
  if (early.length === 0 || late.length === 0) {
    throw new Error(`${filePath} has no readable picture`);
  }
  if (early.equals(late)) {
    throw new Error(`${filePath} shows the same picture at 25% and 75%: the edit held one frame`);
  }
  return {
    aspect,
    path: filePath,
    bytes: size,
    seconds: Math.round(info.duration * 10) / 10,
    width: info.width,
    height: info.height,
  };
}

async function produceOne(
  trailer: Trailer,
  aspects: string[],
  options: ProduceOptions,
): Promise<TrailerResult> {
  const result: TrailerResult = {
    id: trailer.id,
    product: trailer.product,
    kind: trailer.kind,
    skus: trailer.skus,
    url: trailer.journey.start.url,
    status: 'failed',
    renders: [],
  };

  const page = await preflight(trailer.journey.start.url);
  result.httpStatus = page.status;
  if (!page.ok) {
    result.reason = `start page answered ${page.status || 'no response'}`;
    return result;
  }

  const dir = path.join(options.out, trailer.id);
  const runDir = path.join(dir, 'run');
  await mkdir(runDir, { recursive: true });
  const journeyPath = path.join(runDir, 'journey.json');
  const journey = options.viewport
    ? {
        ...trailer.journey,
        meta: { ...trailer.journey.meta, viewport: parseViewport(options.viewport) },
      }
    : trailer.journey;
  await writeFile(journeyPath, serializeJourney(journey));

  const master = path.join(dir, `${trailer.id}_16x9.mp4`);
  // The event log exists only for a real-time take; it steers the smart crop when reframing.
  let eventsPath: string | undefined;

  if (options.recorder === 'cinematic') {
    const frame = journey.meta.viewport;
    const capture = await capturePage({
      url: journey.start.url,
      outDir: runDir,
      browserType: options.browser as BrowserType,
    });
    const persona =
      options.pointer === false ? undefined : await loadPersona(options.persona ?? 'guide');
    const screenplay = direct(capture, {
      frame,
      name: trailer.name,
      tagline: new URL(journey.start.url).host,
      persona,
    });
    result.pointer = persona
      ? `${persona.id}: ${screenplay.pointer?.presses.length ?? 0} press(es)`
      : 'none';
    const stagePath = path.join(runDir, 'stage.html');
    await writeFile(stagePath, buildStageHtml(capture, screenplay, { letterbox: 2.39 }));
    await writeFile(
      path.join(runDir, 'screenplay.json'),
      JSON.stringify(screenplay, null, 2) + '\n',
    );
    const quality = takeQuality(options.draft === true);
    const take = await recordStage({
      stagePath,
      outputPath: master,
      workDir: runDir,
      frame,
      shutter: quality.shutter,
    });
    result.quality = quality.note;
    result.recorder = 'cinematic';
    result.frames = take.frames;
    result.shots = screenplay.shots.length;
    result.landmarks = capture.landmarks.length;
    result.captions = 'none: title cards only';
    if (options.score === false) {
      result.sound = 'none: the score was turned off';
    } else {
      const cues = await addScore(screenplay, master, runDir);
      if (!(await hasAudio(master))) throw new Error(`${master} has no audio after scoring`);
      result.sound = `synthesized score, ${cues} cues`;
    }
    result.renders.push(await proveRender(master, '16:9'));
  } else if (options.recorder === 'stepped') {
    const persona =
      options.pointer === false ? undefined : await loadPersona(options.persona ?? 'guide');
    const take = await recordStepped({
      journey,
      outputPath: master,
      workDir: runDir,
      browserType: options.browser as BrowserType,
      persona,
    });
    result.recorder = 'stepped';
    result.frames = take.frames;
    result.pointer = persona ? `${persona.id}: ${take.presses ?? 0} press(es)` : 'none';
    result.captions = 'none: a stepped take carries no captions yet';
    result.renders.push(await proveRender(master, '16:9'));
  } else {
    result.recorder = 'realtime';
    const run = await executeJourneyFile(journeyPath, {
      browserType: options.browser as BrowserType,
      headless: !options.headed,
      outputDir: runDir,
      enableRecording: true,
      enableOverlay: true,
    });
    result.stepsExecuted = run.stepsExecuted;
    result.stepsFailed = run.stepsFailed;
    if (!run.success) {
      result.reason = `${run.stepsFailed} step(s) failed: ${run.errors.map((e) => e.error).join('; ')}`;
      return result;
    }
    if (!run.artifacts.videoPath) {
      result.reason = 'the run produced no recording';
      return result;
    }

    const wantsCaptions = trailer.journey.output.captions === true;
    const burnCaptions = wantsCaptions && (await hasFFmpegFilter('subtitles'));
    await runPipeline({
      videoPath: run.artifacts.videoPath,
      eventsPath: run.artifacts.eventsPath,
      outputPath: master,
      template: trailer.journey.output.preset,
      captions: burnCaptions ? 'auto' : 'none',
    });
    result.captions = burnCaptions
      ? 'burned'
      : wantsCaptions
        ? 'skipped: this FFmpeg build has no subtitles filter (libass)'
        : 'none';
    result.renders.push(await proveRender(master, '16:9'));
    eventsPath = run.artifacts.eventsPath;
  }

  for (const aspect of aspects.filter((a) => a !== '16:9')) {
    const outputPath = path.join(dir, `${trailer.id}_${aspect.replace(':', 'x')}.mp4`);
    await reframeVideo({
      inputPath: master,
      outputPath,
      targetAspect: aspect,
      eventsPath,
      smartCrop: eventsPath !== undefined,
    });
    result.renders.push(await proveRender(outputPath, aspect));
  }

  result.status = 'rendered';
  return result;
}

/**
 * Produce every trailer the catalog calls for (or the filtered subset), one at a time.
 * Returns the results; the caller decides the exit code.
 */
export async function produce(options: ProduceOptions): Promise<ProduceResults> {
  const catalog = await loadCatalog(options.catalog);
  const aspects = parseAspects(options.aspects);
  const recorder = options.recorder ?? 'stepped';
  if (recorder !== 'stepped' && recorder !== 'realtime' && recorder !== 'cinematic') {
    throw new Error(`Unknown recorder "${recorder}". Use cinematic, stepped or realtime.`);
  }
  options = { ...options, recorder };
  // A bad persona should stop the run before anything is filmed.
  if ((recorder === 'cinematic' || recorder === 'stepped') && options.pointer !== false) {
    await loadPersona(options.persona ?? 'guide');
  }
  const trailers = selectTrailers(buildTrailers(catalog), options.filter);

  const results: ProduceResults = {
    schema: RESULTS_SCHEMA,
    catalog_source_last_updated: catalog.source_last_updated,
    selected: trailers.length,
    rendered: 0,
    failed: 0,
    trailers: [],
  };

  if (options.dryRun) {
    for (const t of trailers) {
      console.log(`${t.id}  ${t.journey.start.url}  skus=${t.skus.length}`);
    }
    return results;
  }

  if (trailers.length > 0 && !(await checkFFmpegAvailable())) {
    throw new Error('FFmpeg is not available. Install FFmpeg 6.0 or higher.');
  }

  await mkdir(options.out, { recursive: true });

  for (const trailer of trailers) {
    console.log(chalk.blue(`▶ ${trailer.id}`) + chalk.gray(`  ${trailer.journey.start.url}`));
    let result: TrailerResult;
    try {
      result = await produceOne(trailer, aspects, options);
    } catch (error) {
      result = {
        id: trailer.id,
        product: trailer.product,
        kind: trailer.kind,
        skus: trailer.skus,
        url: trailer.journey.start.url,
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
        renders: [],
      };
    }
    results.trailers.push(result);
    if (result.status === 'rendered') {
      results.rendered++;
      const proof = result.renders.map((r) => `${r.aspect} ${r.seconds}s ${r.bytes}B`).join(', ');
      console.log(chalk.green(`  ✓ rendered`) + chalk.gray(`  ${proof}`));
      if (result.captions?.startsWith('skipped')) {
        console.log(chalk.yellow(`  ! captions ${result.captions}`));
      }
    } else {
      results.failed++;
      console.log(chalk.red(`  ✗ failed`) + chalk.gray(`  ${result.reason}`));
    }
    // Written after every trailer, so an interrupted batch still leaves a true record.
    await writeFile(
      path.join(options.out, 'results.json'),
      JSON.stringify(results, null, 2) + '\n',
    );
  }

  return results;
}

export async function produceCommand(options: ProduceOptions): Promise<void> {
  try {
    const results = await produce(options);
    const code = options.dryRun ? (results.selected === 0 ? 2 : 0) : exitCodeFor(results);
    console.log(
      `produce: selected=${results.selected} rendered=${results.rendered} failed=${results.failed}` +
        (options.dryRun ? ' (dry run)' : ''),
    );
    process.exit(code);
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
