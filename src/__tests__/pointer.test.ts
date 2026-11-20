import { direct } from '../cinema/screenplay';
import { buildStageHtml } from '../cinema/stage';
import { Landmark, PageCapture } from '../cinema/types';
import { pointerAt, PointerTrack, PRESS_SECONDS, RING_SECONDS } from '../pointer/motion';
import { OUTFIT_IDS, OUTFITS, outfitSvg } from '../pointer/outfits';
import { loadPersona, parsePersona, PERSONAS, POINTER_STATES } from '../pointer/persona';

const mark = (kind: Landmark['kind'], y: number): Landmark => ({
  kind,
  text: kind,
  x: 400,
  y,
  w: 640,
  h: 60,
});

const capture = (landmarks: Landmark[]): PageCapture => ({
  url: 'https://example.test/',
  title: 'Example',
  width: 1440,
  height: 6000,
  image: 'page.png',
  background: 'rgb(255, 255, 255)',
  landmarks,
});

const frame = { w: 1280, h: 720 };
const page = capture([mark('h1', 300), mark('h2', 1400), mark('h2', 2600), mark('cta', 5600)]);
const play = (persona = PERSONAS.guide, source = page) =>
  direct(source, { frame, name: 'Example', persona });
const shot = (p: ReturnType<typeof direct>, name: string) => p.shots.find((s) => s.name === name)!;

