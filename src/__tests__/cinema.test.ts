import { cueSource, scoreArgs, scoreCues } from '../cinema/score';
import { direct, pickMontage } from '../cinema/screenplay';
import { buildStageHtml } from '../cinema/stage';
import { Landmark, PageCapture } from '../cinema/types';
import { tileGrid } from '../cinema/tiles';
import { stageFilters, subFrameTime, takeQuality } from '../recorders/stage';

const mark = (kind: Landmark['kind'], y: number, text = kind): Landmark => ({
  kind,
  text,
  x: 400,
  y,
  w: 640,
  h: 60,
});

const capture = (landmarks: Landmark[], height = 6000): PageCapture => ({
  url: 'https://example.test/',
  title: 'Example',
  width: 1440,
  height,
  image: 'page.png',
  background: 'rgb(255, 255, 255)',
  landmarks,
});

const frame = { w: 1280, h: 720 };
const full = capture([
  mark('h1', 300),
  mark('cta', 520),
  mark('h2', 1400),
  mark('h2', 1500),
  mark('h2', 2600),
  mark('h2', 3700),
  mark('h2', 4600),
  mark('h2', 5300),
  mark('cta', 5600),
]);

describe('auto-director', () => {
  const play = direct(full, { frame, name: 'Example', tagline: 'example.test' });

  it('opens on a title card and closes on an end card with the tagline', () => {
    expect(play.shots[0].name).toBe('title');
    expect(play.shots[0].title).toEqual({ text: 'Example' });
    const end = play.shots[play.shots.length - 1];
    expect(end.name).toBe('end');
    expect(end.title).toEqual({ text: 'Example', sub: 'example.test' });
  });

  it('lays shots end to end with no gap or overlap', () => {
    let t = 0;
    for (const shot of play.shots) {
      expect(shot.start).toBeCloseTo(t, 6);
      expect(shot.duration).toBeGreaterThan(0);
      t += shot.duration;
    }
    expect(play.duration).toBeCloseTo(t, 3);
  });

  it('settles the hero shot on the headline', () => {
    const hero = play.shots.find((s) => s.name === 'hero')!;
    expect(hero.to.cx).toBe(720);
    expect(hero.to.cy).toBe(330);
    expect(hero.to.scale).toBeGreaterThan(hero.from.scale);
    expect(Math.abs(hero.to.rx)).toBeLessThan(Math.abs(hero.from.rx));
  });

  it('visits at most four sections, never two that are close together', () => {
    const montage = play.shots.filter((s) => s.name.startsWith('montage'));
    expect(montage.length).toBeGreaterThan(1);
    expect(montage.length).toBeLessThanOrEqual(4);
    const picked = pickMontage(full, frame.h, (frame.w / full.width) * 1.15, 4);
    for (let i = 1; i < picked.length; i++) {
      expect(picked[i].y - picked[i - 1].y).toBeGreaterThan(500);
    }
  });

  it('closes on the last call to action', () => {
    const close = play.shots.find((s) => s.name === 'close')!;
    expect(close.to.cy).toBe(5630);
    expect(close.to.rx).toBe(0);
  });

  it('keeps every camera target on the page', () => {
    for (const shot of play.shots) {
      for (const cam of [shot.from, shot.to]) {
        expect(cam.cy).toBeGreaterThanOrEqual(0);
        expect(cam.cy).toBeLessThanOrEqual(full.height);
        expect(cam.scale).toBeGreaterThan(0);
        expect(cam.light).toBeGreaterThan(0);
      }
    }
  });

  it('still makes a trailer from a page with no landmarks', () => {
    const bare = direct(capture([], 900), { frame, name: 'Bare' });
    expect(bare.shots.map((s) => s.name)).toEqual(['title', 'hero', 'close', 'end']);
    expect(bare.duration).toBeGreaterThan(8);
  });

  it('is deterministic', () => {
    const again = direct(full, { frame, name: 'Example', tagline: 'example.test' });
    expect(JSON.stringify(again)).toBe(JSON.stringify(play));
  });
});

describe('stage document', () => {
  const play = direct(full, { frame, name: 'Ex<ample', tagline: 'example.test' });
  const html = buildStageHtml({ ...full, title: 'A <b>title</b>' }, play, { letterbox: 2.39 });

  it('implements the stage contract', () => {
    expect(html).toContain('window.__stage = {');
    expect(html).toContain('ready: ready');
    expect(html).toContain('duration: play.duration');
    expect(html).toContain('seek: function (t)');
  });

  it('reads no clock and uses no unseeded randomness', () => {
    expect(html).not.toMatch(/Math\.random|Date\.now|performance\.now|new Date/);
  });

  it('escapes page text and cannot be broken out of by a title', () => {
    expect(html).toContain('A &lt;b&gt;title&lt;/b&gt;');
    expect(html).not.toContain('"Ex<ample"');
    expect(html).toContain('Ex\\u003cample');
  });

  it('letterboxes a 16:9 frame to 2.39:1', () => {
    expect(html).toContain('height: 92px; background: #000;');
  });
});

describe('stage filters', () => {
  it('blends sub-frames back to the output cadence', () => {
    expect(stageFilters(24, 3, false)).toBe("tmix=frames=3:weights='1 1 1',fps=24,format=yuv420p");
  });

  it('skips the blend with a single sub-frame and grades when asked', () => {
    expect(stageFilters(24, 1, false)).toBe('format=yuv420p');
    expect(stageFilters(24, 1, true)).toContain('colorbalance=');
  });
});

