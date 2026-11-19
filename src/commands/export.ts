import chalk from 'chalk';

import { Quality, runExport } from '../postprod/export-run';

interface ExportCommandOptions {
  out: string;
  formats?: string;
  aspects?: string;
  platforms?: string;
  quality: string;
}

const list = (value?: string): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * Export one take to a matrix of formats and aspects. Exit 0 when every target passed its
 * measurements, 1 when at least one did not, 2 when nothing could be exported.
 */
export async function exportCommand(video: string, options: ExportCommandOptions): Promise<void> {
  try {
    if (!['draft', 'standard', 'high'].includes(options.quality)) {
      throw new Error('--quality must be draft, standard or high');
    }
    const manifest = await runExport({
      inputPath: video,
      outDir: options.out,
      formats: list(options.formats),
      aspects: list(options.aspects),
      platforms: list(options.platforms),
      quality: options.quality as Quality,
    });
    for (const output of manifest.outputs) {
      console.log(
        chalk.green('  ✓ ') +
          `${output.format} ${output.aspect}  ${output.width}x${output.height} ` +
          `${output.seconds.toFixed(1)}s ${output.bytes}B  ${output.file}`,
      );
    }
    for (const failure of manifest.failed) {
      console.log(chalk.red('  ✗ ') + `${failure.format} ${failure.aspect}  ${failure.reason}`);
    }
    console.log(
      `export=${manifest.failed.length === 0 ? 'DONE' : 'INCOMPLETE'} ` +
        `outputs=${manifest.outputs.length} failed=${manifest.failed.length} ` +
        `captions=${manifest.captions.split(':')[0]}`,
    );
    process.exit(manifest.failed.length === 0 ? 0 : 1);
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(2);
  }
}