describe('outfits', () => {
  it('every outfit has a hotspot on the grid and takes its colours from the persona', () => {
    for (const id of OUTFIT_IDS) {
      const { hotspot, body } = OUTFITS[id];
      expect(hotspot.x).toBeGreaterThanOrEqual(0);
      expect(hotspot.x).toBeLessThanOrEqual(32);
      expect(hotspot.y).toBeGreaterThanOrEqual(0);
      expect(hotspot.y).toBeLessThanOrEqual(32);
      expect(body).toContain('var(--cp-ink)');
      expect(body).not.toMatch(/<script|href|url\(/i);
      expect(outfitSvg(id, 40)).toContain(`data-outfit="${id}"`);
    }
  });

  it('every built-in persona dresses every state in an outfit that exists', () => {
    for (const persona of Object.values(PERSONAS)) {
      for (const state of POINTER_STATES) expect(OUTFITS[persona.wardrobe[state]]).toBeDefined();
    }
  });
});

describe('persona files', () => {
  it('fills what a file leaves out and keeps what it sets', () => {
    const persona = parsePersona({ id: 'cashier', pace: 1.4, wardrobe: { travel: 'frame' } });
    expect(persona.pace).toBe(1.4);
    expect(persona.wardrobe.travel).toBe('frame');
    expect(persona.wardrobe.press).toBe('press');
    expect(persona.fill).toBe(PERSONAS.guide.fill);
  });

  it.each([
    [{ pace: 1 }, 'id'],
    [{ id: 'x', pace: 9 }, 'pace'],
    [{ id: 'x', fill: 'red;} body{display:none' }, 'fill'],
    [{ id: 'x', fill: 'url(https://example.test/a.png)' }, 'fill'],
    [{ id: 'x', wardrobe: { travel: 'sword' } }, 'unknown outfit'],
    [{ id: 'x', wardrobe: { travel: 'constructor' } }, 'unknown outfit'],
    [{ id: 'x', ring: '#12345' }, 'ring'],
    [{ id: 'x', reads: 'yes' }, 'reads'],
    [{ id: 'x', wardrobe: { dance: 'arrow' } }, 'no state'],
  ])('refuses %j', (raw, why) => {
    expect(() => parsePersona(raw)).toThrow(why);
  });
});

describe('loading a persona by name', () => {
  it('finds a built-in one and refuses names that are not personas', async () => {
    expect((await loadPersona('operator')).id).toBe('operator');
    await expect(loadPersona('nobody')).rejects.toThrow('Unknown persona');
    await expect(loadPersona('constructor')).rejects.toThrow('Unknown persona');
  });
});

describe('pointer motion', () => {
  const track: Pick<PointerTrack, 'keys' | 'presses'> = {
    keys: [
      { t: 1, x: 0, y: 0, outfit: 'arrow', show: 1, cut: true },
      { t: 2, x: 100, y: 0, outfit: 'point', show: 1, bow: 0.2 },
      { t: 3, x: 100, y: 0, outfit: 'point', show: 0 },
      { t: 4, x: 500, y: 500, outfit: 'arrow', show: 1, cut: true },
    ],
    presses: [2.2],
  };

  it('is hidden before its first key and starts and ends a move at rest on the keys', () => {
    expect(pointerAt(track, 0.5).opacity).toBe(0);
    expect(pointerAt(track, 1)).toMatchObject({ x: 0, y: 0, outfit: 'arrow', opacity: 1 });
    expect(pointerAt(track, 2)).toMatchObject({ x: 100, y: 0, outfit: 'point' });
    // Eased: a tenth of the way through the time is far less than a tenth of the way there.
    expect(pointerAt(track, 1.1).x).toBeLessThan(2);
  });

  it('bows away from the straight line mid-move and returns to it', () => {
    const mid = pointerAt(track, 1.5);
    expect(mid.x).toBeCloseTo(50, 5);
    expect(mid.y).toBeCloseTo(20, 5);
  });

  it('jumps at a cut instead of travelling, and stays hidden until the cut', () => {
    const before = pointerAt(track, 3.9);
    expect(before).toMatchObject({ x: 100, y: 0, opacity: 0 });
    expect(pointerAt(track, 4)).toMatchObject({ x: 500, y: 500, opacity: 1 });
  });

  it('fades out at the end of its last visible stretch', () => {
    expect(pointerAt(track, 2.5).opacity).toBe(1);
    expect(pointerAt(track, 2.9).opacity).toBeCloseTo(0.5, 5);
  });

  it('squashes while a press lands and leaves a ring that runs its course', () => {
    expect(pointerAt(track, 2.19).squash).toBe(1);
    expect(pointerAt(track, 2.2 + PRESS_SECONDS / 2).squash).toBeCloseTo(0.84, 5);
    const ring = pointerAt(track, 2.2 + RING_SECONDS / 2).rings;
    expect(ring).toHaveLength(1);
    expect(ring[0]).toMatchObject({ x: 100, y: 0 });
    expect(ring[0].p).toBeCloseTo(0.5, 5);
    expect(pointerAt(track, 2.2 + RING_SECONDS + 0.01).rings).toHaveLength(0);
  });

  it('is a pure function of time', () => {
    expect(pointerAt(track, 1.37)).toEqual(pointerAt(track, 1.37));
  });
});

describe('the pointer in a screenplay', () => {
  it('a screenplay with no persona has no pointer, and its stage carries none', () => {
    const plain = direct(page, { frame, name: 'Example' });
    expect(plain.pointer).toBeUndefined();
    const html = buildStageHtml(page, plain);
    for (const id of ['pointer', 'pointer-shadow', 'rings'])
      expect(html).not.toContain(`id="${id}"`);
  });

  it('stays off the title and end cards', () => {
    const p = play();
    for (const name of ['title', 'end']) {
      const s = shot(p, name);
      for (const at of [0, 0.5, 0.99]) {
        expect(pointerAt(p.pointer!, s.start + s.duration * at).opacity).toBe(0);
      }
    }
  });

  it('presses the call to action once, on it, inside the closing shot', () => {
    const p = play();
    const close = shot(p, 'close');
    expect(p.pointer!.presses).toHaveLength(1);
    const when = p.pointer!.presses[0];
    expect(when).toBeGreaterThan(close.start);
    expect(when + PRESS_SECONDS).toBeLessThan(close.start + close.duration);
    const pose = pointerAt(p.pointer!, when);
    expect(pose).toMatchObject({ x: 720, y: 5630, outfit: 'press', opacity: 1 });
    expect(pointerAt(p.pointer!, when - 0.05).outfit).toBe('point');
  });

  it('reads along the headline when the persona reads, and only looks when it does not', () => {
    const reader = play(PERSONAS.guide);
    const hero = shot(reader, 'hero');
    const late = hero.start + hero.duration * 0.8;
    expect(pointerAt(reader.pointer!, late).outfit).toBe('text');
    const doer = play(PERSONAS.operator);
    expect(pointerAt(doer.pointer!, late).outfit).toBe('inspect');
  });

  it('a decisive persona arrives and presses sooner than a careful one', () => {
    const fast = play(PERSONAS.operator).pointer!;
    const slow = play(PERSONAS.analyst).pointer!;
    expect(fast.presses[0]).toBeLessThan(slow.presses[0]);
  });

  it('does not press when the page has no call to action', () => {
    const p = play(PERSONAS.guide, capture([mark('h1', 300), mark('h2', 1400)]));
    expect(p.pointer!.presses).toHaveLength(0);
  });

  it('keys run forward in time and the track is the same on every run', () => {
    const keys = play().pointer!.keys;
    for (let i = 1; i < keys.length; i++) expect(keys[i].t).toBeGreaterThanOrEqual(keys[i - 1].t);
    expect(JSON.stringify(play())).toBe(JSON.stringify(play()));
  });

  it('sizes the pointer against the frame and puts every outfit in the stage', () => {
    const wide = direct(page, {
      frame: { w: 1920, h: 1080 },
      name: 'Example',
      persona: PERSONAS.guide,
    });
    expect(wide.pointer!.size).toBe(96);
    const html = buildStageHtml(page, wide);
    expect(html).toContain('id="pointer"');
    expect(html).toContain('id="pointer-shadow"');
    expect(html).toContain('id="rings"');
    for (const id of OUTFIT_IDS) expect(html).toContain(`<div data-outfit="${id}"`);
  });

  it('across the whole range of manners, keys run forward and the press lands inside the close', () => {
    for (const pace of [0.5, 1, 2]) {
      for (const hesitation of [0, 0.4, 1.5]) {
        for (const bow of [-0.4, 0.4]) {
          const p = play({ ...PERSONAS.guide, pace, hesitation, bow });
          const keys = p.pointer!.keys;
          for (let i = 1; i < keys.length; i++) {
            expect(keys[i].t).toBeGreaterThanOrEqual(keys[i - 1].t);
          }
          const close = shot(p, 'close');
          expect(p.pointer!.presses).toHaveLength(1);
          const when = p.pointer!.presses[0];
          expect(when).toBeGreaterThanOrEqual(close.start);
          expect(when + RING_SECONDS).toBeLessThan(close.start + close.duration);
          expect(pointerAt(p.pointer!, when).outfit).toBe('press');
        }
      }
    }
  });

  it('enters each shot from outside the frame', () => {
    const p = play();
    const hero = shot(p, 'hero');
    const first = p.pointer!.keys.find((k) => k.t === hero.start)!;
    expect(Math.abs(first.x - 720)).toBeGreaterThan(page.width / 2);
  });

  it('refuses a colour that is not a colour, however the track was made', () => {
    const p = play();
    p.pointer!.ring = 'red;} body{display:none';
    expect(() => buildStageHtml(page, p)).toThrow('colour');
  });
});
