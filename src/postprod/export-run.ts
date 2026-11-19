/**
 * Export runner
 *
 * One take to a matrix of formats and aspects (RFC 0061, the `export` kind). Every output is
 * measured before it is called done: bytes, seconds, dimensions, codec, sound, and two frames that
 * differ. A file that was written but does not pass is reported as failed, not as an output.
 */
import { mkdir, rm, stat, writeFile } from 'fs/promises';
import path from 'path';

import { aspectRatios } from '../utils/aspect';

import { exportVideo, outputFormats, platformPresets } from './export';
import { getFFmpegVersion, hasFFmpegFilter } from './ffmpeg';
import { grabFrame, measure, Measured } from './proof';

export const EXPORT_SCHEMA = 'cinematic-pointer/export@1';

/** The codec ffprobe reports for each format this tool can write. */
const EXPECTED_CODEC: Record<string, string> = {
  mp4: 'h264',
  webm: 'vp9',
  hevc: 'hevc',
  gif: 'gif',
  prores: 'prores',
};

export type Quality = 'draft' | 'standard' | 'high';

export interface ExportTarget {
  format: string;
  aspect: string;
  /** Set when the target came from a platform preset. */
  platform?: string;
}

export interface ExportedFile extends ExportTarget {
  file: string;
  bytes: number;
  seconds: number;
  width: number;
  height: number;
  videoCodec: string;
  audio: boolean;
}

export interface FailedTarget extends ExportTarget {
  reason: string;
}

export interface ExportManifest {
  schema: typeof EXPORT_SCHEMA;
  exportedAt: string;
  input: { file: string; bytes: number } & Measured;
  quality: Quality;
  ffmpeg: string;
  /** Whether this FFmpeg build could burn captions. Stated so a missing capability is never silent. */
  captions: string;
  outputs: ExportedFile[];
  failed: FailedTarget[];
}

export interface ExportRunOptions {
  inputPath: string;
  outDir: string;
  formats?: string[];
  aspects?: string[];
  platforms?: string[];
  quality?: Quality;
  /** Injected for tests. */
  now?: () => Date;
}

/**
 * The targets a request asks for: every format with every aspect, plus each platform's own format
 * and aspects. Duplicates are dropped; an unknown name is an error, never a silent default.
 */