describe('score', () => {
  const play = direct(full, { frame, name: 'Example', tagline: 'example.test' });
  const cues = scoreCues(play);

  it('runs a drone under the whole trailer', () => {
    const drone = cues.find((c) => c.kind === 'drone')!;
    expect(drone.at).toBe(0);
    expect(drone.duration).toBe(play.duration);
  });

  it('lands the riser exactly on the cut to the close', () => {
    const riser = cues.find((c) => c.kind === 'riser')!;
    const close = play.shots.find((s) => s.name === 'close')!;
    expect(riser.at + riser.duration).toBeCloseTo(close.start, 6);
  });

  it('hits every montage cut and never starts before zero or runs past the end', () => {
    const montage = play.shots.filter((s) => s.name.startsWith('montage'));
    for (const shot of montage) {
      expect(cues.some((c) => c.kind === 'hit' && c.at === shot.start)).toBe(true);
    }
    for (const cue of cues) {
      expect(cue.at).toBeGreaterThanOrEqual(0);
      expect(cue.at).toBeLessThan(play.duration);
      expect(cue.duration).toBeGreaterThan(0);
    }
  });

  it('scores a page with no montage without a riser or pulse', () => {
    const bare = scoreCues(direct(capture([], 900), { frame, name: 'Bare' }));
    expect(bare.some((c) => c.kind === 'riser' || c.kind === 'pulse')).toBe(false);
    expect(bare.some((c) => c.kind === 'boom')).toBe(true);
  });

  it('keeps commas out of every generator expression', () => {
    for (const cue of cues) {
      const expression = cueSource(cue).match(/aevalsrc='([^']*)'/);
      if (expression) expect(expression[1]).not.toContain(',');
    }
  });

  it('builds one input per cue and trims the mix to the trailer length', () => {
    const args = scoreArgs(cues, play.duration, 'score.wav');
    expect(args.filter((a) => a === 'lavfi')).toHaveLength(cues.length);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain(`amix=inputs=${cues.length}:normalize=0`);
    expect(graph).toContain(`atrim=0:${play.duration}`);
    expect(args[args.length - 1]).toBe('score.wav');
    expect(() => scoreArgs([], 1, 'x.wav')).toThrow();
  });

  it('is deterministic', () => {
    expect(JSON.stringify(scoreCues(play))).toBe(JSON.stringify(cues));
  });
});

describe('shutter', () => {
  it('opens each frame at its own time', () => {
    expect(subFrameTime(0, 24, 5)).toBe(0);
    expect(subFrameTime(5, 24, 5)).toBeCloseTo(1 / 24, 9);
    expect(subFrameTime(240, 24, 5)).toBeCloseTo(2, 9);
  });

  it('packs sub-frames into the first half of the frame interval', () => {
    const last = subFrameTime(4, 24, 5);
    expect(last).toBeGreaterThan(0);
    expect(last).toBeLessThan(0.5 / 24);
    for (let i = 1; i < 20; i++) {
      expect(subFrameTime(i, 24, 5)).toBeGreaterThan(subFrameTime(i - 1, 24, 5));
    }
  });

  it('is plain frame time with a single sub-frame', () => {
    expect(subFrameTime(48, 24, 1)).toBe(2);
  });
});

describe('take quality', () => {
  it('a full take uses the five sub-frame shutter and says so', () => {
    const full = takeQuality(false);
    expect(full.shutter).toBe(5);
    expect(full.note).toMatch(/^full/);
  });

  it('a draft draws one picture per frame and is never labelled finished', () => {
    const draft = takeQuality(true);
    expect(draft.shutter).toBe(1);
    expect(draft.note).toMatch(/^draft/);
    expect(draft.note).toContain('not a finished take');
    expect(stageFilters(24, draft.shutter, true)).not.toContain('tmix');
  });
});

describe('page tiles', () => {
  it('covers the page exactly, with no gap, overlap or padding', () => {
    const tiles = tileGrid(1440, 5000, 2048);
    expect(tiles.map((t) => t.file)).toEqual([
      'tile-r000-c000.png',
      'tile-r001-c000.png',
      'tile-r002-c000.png',
    ]);
    expect(tiles.map((t) => [t.x, t.y, t.w, t.h])).toEqual([
      [0, 0, 1440, 2048],
      [0, 2048, 1440, 2048],
      [0, 4096, 1440, 904],
    ]);
    expect(tiles.reduce((sum, t) => sum + t.w * t.h, 0)).toBe(1440 * 5000);
  });

  it('uses several columns when the page is wider than a tile', () => {
    const tiles = tileGrid(2500, 1000, 1024);
    expect(tiles).toHaveLength(3);
    expect(tiles[2]).toMatchObject({ col: 2, row: 0, x: 2048, w: 452, h: 1000 });
  });

  it('a page that fits one tile is one tile of its own size', () => {
    expect(tileGrid(800, 600, 2048)).toEqual([
      { col: 0, row: 0, x: 0, y: 0, w: 800, h: 600, file: 'tile-r000-c000.png' },
    ]);
  });

  it('rejects sizes that are not positive whole numbers', () => {
    expect(() => tileGrid(0, 100, 256)).toThrow('width');
    expect(() => tileGrid(100, 100.5, 256)).toThrow('height');
    expect(() => tileGrid(100, 100, -1)).toThrow('tileSize');
  });
});
