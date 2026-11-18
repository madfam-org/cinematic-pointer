/**
 * Scroll timeline
 *
 * Turns a read-only journey (pause, scroll, cameraMark) into a pure function of time:
 * `scrollAt(t)` says where the page is scrolled at second `t`. A stepped recorder can then draw
 * frame `i` at `t = i / fps` at its own pace, so the take no longer depends on how fast the machine is.
 */
import { Journey, JourneyStep } from '../types';

export interface ScrollSegment {
  /** Seconds from the start of the take. */
  start: number;
  end: number;
  /** Scroll offsets in CSS pixels. `to` equals `from` while the page is held. */
  from: number;
  to: number;
}

export interface ScrollTimeline {
  duration: number;
  segments: ScrollSegment[];
}

/** Steps a stepped take cannot perform: they need a live, interactive page. */
const INTERACTIVE: ReadonlyArray<JourneyStep['action']> = [
  'click',
  'fill',
  'hover',
  'press',
  'navigate',
  'waitFor',
];

const DEFAULT_SCROLL_MS = 1000;

function resolveTarget(to: JourneyStep['to'], maxScroll: number): number {
  if (typeof to === 'object' && to !== null) return to.y;
  switch (to) {
    case 'top':
      return 0;
    case 'bottom':
      return maxScroll;
    case 'center':
      return maxScroll / 2;
    default:
      throw new Error(`Unknown scroll target: ${String(to)}`);
  }
}

/**
 * Build the timeline for a journey on a page whose furthest scroll offset is `maxScroll`.
 * Throws when the journey has a step that needs an interactive page.
 */
export function buildScrollTimeline(journey: Journey, maxScroll: number): ScrollTimeline {
  const limit = Math.max(0, maxScroll);
  const segments: ScrollSegment[] = [];
  let t = 0;
  let y = 0;

  journey.steps.forEach((step, index) => {
    if (INTERACTIVE.includes(step.action)) {
      throw new Error(
        `Step ${index} (${step.action}) needs an interactive page; a stepped take only pauses and scrolls`,
      );
    }
    if (step.action === 'pause') {
      const seconds = (step.durationMs ?? 0) / 1000;
      if (seconds > 0) {
        segments.push({ start: t, end: t + seconds, from: y, to: y });
        t += seconds;
      }
    } else if (step.action === 'scroll') {
      const target = Math.min(limit, Math.max(0, resolveTarget(step.to, limit)));
      const seconds = (step.durationMs ?? DEFAULT_SCROLL_MS) / 1000;
      segments.push({ start: t, end: t + seconds, from: y, to: target });
      t += seconds;
      y = target;
    }
    // cameraMark takes no time of its own in a stepped take.
  });

  return { duration: t, segments };
}

/** Ease in and out, the same curve the real-time driver scrolls with. */
export function easeInOut(p: number): number {
  return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
}

/** Scroll offset at second `t`. Clamps before the start and after the end. */
export function scrollAt(timeline: ScrollTimeline, t: number): number {
  const { segments } = timeline;
  if (segments.length === 0) return 0;
  if (t <= segments[0].start) return segments[0].from;
  for (const segment of segments) {
    if (t < segment.end) {
      const span = segment.end - segment.start;
      const p = span > 0 ? (t - segment.start) / span : 1;
      return Math.round(segment.from + (segment.to - segment.from) * easeInOut(p));
    }
  }
  return segments[segments.length - 1].to;
}

/** Number of frames a take of `duration` seconds has at `fps`. */
export function frameCount(duration: number, fps: number): number {
  return Math.max(1, Math.round(duration * fps));
}
