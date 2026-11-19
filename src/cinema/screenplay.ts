/**
 * Auto-director
 *
 * Turns a page capture into a trailer's shot list: a title card, a push-in on the headline, a montage
 * of the sections, a close on the call to action, and an end card. Pure: the same capture and options
 * give the same screenplay, byte for byte.
 */
import { Camera, Landmark, PageCapture, Screenplay, Shot } from './types';

export interface DirectorOptions {
  frame: { w: number; h: number };
  /** Name on the title and end cards. */
  name: string;
  /** Line under the name on the end card, e.g. the host. */
  tagline?: string;
  /** How many sections the montage visits at most. */
  montage?: number;
}

const TITLE_SECONDS = 2.2;
const HERO_SECONDS = 3.2;
const MONTAGE_SECONDS = 1.5;
const CLOSE_SECONDS = 2.4;
const END_SECONDS = 2.6;
/** Montage stops must be at least this far apart, as a share of the frame height. */
const MIN_GAP = 0.8;

function centre(mark: Landmark): { x: number; y: number } {
  return { x: mark.x + mark.w / 2, y: mark.y + mark.h / 2 };
}

/** Keep the camera's subject inside the page so a tilt never shows more void than page. */
function clampY(capture: PageCapture, y: number): number {
  return Math.min(Math.max(y, 0), capture.height);
}

function cam(capture: PageCapture, partial: Partial<Camera>): Camera {
  return {
    cx: capture.width / 2,
    cy: 0,
    scale: 1,
    rx: 0,
    ry: 0,
    rz: 0,
    blur: 0,
    light: 1,
    ...partial,
    ...(partial.cy !== undefined ? { cy: clampY(capture, partial.cy) } : {}),
  };
}

/** Pick montage stops: second-level headings, top to bottom, no two closer than the minimum gap. */
export function pickMontage(capture: PageCapture, frameH: number, scale: number, max: number) {
  const minGap = (frameH / scale) * MIN_GAP;
  const headline = capture.landmarks.find((m) => m.kind === 'h1');
  const picked: Landmark[] = [];
  let last = headline ? centre(headline).y : -Infinity;
  for (const mark of capture.landmarks.filter((m) => m.kind === 'h2').sort((a, b) => a.y - b.y)) {
    const y = centre(mark).y;
    if (y - last >= minGap) {
      picked.push(mark);
      last = y;
    }
  }
  if (picked.length <= max) return picked;
  // Too many: keep an even spread, always including the first and the last.
  const spread: Landmark[] = [];
  for (let i = 0; i < max; i++) {
    spread.push(picked[Math.round((i * (picked.length - 1)) / (max - 1 || 1))]);
  }
  return spread;
}

export function direct(capture: PageCapture, options: DirectorOptions): Screenplay {
  const { frame } = options;
  // At scale `fit` the page is exactly as wide as the frame.
  const fit = frame.w / capture.width;
  const viewH = frame.h / fit;
  const headline = capture.landmarks.find((m) => m.kind === 'h1');
  const hero = headline ? centre(headline) : { x: capture.width / 2, y: viewH * 0.4 };
  const shots: Shot[] = [];
  let t = 0;

  const push = (shot: Omit<Shot, 'start'>) => {
    shots.push({ ...shot, start: t });
    t += shot.duration;
  };

  // 1. Title card over the page, out of focus and dim.
  push({
    name: 'title',
    duration: TITLE_SECONDS,
    from: cam(capture, {
      cy: viewH * 0.5,
      scale: fit * 1.05,
      rx: 14,
      ry: -8,
      blur: 22,
      light: 0.28,
    }),
    to: cam(capture, { cy: viewH * 0.5, scale: fit * 1.12, rx: 12, ry: -6, blur: 16, light: 0.34 }),
    ease: 'linear',
    title: { text: options.name },
    fadeIn: 0.7,
    fadeOut: 0.25,
  });

  // 2. Hero: start wide and tilted, settle on the headline.
  push({
    name: 'hero',
    duration: HERO_SECONDS,
    from: cam(capture, {
      cx: hero.x,
      cy: viewH * 0.55,
      scale: fit * 0.82,
      rx: 32,
      ry: -20,
      rz: -3,
    }),
    to: cam(capture, { cx: hero.x, cy: hero.y, scale: fit * 1.3, rx: 5, ry: -3 }),
    ease: 'out',
    fadeIn: 0.2,
    fadeOut: 0.12,
  });

  // 3. Montage: one quick drifting move per section, alternating sides.
  const montageScale = fit * 1.15;
  const stops = pickMontage(capture, frame.h, montageScale, options.montage ?? 4);
  stops.forEach((mark, index) => {
    const at = centre(mark);
    const side = index % 2 === 0 ? 1 : -1;
    const y = at.y + (frame.h / montageScale) * 0.22;
    push({
      name: `montage-${index + 1}`,
      duration: MONTAGE_SECONDS,
      from: cam(capture, {
        cx: at.x - side * 70,
        cy: y,
        scale: montageScale,
        rx: 18,
        ry: side * 16,
        rz: side * 1.5,
      }),
      to: cam(capture, {
        cx: at.x + side * 50,
        cy: y + 40,
        scale: montageScale * 1.08,
        rx: 14,
        ry: side * 10,
        rz: side * 0.5,
      }),
      ease: 'inOut',
      fadeIn: 0.1,
      fadeOut: 0.1,
    });
  });

  // 4. Close: the last call to action, or the foot of the page, straight on.
  const actions = capture.landmarks.filter((m) => m.kind === 'cta');
  const last = actions.length > 0 ? centre(actions[actions.length - 1]) : null;
  const closeAt = last ?? { x: capture.width / 2, y: capture.height - viewH * 0.5 };
  push({
    name: 'close',
    duration: CLOSE_SECONDS,
    from: cam(capture, { cx: closeAt.x, cy: closeAt.y, scale: fit * 1.0, rx: 10, ry: 6 }),
    to: cam(capture, { cx: closeAt.x, cy: closeAt.y, scale: fit * 1.55, rx: 0, ry: 0 }),
    ease: 'out',
    fadeIn: 0.1,
    fadeOut: 0.3,
  });

  // 5. End card.
  push({
    name: 'end',
    duration: END_SECONDS,
    from: cam(capture, { cy: viewH * 0.5, scale: fit * 1.1, rx: 10, ry: 6, blur: 18, light: 0.3 }),
    to: cam(capture, { cy: viewH * 0.5, scale: fit * 1.16, rx: 8, ry: 4, blur: 24, light: 0.22 }),
    ease: 'linear',
    title: { text: options.name, sub: options.tagline },
    fadeIn: 0.3,
    fadeOut: 0.8,
  });

  return { frame, duration: Math.round(t * 1000) / 1000, shots };
}
