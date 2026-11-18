/**
 * Score
 *
 * An original, synthesized soundtrack for a screenplay: a low drone under everything, a hit on each
 * cut, a whoosh into each montage move, a riser into the close, and a tail on the end card. Every
 * sound is generated from oscillators and noise by FFmpeg on the CPU, so there is no sample, no
 * library and nothing to license. Pure: the same screenplay gives the same cue list and arguments.
 */
import { Screenplay } from './types';

export type CueKind = 'drone' | 'hit' | 'boom' | 'whoosh' | 'riser' | 'pulse';

export interface Cue {
  kind: CueKind;
  /** Seconds from the start. */
  at: number;
  duration: number;
  gain: number;
}

const RATE = 48000;

/** Decide what sounds, and when, from the shot list. */
export function scoreCues(screenplay: Screenplay): Cue[] {
  const cues: Cue[] = [{ kind: 'drone', at: 0, duration: screenplay.duration, gain: 0.5 }];
  const montage = screenplay.shots.filter((s) => s.name.startsWith('montage'));

  for (const shot of screenplay.shots) {
    if (shot.name === 'title') {
      cues.push({ kind: 'boom', at: shot.start + 0.15, duration: 2.6, gain: 0.9 });
    } else if (shot.name === 'hero') {
      cues.push({ kind: 'whoosh', at: Math.max(0, shot.start - 0.35), duration: 0.5, gain: 0.5 });
      cues.push({ kind: 'hit', at: shot.start, duration: 1.4, gain: 0.85 });
    } else if (shot.name.startsWith('montage')) {
      cues.push({ kind: 'whoosh', at: Math.max(0, shot.start - 0.3), duration: 0.42, gain: 0.45 });
      cues.push({ kind: 'hit', at: shot.start, duration: 0.9, gain: 0.6 });
    } else if (shot.name === 'close') {
      cues.push({ kind: 'boom', at: shot.start, duration: 2.4, gain: 1.0 });
    } else if (shot.name === 'end') {
      cues.push({ kind: 'hit', at: shot.start, duration: 1.8, gain: 0.7 });
    }
  }

  if (montage.length > 0) {
    const first = montage[0].start;
    const last = montage[montage.length - 1];
    const end = last.start + last.duration;
    // A pulse under the montage and a riser that peaks exactly on the cut to the close.
    cues.push({ kind: 'pulse', at: first, duration: end - first, gain: 0.4 });
    const rise = Math.min(end - first, 3.5);
    cues.push({ kind: 'riser', at: end - rise, duration: rise, gain: 0.55 });
  }

  return cues.sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind));
}

function n(value: number): string {
  return (Math.round(value * 1000) / 1000).toString();
}

/**
 * The FFmpeg source graph for one cue. Expressions avoid commas, which separate filters in a graph.
 */
export function cueSource(cue: Cue): string {
  const d = n(cue.duration);
  const out = `afade=t=out:st=${n(cue.duration * 0.6)}:d=${n(cue.duration * 0.4)}`;
  switch (cue.kind) {
    case 'drone':
      // Two detuned low tones and a fifth, breathing slowly.
      return (
        `aevalsrc='(0.5*sin(2*PI*55*t)+0.5*sin(2*PI*55.4*t)+0.28*sin(2*PI*82.5*t))*(0.8+0.2*sin(2*PI*0.11*t))':s=${RATE}:d=${d}` +
        `,lowpass=f=420,afade=t=in:st=0:d=1.2,afade=t=out:st=${n(Math.max(0, cue.duration - 1.6))}:d=1.6`
      );
    case 'hit':
      // A pitched thump that drops and dies.
      return `aevalsrc='sin(2*PI*(70*t-22*t*t))*exp(-5*t)':s=${RATE}:d=${d},lowpass=f=260,${out}`;
    case 'boom':
      // A deeper, longer drop with a little grit.
      return `aevalsrc='(sin(2*PI*(52*t-9*t*t))+0.3*sin(2*PI*(104*t-18*t*t)))*exp(-1.8*t)':s=${RATE}:d=${d},lowpass=f=200,${out}`;
    case 'whoosh':
      return (
        `anoisesrc=d=${d}:c=pink:r=${RATE}:a=0.9:seed=7` +
        `,bandpass=f=1400:w=1100,afade=t=in:st=0:d=${n(cue.duration * 0.7)},afade=t=out:st=${n(cue.duration * 0.7)}:d=${n(cue.duration * 0.3)}`
      );
    case 'riser':
      // A tone that climbs and swells; it stops dead at its end, on the cut.
      return `aevalsrc='sin(2*PI*(90*t+${n(260 / cue.duration)}*t*t))*(t/${d})*(t/${d})':s=${RATE}:d=${d},highpass=f=120,afade=t=out:st=${n(cue.duration - 0.04)}:d=0.04`;
    case 'pulse':
      // A soft heartbeat, twice a second.
      return `aevalsrc='sin(2*PI*46*t)*exp(-9*(t-floor(2*t)/2))':s=${RATE}:d=${d},lowpass=f=160,afade=t=in:st=0:d=0.4,afade=t=out:st=${n(Math.max(0, cue.duration - 0.2))}:d=0.2`;
  }
}

/** FFmpeg arguments that render the cues to a stereo WAV of exactly the screenplay's length. */
export function scoreArgs(cues: Cue[], duration: number, outputPath: string): string[] {
  if (cues.length === 0) throw new Error('A score needs at least one cue');
  const args: string[] = ['-v', 'error', '-y'];
  for (const cue of cues) {
    args.push('-f', 'lavfi', '-i', cueSource(cue));
  }
  const chains = cues.map(
    (cue, i) => `[${i}:a]volume=${n(cue.gain)},adelay=${Math.round(cue.at * 1000)}:all=1[c${i}]`,
  );
  const mix =
    cues.map((_, i) => `[c${i}]`).join('') +
    `amix=inputs=${cues.length}:normalize=0:duration=longest,` +
    `aecho=0.8:0.6:70:0.25,alimiter=limit=0.89,` +
    `apad=whole_dur=${n(duration)},atrim=0:${n(duration)},aformat=channel_layouts=stereo[out]`;
  args.push(
    '-filter_complex',
    [...chains, mix].join(';'),
    '-map',
    '[out]',
    '-ar',
    String(RATE),
    outputPath,
  );
  return args;
}
