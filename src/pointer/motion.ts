/**
 * Pointer motion
 *
 * Where the pointer is, and what it wears, at any time `t`. A pure function of the track and the
 * time: no clock, no randomness. The same source text runs in Node (for tests and planning) and
 * inside the stage page, so the two can never disagree.
 */
import { OutfitId } from './outfits';

export interface PointerKey {
  /** Seconds from the start of the trailer. */
  t: number;
  /** Page pixels. */
  x: number;
  y: number;
  outfit: OutfitId;
  /** 0 hides the pointer, 1 shows it. */
  show: 0 | 1;
  /** Jump here at `t` instead of travelling from the previous key (a camera cut). */
  cut?: boolean;
  /** Bow of the move that arrives at this key, as a share of its length. */
  bow?: number;
}

export interface PointerTrack {
  /** Pointer width in frame pixels. */
  size: number;
  ink: string;
  fill: string;
  ring: string;
  keys: PointerKey[];
  /** Times at which the pointer presses. */
  presses: number[];
}

export interface PointerPose {
  x: number;
  y: number;
  outfit: OutfitId;
  /** 0 to 1. */
  opacity: number;
  /** 1 at rest; dips while a press lands. */
  squash: number;
  /** Rings left by recent presses: where, and how far through its life each is (0 to 1). */
  rings: Array<{ x: number; y: number; p: number }>;
}

/** Seconds a press squashes the pointer, and seconds its ring lives. */
export const PRESS_SECONDS = 0.28;
export const RING_SECONDS = 0.7;
const FADE_SECONDS = 0.2;

/** ES5 source of `pointerAt(track, t)`. Embedded verbatim in the stage page. */
export const POINTER_MATH_JS = `
function pointerAt(track, t) {
  var keys = track.keys, n = keys.length;
  var pose = { x: 0, y: 0, outfit: 'arrow', opacity: 0, squash: 1, rings: [] };
  if (n === 0) return pose;
  var i = 0;
  while (i < n - 1 && t >= keys[i + 1].t) i++;
  var a = keys[i], b = i < n - 1 ? keys[i + 1] : null;
  pose.x = a.x; pose.y = a.y; pose.outfit = a.outfit; pose.opacity = a.show;
  if (t < a.t) { pose.opacity = 0; }
  else if (b) {
    var span = b.t - a.t, local = t - a.t;
    if (!b.cut && span > 0) {
      var p = local / span;
      var e = p * p * p * (10 + p * (6 * p - 15));
      var dx = b.x - a.x, dy = b.y - a.y;
      var lift = (b.bow || 0) * Math.sin(Math.PI * e);
      pose.x = a.x + dx * e - dy * lift;
      pose.y = a.y + dy * e + dx * lift;
    }
    var fade = Math.min(${FADE_SECONDS}, span);
    if (a.show !== b.show && fade > 0) {
      pose.opacity = b.show === 1
        ? (b.cut ? 0 : Math.min(1, local / fade))
        : Math.min(1, Math.max(0, (span - local) / fade));
    }
  }
  for (var k = 0; k < track.presses.length; k++) {
    var since = t - track.presses[k];
    if (since < 0) continue;
    if (since < ${PRESS_SECONDS}) {
      pose.squash = 1 - 0.16 * Math.sin(Math.PI * since / ${PRESS_SECONDS});
    }
    if (since < ${RING_SECONDS}) {
      var at = pointerAt({ keys: keys, presses: [] }, track.presses[k]);
      pose.rings.push({ x: at.x, y: at.y, p: since / ${RING_SECONDS} });
    }
  }
  return pose;
}`;

// The stage embeds the text above; Node evaluates the same text, so there is one implementation.

const compiled = new Function(`${POINTER_MATH_JS}; return pointerAt;`)() as (
  track: Pick<PointerTrack, 'keys' | 'presses'>,
  t: number,
) => PointerPose;

export function pointerAt(track: Pick<PointerTrack, 'keys' | 'presses'>, t: number): PointerPose {
  return compiled(track, t);
}
