import { buildScrollTimeline, easeInOut, frameCount, scrollAt } from '../recorders/timeline';
import { Journey } from '../types';

const journey = (steps: Journey['steps']): Journey => ({
  meta: { name: 't', viewport: { w: 1280, h: 720 } },
  start: { url: 'https://example.test/' },
  steps,
  output: { preset: 'trailer', aspect: '16:9' },
});

describe('scroll timeline', () => {
  const tour = journey([
    { action: 'pause', durationMs: 2000 },
    { action: 'cameraMark', durationMs: 1500 },
    { action: 'scroll', to: { x: 0, y: 600 }, durationMs: 1000 },
    { action: 'pause', durationMs: 1000 },
    { action: 'scroll', to: 'bottom', durationMs: 2000 },
    { action: 'scroll', to: 'top', durationMs: 1000 },
  ]);

  it('adds up pauses and scrolls, and gives camera marks no time', () => {
    const timeline = buildScrollTimeline(tour, 3000);
    expect(timeline.duration).toBe(7);
    expect(timeline.segments).toHaveLength(5);
  });

  it('holds during a pause and lands exactly on each target', () => {
    const timeline = buildScrollTimeline(tour, 3000);
    expect(scrollAt(timeline, 0)).toBe(0);
    expect(scrollAt(timeline, 1.9)).toBe(0);
    expect(scrollAt(timeline, 3)).toBe(600);
    expect(scrollAt(timeline, 3.5)).toBe(600);
    expect(scrollAt(timeline, 6)).toBe(3000);
    expect(scrollAt(timeline, 7)).toBe(0);
    expect(scrollAt(timeline, 99)).toBe(0);
  });

  it('is halfway at the midpoint of a scroll and never overshoots', () => {
    const timeline = buildScrollTimeline(tour, 3000);
    expect(scrollAt(timeline, 2.5)).toBe(300);
    for (let t = 2; t <= 3; t += 0.05) {
      const y = scrollAt(timeline, t);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(600);
    }
  });

  it('clamps targets to the page', () => {
    const short = buildScrollTimeline(tour, 400);
    expect(scrollAt(short, 3)).toBe(400);
    expect(scrollAt(short, 6)).toBe(400);
    const tiny = buildScrollTimeline(tour, -50);
    expect(scrollAt(tiny, 6)).toBe(0);
  });

  it('is a pure function of time', () => {
    const timeline = buildScrollTimeline(tour, 3000);
    expect(scrollAt(timeline, 5.2)).toBe(scrollAt(timeline, 5.2));
  });

  it('refuses a journey that needs an interactive page', () => {
    const interactive = journey([{ action: 'click', locator: { text: 'Buy' } }]);
    expect(() => buildScrollTimeline(interactive, 1000)).toThrow(/interactive page/);
  });

  it('counts frames and eases symmetrically', () => {
    expect(frameCount(7, 30)).toBe(210);
    expect(frameCount(0, 30)).toBe(1);
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBe(0.5);
  });
});
