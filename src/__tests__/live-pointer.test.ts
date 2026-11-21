import { Landmark } from '../cinema/types';
import { pointerAt } from '../pointer/motion';
import { pickInView, planLivePointer, svgTree } from '../pointer/live';
import { OUTFIT_IDS, outfitSvg } from '../pointer/outfits';
import { PERSONAS } from '../pointer/persona';
import { ScrollTimeline } from '../recorders/timeline';

const viewport = { w: 1280, h: 720 };
const mark = (kind: Landmark['kind'], y: number, x = 400, weight?: number): Landmark => ({
  kind,
  text: kind,
  x,
  y,
  w: 300,
  h: 60,
  ...(weight === undefined ? {} : { weight }),
});

// Hold at the top, scroll to 1500, hold, scroll to the foot at 4000, hold.
const timeline: ScrollTimeline = {
  duration: 11,
  segments: [
    { start: 0, end: 2.5, from: 0, to: 0 },
    { start: 2.5, end: 4, from: 0, to: 1500 },
    { start: 4, end: 6.5, from: 1500, to: 1500 },
    { start: 6.5, end: 8, from: 1500, to: 4000 },
    { start: 8, end: 11, from: 4000, to: 4000 },
  ],
};
const landmarks = [
  mark('h1', 250),
  mark('h2', 1800),
  mark('cta', 4300, 300, 0.8),
  mark('cta', 4300, 700, 0.05),
];
const plan = (persona = PERSONAS.guide, marks = landmarks, t = timeline) =>
  planLivePointer(t, marks, { viewport, persona });

describe('the pointer on a live page', () => {
  it('is off screen while the page scrolls', () => {
    const track = plan();
    for (const t of [2.6, 3.2, 3.9, 6.6, 7.5, 7.9]) expect(pointerAt(track, t).opacity).toBe(0);
  });

  it('reads the headline in the first hold and the section in the second', () => {
    const track = plan();
    expect(pointerAt(track, 2.2)).toMatchObject({ outfit: 'text', opacity: 1 });
    expect(pointerAt(track, 2.2).y).toBeCloseTo(250 + 60 + 6, 5);
    expect(pointerAt(track, 6.2)).toMatchObject({ outfit: 'text', opacity: 1 });
    expect(pointerAt(track, 6.2).y).toBeCloseTo(1800 + 60 + 6, 5);
  });

  it('presses the primary call to action, not the faint one beside it, in the last hold', () => {
    const track = plan();
    expect(track.presses).toHaveLength(1);
    const when = track.presses[0];
    expect(when).toBeGreaterThan(8);
    expect(when).toBeLessThan(11);
    expect(pointerAt(track, when)).toMatchObject({ x: 450, y: 4330, outfit: 'press' });
  });

  it('does not press an action that is never in view during a hold', () => {
    const track = plan(PERSONAS.guide, [mark('h1', 250), mark('cta', 9000, 300, 0.8)]);
    expect(track.presses).toHaveLength(0);
  });

  it('skips holds too short to be a moment', () => {
    const brief: ScrollTimeline = {
      duration: 2.5,
      segments: [
        { start: 0, end: 1, from: 0, to: 0 },
        { start: 1, end: 2.5, from: 0, to: 1500 },
      ],
    };
    expect(plan(PERSONAS.guide, landmarks, brief).keys).toHaveLength(0);
  });

  it('a hold with nothing in view has no pointer', () => {
    const track = plan(PERSONAS.guide, [mark('h2', 1800)]);
    expect(pointerAt(track, 2).opacity).toBe(0);
    expect(pointerAt(track, 6).opacity).toBe(1);
  });

  it('enters from outside the viewport of the hold it enters, wherever that is scrolled', () => {
    const track = plan();
    const entrances = track.keys.filter((k) => k.cut);
    expect(entrances).toHaveLength(3);
    for (const k of entrances) {
      const scroll = timeline.segments.find((s) => s.start === k.t)!.from;
      const x = k.x;
      const y = k.y - scroll;
      const out = x > viewport.w || x < -track.size || y > viewport.h || y < -track.size;
      expect(out).toBe(true);
      // And it is drawn there, at full strength, the moment the hold starts: off screen.
      const pose = pointerAt(track, k.t);
      expect(pose.x).toBe(k.x);
      expect(pose.y).toBe(k.y);
    }
  });

  it('presses the hero primary, not a faint card button lower in the same view', () => {
    const hold: ScrollTimeline = {
      duration: 4,
      segments: [{ start: 0, end: 4, from: 0, to: 0 }],
    };
    const marks = [
      mark('h1', 120),
      mark('cta', 300, 200, 0.8),
      mark('cta', 520, 200, 0.12),
      mark('cta', 520, 700, 0.1),
    ];
    const track = plan(PERSONAS.guide, marks, hold);
    expect(track.presses).toHaveLength(1);
    expect(pointerAt(track, track.presses[0])).toMatchObject({ x: 350, y: 330, outfit: 'press' });
  });

  it('presses in the last hold long enough for it, at the main button in that view', () => {
    // The foot's hold is too short to press; the final hold back at the top is long enough.
    const t: ScrollTimeline = {
      duration: 10,
      segments: [
        { start: 0, end: 2.5, from: 0, to: 0 },
        { start: 2.5, end: 4, from: 0, to: 4000 },
        { start: 4, end: 5.2, from: 4000, to: 4000 },
        { start: 5.2, end: 7, from: 4000, to: 0 },
        { start: 7, end: 10, from: 0, to: 0 },
      ],
    };
    const marks = [
      mark('h1', 150),
      mark('cta', 450, 300, 0.7),
      mark('cta', 450, 700, 0.02),
      mark('cta', 4300, 300, 0.9),
    ];
    const track = plan(PERSONAS.guide, marks, t);
    expect(track.presses).toHaveLength(1);
    expect(track.presses[0]).toBeGreaterThan(7);
    expect(pointerAt(track, track.presses[0])).toMatchObject({ x: 450, y: 480, outfit: 'press' });
  });
});

