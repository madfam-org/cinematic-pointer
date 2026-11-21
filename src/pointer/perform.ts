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
  /**
   * The page rectangle the frame shows during each shot, by shot name. When a shot has one, its
   * entrance is pushed along the same line until it starts outside that rectangle, so a pointer
   * never pops into view (a live take shows the whole page width, where `viewWidth` alone is not enough).
   */
  views?: Record<string, { x: number; y: number; w: number; h: number }>;
}

/**
 * The first point on the line from (`cx`, `cy`) along (`dx`, `dy`), at least one step out, where a
 * pointer `size` pixels across (its tip at the point, its body to the right and below) is wholly
 * outside `view` with `margin` to spare.
 */
function outside(
  view: { x: number; y: number; w: number; h: number },
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  size: number,
  margin: number,
): { x: number; y: number } {
  const exit = (c: number, d: number, low: number, high: number) => {
    if (d > 0) return (high + margin - c) / d;
    if (d < 0) return (low - size - margin - c) / d;
    return Infinity;
  };
  const k = Math.max(
    1,
    Math.min(exit(cx, dx, view.x, view.x + view.w), exit(cy, dy, view.y, view.y + view.h)),
  );
  return { x: cx + dx * k, y: cy + dy * k };
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
  const size = Math.round((persona.size * options.frameWidth) / 1280);

  shots.forEach((shot, index) => {
    const subject = subjects[shot.name];
    if (!subject) return;
    const end = shot.start + shot.duration;
    const side = index % 2 === 0 ? 1 : -1;
    // The entrance: off to one side and below, so the move reads as a hand coming in.
    let fromX = subject.x + subject.w / 2 + side * reach;
    let fromY = subject.y + subject.h / 2 + reach * 0.55;
    const view = options.views?.[shot.name];
    if (view) {
      const cx = subject.x + subject.w / 2;
      const cy = subject.y + subject.h / 2;
      ({ x: fromX, y: fromY } = outside(view, cx, cy, fromX - cx, fromY - cy, size, size / 4));
    }
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
    size,
    ink: persona.ink,
    fill: persona.fill,
    ring: persona.ring,
    keys,
    presses,
  };
}
