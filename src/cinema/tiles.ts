/**
 * Page tiles
 *
 * The full length of a page as image tiles plus a manifest (RFC 0061, `capture.page`). A long page
 * as one picture is too large for a browser, a GPU texture or a print layer, so it is cut into a
 * grid and the manifest says how the pieces fit. Read-only, like every capture.
 */
import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises';
import path from 'path';

import sharp from 'sharp';

import { BrowserType } from '../drivers/playwright';

import { measurePage, readLandmarks, withSettledPage } from './capture';
import { Landmark } from './types';

export const PAGE_TILES_SCHEMA = 'cinematic-pointer/page-tiles@1';

export interface Tile {
  col: number;
  row: number;
  /** Page pixels, from the top-left of the page. */
  x: number;
  y: number;
  w: number;
  h: number;
  file: string;
}

export interface PageTilesManifest {
  schema: typeof PAGE_TILES_SCHEMA;
  url: string;
  /** Where the browser ended up after redirects, and the document's HTTP status. */
  finalUrl: string;
  status: number;
  title: string;
  capturedAt: string;
  /** Size of the captured area in page pixels. */
  width: number;
  height: number;
  /** The page's own height. Larger than `height` when the capture was cut off. */
  pageHeight: number;
  /** The page's own width. Larger than `width` when content overflows sideways and is not pictured. */
  pageWidth: number;
  overflowsWidth: boolean;
  /** True when the page is taller than the limit, so the tiles do not reach its end. */
  truncated: boolean;
  tileSize: number;
  grid: { cols: number; rows: number };
  background: string;
  tiles: (Tile & { bytes: number })[];
  landmarks: Landmark[];
}

export interface TileCaptureOptions {
  url: string;
  outDir: string;
  /** Width the page is laid out at. */
  width?: number;
  /** Edge of a square tile. Edge tiles are smaller; none is padded. */
  tileSize?: number;
  /** Pages taller than this are cut off, and the manifest says so. */
  maxHeight?: number;
  browserType?: BrowserType;
  /** Injected for tests. */
  now?: () => Date;
}

/** A pixel option: plain digits within a range, so a typo cannot ask for millions of tiles. */
export function parsePixels(name: string, value: string, min: number, max: number): number {
  const n = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!(n >= min && n <= max)) {
    throw new Error(`--${name} must be a whole number from ${min} to ${max}, got "${value}"`);
  }
  return n;
}

/** Only pages on the web are captured, never local files or browser pages. */
export function webUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`"${value}" is not a URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http and https pages are captured, got ${url.protocol}`);
  }
  return url.href;
}

/** The grid that covers `width` by `height` with tiles of at most `tileSize`, row by row. */
export function tileGrid(width: number, height: number, tileSize: number): Tile[] {
  for (const [name, value] of Object.entries({ width, height, tileSize })) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive whole number, got ${value}`);
    }
  }
  const tiles: Tile[] = [];
  for (let row = 0, y = 0; y < height; row++, y += tileSize) {
    for (let col = 0, x = 0; x < width; col++, x += tileSize) {
      tiles.push({
        col,
        row,
        x,
        y,
        w: Math.min(tileSize, width - x),
        h: Math.min(tileSize, height - y),
        file: `tile-r${String(row).padStart(3, '0')}-c${String(col).padStart(3, '0')}.png`,
      });
    }
  }
  return tiles;
}

export async function capturePageTiles(options: TileCaptureOptions): Promise<PageTilesManifest> {
  const width = options.width ?? 1440;
  const tileSize = options.tileSize ?? 2048;
  const maxHeight = options.maxHeight ?? 60000;
  await mkdir(options.outDir, { recursive: true });
  // An earlier capture's tiles or manifest must not sit beside this one and pass for part of it.
  for (const name of await readdir(options.outDir)) {
    if (name === 'manifest.json' || /^tile-r\d+-c\d+\.png$/.test(name)) {
      await rm(path.join(options.outDir, name), { force: true });
    }
  }

  const manifest = await withSettledPage(
    { url: options.url, width, walkHeight: maxHeight, browserType: options.browserType },
    async (page, facts): Promise<PageTilesManifest> => {
      if (facts.status === null || facts.status >= 400) {
        throw new Error(
          `${options.url} answered ${facts.status ?? 'nothing'}; an error page is not a capture`,
        );
      }
      const height = Math.min(facts.height, maxHeight);
      const grid = tileGrid(width, height, tileSize);
      const tiles: PageTilesManifest['tiles'] = [];
      for (const tile of grid) {
        const file = path.join(options.outDir, tile.file);
        // A clip of the full page: the viewport is not resized, so viewport-height layouts keep
        // their shape, and no picture larger than one tile is ever held.
        await page.screenshot({
          path: file,
          fullPage: true,
          // Tiles are taken one after another; anything still moving would show as a seam.
          animations: 'disabled',
          caret: 'hide',
          clip: { x: tile.x, y: tile.y, width: tile.w, height: tile.h },
        });
        const meta = await sharp(file).metadata();
        if (meta.width !== tile.w || meta.height !== tile.h) {
          throw new Error(
            `${tile.file} is ${meta.width}x${meta.height}, expected ${tile.w}x${tile.h}`,
          );
        }
        tiles.push({ ...tile, bytes: (await stat(file)).size });
      }
      const after = await measurePage(page);
      if (after.height !== facts.height) {
        throw new Error(
          `The page changed height while it was captured (${facts.height}px to ${after.height}px); ` +
            'the tiles would not fit together',
        );
      }
      const last = grid[grid.length - 1];
      return {
        schema: PAGE_TILES_SCHEMA,
        url: options.url,
        finalUrl: facts.finalUrl,
        status: facts.status,
        title: facts.title,
        capturedAt: (options.now ?? (() => new Date()))().toISOString(),
        width,
        height,
        pageHeight: facts.height,
        truncated: facts.height > maxHeight,
        pageWidth: facts.width,
        overflowsWidth: facts.width > width,
        tileSize,
        grid: { cols: last.col + 1, rows: last.row + 1 },
        background: facts.background,
        tiles,
        landmarks: await readLandmarks(page, width, height),
      };
    },
  );

  await writeFile(
    path.join(options.outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  return manifest;
}
