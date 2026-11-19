/**
 * Proof helpers
 *
 * Small measurements used to decide whether a rendered file is what it claims to be.
 */
import { spawn } from 'child_process';

/** One small grayscale frame at `seconds`, as raw bytes. Empty when FFmpeg could not read one. */
export async function grabFrame(filePath: string, seconds: number): Promise<Buffer> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', [
      '-v',
      'error',
      '-ss',
      seconds.toFixed(2),
      '-protocol_whitelist',
      'file,pipe',
      '-i',
      filePath,
      '-frames:v',
      '1',
      '-vf',
      'scale=64:36,format=gray',
      '-f',
      'rawvideo',
      '-',
    ]);
    const chunks: Buffer[] = [];
    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.on('error', () => resolve(Buffer.alloc(0)));
    proc.on('close', (code) => resolve(code === 0 ? Buffer.concat(chunks) : Buffer.alloc(0)));
  });
}

export interface Measured {
  seconds: number;
  width: number;
  height: number;
  /** Codec of the first video stream as ffprobe names it (`h264`, `vp9`, `hevc`, `gif`, `prores`). */
  videoCodec: string;
  /** The container as ffprobe names it, e.g. `mov,mp4,m4a,3gp,3g2,mj2` or `matroska,webm`. */
  container: string;
  audio: boolean;
}

/** What ffprobe reports about a file. Rejects when it cannot be read or has no picture. */
export function measure(filePath: string): Promise<Measured> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v',
      'error',
      // A file is read as a file. Without this a playlist or script dressed up as a video could
      // make ffprobe open other files or network addresses.
      '-protocol_whitelist',
      'file',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);
    let out = '';
    proc.stdout.on('data', (chunk) => {
      out += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe could not read ${filePath}`));
      try {
        const data = JSON.parse(out) as {
          format?: { duration?: string; format_name?: string };
          streams?: {
            codec_type: string;
            codec_name?: string;
            width?: number;
            height?: number;
            duration?: string;
          }[];
        };
        const video = data.streams?.find((s) => s.codec_type === 'video');
        if (!video || !video.width || !video.height) {
          return reject(new Error(`${filePath} has no picture`));
        }
        resolve({
          seconds: parseFloat(data.format?.duration ?? video.duration ?? '0') || 0,
          width: video.width,
          height: video.height,
          videoCodec: video.codec_name ?? '',
          container: data.format?.format_name ?? '',
          audio: Boolean(data.streams?.some((s) => s.codec_type === 'audio')),
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}
