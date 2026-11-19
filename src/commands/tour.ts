import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises';
import path from 'path';

import chalk from 'chalk';

import { loadCatalog } from '../catalog';
import { PageTilesManifest, PAGE_TILES_SCHEMA } from '../cinema/tiles';
import { recordStage, takeQuality } from '../recorders/stage';
import { buildTour, Layer, TourInput } from '../tour/layout';
import { buildTourStageHtml } from '../tour/stage';

export const TOUR_SCHEMA = 'cinematic-pointer/tour@1';

interface TourCommandOptions {
  catalog: string;
  captures: string;
  out: string;
  viewport: string;
  only?: string;
  draft?: boolean;
  software?: boolean;
  seconds?: string;
}

/**
 * Chromium flags for a tour. The stage is a local file that loads local pictures as textures,
 * which a browser refuses without the first. The rest draw WebGL on the CPU, which is how a
 * machine without a GPU draws it.
 */
export const LOCAL_STAGE_ARGS = ['--allow-file-access-from-files'];
export const SOFTWARE_GL_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--disable-gpu-compositing',
];

/** Read each product's capture from `<captures>/<slug>/manifest.json`. */
export async function loadTourInputs(
  products: { slug: string; name: string; layer?: Layer }[],
  capturesDir: string,
  stageDir: string,
): Promise<{ inputs: TourInput[]; missing: string[] }> {
  const inputs: TourInput[] = [];
  const missing: string[] = [];
  for (const product of products) {
    const dir = path.join(capturesDir, product.slug);
    let manifest: PageTilesManifest;
    try {
      manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    } catch {
      missing.push(product.slug);
      continue;
    }
    if (manifest.schema !== PAGE_TILES_SCHEMA) {
      throw new Error(`${product.slug}: not a page capture (${String(manifest.schema)})`);
    }
    for (const tile of manifest.tiles) {
      if (!/^tile-r\d+-c\d+\.png$/.test(tile.file)) {
        throw new Error(`${product.slug}: the capture names a file that is not a tile`);
      }
      await stat(path.join(dir, tile.file));
    }
    inputs.push({
      slug: product.slug,
      name: product.name,
      layer: product.layer,
      width: manifest.width,
      height: manifest.height,
      background: manifest.background,
      tiles: manifest.tiles.map((tile) => ({
        file: path.relative(stageDir, path.join(dir, tile.file)).split(path.sep).join('/'),
        x: tile.x,
        y: tile.y,
        w: tile.w,
        h: tile.h,
      })),
    });
  }
  return { inputs, missing };
}

/** Film the estate tour from captures already on disk. Exit 2 when it could not be filmed. */
export async function tourCommand(options: TourCommandOptions): Promise<void> {
  try {
    const size = options.viewport.match(/^(\d{3,4})x(\d{3,4})$/);
    if (!size) throw new Error('--viewport must look like 1280x720');
    const frame = { w: Number(size[1]), h: Number(size[2]) };
    const limit = options.seconds === undefined ? undefined : Number(options.seconds);
    if (limit !== undefined && !(limit > 0)) throw new Error('--seconds must be a positive number');

    const catalog = await loadCatalog(options.catalog);
    const wanted = options.only
      ?.split(',')
      .map((slug) => slug.trim())
      .filter(Boolean);
    const products = catalog.products.filter((p) => !wanted || wanted.includes(p.slug));
    const unknown = (wanted ?? []).filter((slug) => !catalog.products.some((p) => p.slug === slug));
    if (unknown.length > 0) throw new Error(`Not in the catalog: ${unknown.join(', ')}`);

    const outDir = path.resolve(options.out);
    await mkdir(outDir, { recursive: true });
    if (!(await readdir(path.resolve(options.captures)).catch(() => null))) {
      throw new Error(`No captures directory at ${options.captures}`);
    }
    const { inputs, missing } = await loadTourInputs(
      products,
      path.resolve(options.captures),
      outDir,
    );
    if (inputs.length === 0) {
      throw new Error('No product has a capture. Run `capture page` into <captures>/<slug> first.');
    }

    const tour = buildTour(inputs, { frameAspect: frame.w / frame.h });
    const stagePath = path.join(outDir, 'tour.html');
    await writeFile(stagePath, await buildTourStageHtml(tour));

    const quality = takeQuality(options.draft === true);
    const output = path.join(outDir, 'tour.mp4');
    const started = Date.now();
    const take = await recordStage({
      stagePath,
      outputPath: output,
      workDir: outDir,
      frame,
      shutter: quality.shutter,
      grade: false,
      launchArgs: [...LOCAL_STAGE_ARGS, ...(options.software ? SOFTWARE_GL_ARGS : [])],
      maxSeconds: limit,
    });
    const wallSeconds = (Date.now() - started) / 1000;

    const result = {
      schema: TOUR_SCHEMA,
      filmedAt: new Date().toISOString(),
      frame,
      quality: quality.note,
      // What actually drew the frames, as the browser reports it. `--software` asks for the CPU
      // rasteriser; this says whether that is what ran.
      renderer: String(take.info?.renderer ?? 'unknown'),
      softwareRequested: options.software === true,
      products: tour.panels.map((p) => ({ slug: p.slug, layer: p.layer, cropped: p.cropped })),
      missing,
      tourSeconds: Math.round(tour.duration * 100) / 100,
      filmedSeconds: Math.round(take.duration * 100) / 100,
      partial: take.duration < tour.duration - 1e-6,
      shots: tour.shots,
      timing: {
        frames: take.frames,
        picturesDrawn: take.subFrames,
        drawSeconds: Math.round(take.drawSeconds * 10) / 10,
        msPerPicture: Math.round((take.drawSeconds * 1000) / take.subFrames),
        wallSeconds: Math.round(wallSeconds * 10) / 10,
      },
      file: path.basename(output),
      bytes: (await stat(output)).size,
    };
    await writeFile(path.join(outDir, 'tour.json'), JSON.stringify(result, null, 2) + '\n');

    console.log(
      `tour=FILMED products=${result.products.length} missing=${missing.length} ` +
        `seconds=${result.filmedSeconds}/${result.tourSeconds} frames=${take.frames} ` +
        `ms_per_picture=${result.timing.msPerPicture} renderer="${result.renderer}"`,
    );
    if (missing.length > 0) {
      console.warn(chalk.yellow(`No capture for: ${missing.join(', ')}`));
    }
    process.exit(0);
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(2);
  }
}