export function exportMatrix(request: {
  formats?: string[];
  aspects?: string[];
  platforms?: string[];
}): ExportTarget[] {
  const formats = request.formats ?? [];
  const aspects = request.aspects ?? [];
  const platforms = request.platforms ?? [];
  for (const format of formats) {
    if (!Object.hasOwn(outputFormats, format)) {
      throw new Error(`Unknown format "${format}". Use ${Object.keys(outputFormats).join(', ')}.`);
    }
  }
  for (const aspect of aspects) {
    if (!Object.hasOwn(aspectRatios, aspect)) {
      throw new Error(`Unknown aspect "${aspect}". Use ${Object.keys(aspectRatios).join(', ')}.`);
    }
  }
  if (formats.length > 0 !== aspects.length > 0) {
    throw new Error('Give formats and aspects together, or use platforms');
  }

  const targets: ExportTarget[] = [];
  const seen = new Set<string>();
  const add = (target: ExportTarget) => {
    const key = `${target.format}|${target.aspect}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(target);
  };
  for (const format of formats) for (const aspect of aspects) add({ format, aspect });
  for (const platform of platforms) {
    const preset = Object.hasOwn(platformPresets, platform) ? platformPresets[platform] : null;
    if (!preset) {
      throw new Error(
        `Unknown platform "${platform}". Use ${Object.keys(platformPresets).join(', ')}.`,
      );
    }
    for (const aspect of preset.aspects) add({ format: preset.format, aspect, platform });
  }
  if (targets.length === 0)
    throw new Error('Nothing to export: give formats and aspects, or platforms');
  return targets;
}

/** Why a written file is not an acceptable output for its target, or null when it is. */
export function judge(
  target: ExportTarget,
  measured: Measured & { bytes: number },
  input: Measured,
): string | null {
  const want = aspectRatios[target.aspect];
  if (measured.bytes === 0) return 'the file is empty';
  if (measured.width !== want.width || measured.height !== want.height) {
    return `it is ${measured.width}x${measured.height}, expected ${want.width}x${want.height}`;
  }
  const codec = EXPECTED_CODEC[target.format];
  if (codec && measured.videoCodec !== codec) {
    return `its codec is ${measured.videoCodec || 'unknown'}, expected ${codec}`;
  }
  // Half a second or 3%, whichever is larger: containers round durations differently.
  const tolerance = Math.max(0.5, input.seconds * 0.03);
  if (Math.abs(measured.seconds - input.seconds) > tolerance) {
    return `it lasts ${measured.seconds.toFixed(2)}s, the take lasts ${input.seconds.toFixed(2)}s`;
  }
  const wantsAudio = input.audio && outputFormats[target.format].audioCodec !== 'none';
  if (wantsAudio && !measured.audio) return 'the take has sound and this file has none';
  return null;
}

/** A file can have the right length and still show one held frame. Two moments of a take differ. */
async function showsOnePicture(file: string, seconds: number): Promise<string | null> {
  const early = await grabFrame(file, seconds * 0.25);
  const late = await grabFrame(file, seconds * 0.75);
  if (early.length === 0 || late.length === 0) return 'it has no readable picture';
  if (early.equals(late)) return 'it shows the same picture at 25% and 75%';
  return null;
}

export function exportFileName(base: string, target: ExportTarget): string {
  const extension = outputFormats[target.format].extension;
  // The format is part of the name: mp4 and hevc share an extension and would overwrite each other.
  return `${base}_${target.format}_${target.aspect.replace(':', 'x')}${extension}`;
}

/** Containers a take may be in. Anything else (a playlist, a script, an image) is not a take. */
const TAKE_CONTAINERS = ['mp4', 'mov', 'matroska', 'webm'];

export function isTakeContainer(container: string): boolean {
  return container.split(',').some((name) => TAKE_CONTAINERS.includes(name.trim()));
}

export async function runExport(given: ExportRunOptions): Promise<ExportManifest> {
  // Absolute paths: a relative name beginning with "-" would be read by FFmpeg as an option.
  const options = {
    ...given,
    inputPath: path.resolve(given.inputPath),
    outDir: path.resolve(given.outDir),
  };
  const targets = exportMatrix(options);
  const quality = options.quality ?? 'standard';
  const inputStat = await stat(options.inputPath);
  const input = await measure(options.inputPath);
  if (!isTakeContainer(input.container)) {
    throw new Error(`The take is not a video file this tool exports (${input.container || '?'})`);
  }
  if (!(input.seconds > 0)) throw new Error(`${options.inputPath} has no duration`);
  const inputProblem = await showsOnePicture(options.inputPath, input.seconds);
  if (inputProblem) throw new Error(`The take is not exportable: ${inputProblem}`);

  await mkdir(options.outDir, { recursive: true });
  const base = path.basename(options.inputPath, path.extname(options.inputPath));
  const outputs: ExportedFile[] = [];
  const failed: FailedTarget[] = [];

  for (const target of targets) {
    const file = exportFileName(base, target);
    const filePath = path.join(options.outDir, file);
    await rm(filePath, { force: true });
    try {
      const result = await exportVideo({
        inputPath: options.inputPath,
        outputDir: options.outDir,
        baseName: `${base}_${target.format}`,
        formats: [target.format],
        aspects: [target.aspect],
        quality,
      });
      if (result.errors.length > 0) throw new Error(result.errors[0].error);
      const measured = { ...(await measure(filePath)), bytes: (await stat(filePath)).size };
      const problem =
        judge(target, measured, input) ?? (await showsOnePicture(filePath, measured.seconds));
      if (problem) throw new Error(problem);
      outputs.push({ ...target, file, ...measured });
    } catch (error) {
      // A file that did not pass is not left beside the ones that did.
      await rm(filePath, { force: true });
      failed.push({ ...target, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  const manifest: ExportManifest = {
    schema: EXPORT_SCHEMA,
    exportedAt: (options.now ?? (() => new Date()))().toISOString(),
    input: { file: path.basename(options.inputPath), bytes: inputStat.size, ...input },
    quality,
    ffmpeg: await getFFmpegVersion(),
    captions: (await hasFFmpegFilter('subtitles'))
      ? 'available'
      : 'unavailable: this FFmpeg build has no subtitles filter (libass)',
    outputs,
    failed,
  };
  await writeFile(
    path.join(options.outDir, 'export.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  return manifest;
}
