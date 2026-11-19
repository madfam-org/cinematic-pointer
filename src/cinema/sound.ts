/**
 * Renders a score and lays it under a finished picture. The picture is copied, never re-encoded.
 */
import { spawn } from 'child_process';
import { rename, rm } from 'fs/promises';
import path from 'path';

import { scoreArgs, scoreCues } from './score';
import { Screenplay } from './types';

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
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

/** Whether a media file carries an audio stream. False when it cannot be read. */
export function hasAudio(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'a',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'csv=p=0',
      filePath,
    ]);
    let out = '';
    proc.stdout.on('data', (chunk) => {
      out += chunk.toString();
    });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0 && out.includes('audio')));
  });
}

/** Score a screenplay and mux it into `videoPath` in place. Returns the number of cues. */
export async function addScore(
  screenplay: Screenplay,
  videoPath: string,
  workDir: string,
): Promise<number> {
  const cues = scoreCues(screenplay);
  const wav = path.join(workDir, 'score.wav');
  const muxed = path.join(workDir, 'scored.mp4');
  await run(scoreArgs(cues, screenplay.duration, wav));
  await run([
    '-v',
    'error',
    '-y',
    '-i',
    videoPath,
    '-i',
    wav,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-movflags',
    '+faststart',
    muxed,
  ]);
  await rename(muxed, videoPath);
  await rm(wav, { force: true });
  return cues.length;
}
