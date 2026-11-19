import path from 'path';

import chalk from 'chalk';
import sharp from 'sharp';

import { capturePageTiles, parsePixels, webUrl } from '../cinema/tiles';
import { BrowserType } from '../drivers/playwright';

interface CapturePageOptions {
  out: string;
  width: string;
  tile: string;
  maxHeight: string;
  browser: string;
}

const BROWSERS = ['chromium', 'firefox', 'webkit'];

/** A tile with no variation at all is a flat colour: nothing of the page is on it. */
async function isBlank(file: string): Promise<boolean> {
  const stats = await sharp(file).stats();
  return stats.channels.every((channel) => channel.stdev === 0);
}

/** Capture the full length of a page as tiles plus a manifest. Exit 1 when nothing was pictured. */
export async function capturePageCommand(url: string, options: CapturePageOptions): Promise<void> {
  try {
    if (!BROWSERS.includes(options.browser)) {
      throw new Error(`--browser must be one of ${BROWSERS.join(', ')}`);
    }
    const manifest = await capturePageTiles({
      url: webUrl(url),
      outDir: options.out,
      width: parsePixels('width', options.width, 320, 7680),
      tileSize: parsePixels('tile', options.tile, 256, 8192),
      maxHeight: parsePixels('max-height', options.maxHeight, 256, 200000),
      browserType: options.browser as BrowserType,
    });
    let blank = 0;
    for (const tile of manifest.tiles) {
      if (await isBlank(path.join(options.out, tile.file))) blank++;
    }
    const bytes = manifest.tiles.reduce((sum, tile) => sum + tile.bytes, 0);
    console.log(
      `capture_page=${blank === manifest.tiles.length ? 'BLANK' : 'WRITTEN'} ` +
        `width=${manifest.width} height=${manifest.height} page_height=${manifest.pageHeight} ` +
        `truncated=${manifest.truncated} overflows_width=${manifest.overflowsWidth} ` +
        `status=${manifest.status} grid=${manifest.grid.cols}x${manifest.grid.rows} ` +
        `tiles=${manifest.tiles.length} blank=${blank} bytes=${bytes} ` +
        `landmarks=${manifest.landmarks.length}`,
    );
    if (manifest.truncated) {
      console.warn(
        chalk.yellow(
          `The page is ${manifest.pageHeight}px tall; the tiles stop at ${manifest.height}px.`,
        ),
      );
    }
    if (manifest.overflowsWidth) {
      console.warn(
        chalk.yellow(
          `The page is ${manifest.pageWidth}px wide; the tiles show the first ${manifest.width}px.`,
        ),
      );
    }
    process.exit(blank === manifest.tiles.length ? 1 : 0);
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(2);
  }
}