describe('the main call to action in one view', () => {
  it('is the one that stands out most, wherever it sits', () => {
    expect(pickInView([mark('cta', 500, 100, 0.2), mark('cta', 300, 900, 0.9)])).toMatchObject({
      y: 300,
      x: 900,
    });
  });

  it('breaks a tie (within 0.05) by reading order: the higher row, then the leftmost', () => {
    expect(pickInView([mark('cta', 500, 100, 0.8), mark('cta', 300, 900, 0.77)])).toMatchObject({
      y: 300,
    });
    expect(pickInView([mark('cta', 300, 900, 0.8), mark('cta', 305, 100, 0.78)])).toMatchObject({
      x: 100,
    });
  });

  it('reads first when weights are missing, and is nothing when there is no button', () => {
    expect(pickInView([mark('cta', 500, 100), mark('cta', 300, 900, 0.9)])).toMatchObject({
      y: 300,
    });
    expect(pickInView([])).toBeNull();
  });
});

describe('the outfits as data for the page', () => {
  it('parses every outfit into one svg element with paths', () => {
    for (const id of OUTFIT_IDS) {
      const tree = svgTree(outfitSvg(id, 64));
      expect(tree.tag).toBe('svg');
      expect(tree.attrs).toMatchObject({ viewBox: '0 0 32 32', width: '64', 'data-outfit': id });
      const tags = JSON.stringify(tree).match(/"tag":"(\w+)"/g);
      expect(tags).toContain('"tag":"path"');
    }
    const press = svgTree(outfitSvg('press', 64));
    expect(press.children[0]).toMatchObject({ tag: 'g', attrs: { transform: 'translate(0 2)' } });
    expect(press.children[0].children[0].attrs.fill).toBe('var(--cp-fill)');
  });

  it('refuses markup it does not expect', () => {
    expect(() => svgTree('<svg>text</svg>')).toThrow();
    expect(() => svgTree('<svg><g></svg>')).toThrow();
    expect(() => svgTree('<svg></svg><svg></svg>')).toThrow();
  });
});
