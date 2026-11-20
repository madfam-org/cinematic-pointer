/**
 * Pointer performance
 *
 * Gives the pointer its part in a screenplay: where it enters, what it looks at, when it presses.
 * The persona decides the manner. Pure: the same shots, subjects and persona give the same track.
 */
import { PointerKey, PointerTrack, PRESS_SECONDS } from './motion';
import { Persona, PointerState } from './persona';

/** What a shot is about, in page pixels. */
export interface Subject {
  kind: 'headline' | 'section' | 'action' | 'place';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShotTiming {
  name: string;
  start: number;
  duration: number;
}

export interface PerformOptions {
  /** Width of the output frame in pixels: the pointer is sized against it. */
  frameWidth: number;
  /** Page pixels the frame shows across, at the widest framing. Sets how far off the entrance is. */
  viewWidth: number;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Build the pointer's track. A shot with no subject (a title or end card) has no pointer in it.
 */
export function perform(
  shots: ShotTiming[],
  subjects: Record<string, Subject | undefined>,
  persona: Persona,
  options: PerformOptions,
): PointerTrack {
  const keys: PointerKey[] = [];
  const presses: number[] = [];
  const wear = (state: PointerState) => persona.wardrobe[state];
  // Beyond half the widest framing, so the entrance starts outside the frame.
  const reach = options.viewWidth * 0.55;

  shots.forEach((shot, index) => {
    const subject = subjects[shot.name];
    if (!subject) return;
    const end = shot.start + shot.duration;
    const side = index % 2 === 0 ? 1 : -1;
    // The entrance: off to one side and below, so the move reads as a hand coming in.
    const fromX = subject.x + subject.w / 2 + side * reach;
    const fromY = subject.y + subject.h / 2 + reach * 0.55;
    const travel = Math.min(shot.duration * 0.55, (shot.duration * 0.45) / persona.pace);
    const arrive = shot.start + travel;
    const bow = side * persona.bow;
    const key = (t: number, x: number, y: number, state: PointerState, more: Partial<PointerKey>) =>
      keys.push({ t: round(t), x: round(x), y: round(y), outfit: wear(state), show: 1, ...more });

    key(shot.start, fromX, fromY, 'travel', { cut: true });

    if (subject.kind === 'action') {
      const cx = subject.x + subject.w / 2;
      const cy = subject.y + subject.h / 2;
      key(arrive, cx, cy, 'hover', { bow });
      // Rest on the control, then press; always leave time for the press to be seen.
      const press = Math.min(arrive + persona.hesitation, end - PRESS_SECONDS - 0.5);
      if (press >= arrive) {
        key(press, cx, cy, 'press', {});
        presses.push(round(press));
        key(press + PRESS_SECONDS, cx, cy, 'hover', {});
      }
    } else if (persona.reads && subject.kind !== 'place') {
      // Follow the line under the words, from its start to most of the way along.
      const y = subject.y + subject.h + 6;
      key(arrive, subject.x + subject.w * 0.08, y, 'read', { bow });
      key(end - 0.15, subject.x + subject.w * 0.72, y, 'read', {});
    } else {
      key(arrive, subject.x + subject.w * 0.5, subject.y + subject.h + 10, 'inspect', { bow });
    }
    // Leave with the shot, so the pointer never hangs over a card.
    const last = keys[keys.length - 1];
    keys.push({ ...last, t: round(end), show: 0, cut: undefined, bow: undefined });
  });

  return {
    size: Math.round((persona.size * options.frameWidth) / 1280),
    ink: persona.ink,
    fill: persona.fill,
    ring: persona.ring,
    keys,
    presses,
  };
}
