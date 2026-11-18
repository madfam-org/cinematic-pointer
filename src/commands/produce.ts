import { mkdir, stat, writeFile } from 'fs/promises';
import path from 'path';

import chalk from 'chalk';

import { buildTrailers, loadCatalog, selectTrailers, serializeJourney, Trailer } from '../catalog';
import {
  exitCodeFor,
  parseAspects,
  ProduceResults,
  RenderProof,
  RESULTS_SCHEMA,
  TrailerResult,
} from '../catalog/results';
import { BrowserType } from '../drivers/playwright';
import { executeJourneyFile } from '../executor';
import { checkFFmpegAvailable, probe, reframeVideo, runPipeline } from '../postprod';

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
export async function proveRender(filePath: string, aspect: string): Promise<RenderProof> {
  const { size } = await stat(filePath);
  if (size === 0) throw new Error(`${filePath} is empty`);
  const info = await probe(filePath);
  if (!(info.duration >= MIN_SECONDS)) {
    throw new Error(`${filePath} lasts ${info.duration}s, under the ${MIN_SECONDS}s floor`);
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
  await writeFile(journeyPath, serializeJourney(trailer.journey));

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

  const master = path.join(dir, `${trailer.id}_16x9.mp4`);
  await runPipeline({
    videoPath: run.artifacts.videoPath,
    eventsPath: run.artifacts.eventsPath,
    outputPath: master,
    template: trailer.journey.output.preset,
    captions: trailer.journey.output.captions ? 'auto' : 'none',
  });
  result.renders.push(await proveRender(master, '16:9'));

  for (const aspect of aspects.filter((a) => a !== '16:9')) {
    const outputPath = path.join(dir, `${trailer.id}_${aspect.replace(':', 'x')}.mp4`);
    await reframeVideo({
      inputPath: master,
      outputPath,
      targetAspect: aspect,
      eventsPath: run.artifacts.eventsPath,
      smartCrop: true,
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
