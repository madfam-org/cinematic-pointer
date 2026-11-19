import { buildTour, cameraAt, layoutPanels, TourInput } from '../tour/layout';
import { buildTourStageHtml, RUNTIME_SOURCE } from '../tour/stage';

function capture(slug: string, layer: TourInput['layer'], height = 7712): TourInput {
  const tiles = [];
  for (let y = 0, row = 0; y < height; y += 2048, row++) {
    tiles.push({
      file: `../captures/${slug}/tile-r00${row}-c000.png`,
      x: 0,
      y,
      w: 1440,
      h: Math.min(2048, height - y),
    });
  }
  return { slug, name: slug.toUpperCase(), layer, width: 1440, height, tiles, background: '#fff' };
}

const ESTATE = [
  capture('karafiel', 'fruit'),
  capture('enclii', 'soil'),
  capture('janua', 'roots', 900),
  capture('dhanam', 'fruit', 3000),
];

describe('tour layout', () => {
  it('puts one row per layer, soil lowest, and sorts a row by slug', () => {
    const panels = layoutPanels(ESTATE);
    const y = (slug: string) => panels.find((p) => p.slug === slug)!.top.y;

    expect(panels.map((p) => p.slug)).toEqual(['enclii', 'janua', 'dhanam', 'karafiel']);
    expect(y('enclii')).toBeLessThan(y('janua'));
    expect(y('janua')).toBeLessThan(y('dhanam'));
    expect(y('dhanam')).toBe(y('karafiel'));
    const [dhanam, karafiel] = ['dhanam', 'karafiel'].map((s) => panels.find((p) => p.slug === s)!);
    expect(dhanam.top.x).toBeLessThan(karafiel.top.x);
    expect(dhanam.top.x + karafiel.top.x).toBeCloseTo(0, 9); // the row is centred
  });

  it('keeps the page in proportion and cuts a page that is too tall, saying so', () => {
    const panels = layoutPanels(ESTATE, { panelWidth: 4, maxAspect: 4 });
    const janua = panels.find((p) => p.slug === 'janua')!;
    const enclii = panels.find((p) => p.slug === 'enclii')!;

    expect(janua.height).toBeCloseTo((900 / 1440) * 4, 9);
    expect(janua.cropped).toBe(false);
    expect(enclii.height).toBe(16);
    expect(enclii.cropped).toBe(true);
    // 7712 px at 4/1440 units per px is 21.4 units: the tile that starts below 16 is dropped.
    expect(enclii.tiles).toHaveLength(3);
    expect(enclii.tiles[2].down + enclii.tiles[2].height).toBeGreaterThan(16);
  });

  it('a product with no layer still gets a place', () => {
    const panels = layoutPanels([capture('enclii', 'soil'), capture('mystery', undefined)]);
    expect(panels.find((p) => p.slug === 'mystery')!.layer).toBe('other');
  });

  it('refuses a capture with no size', () => {
    expect(() => layoutPanels([{ ...capture('x', 'soil'), height: 0 }])).toThrow('needs a size');
  });
});

describe('tour camera', () => {
  const tour = buildTour(ESTATE, { frameAspect: 16 / 9 });

  it('visits every product once, in layout order, between an opening and a closing shot', () => {
    expect(tour.shots[0].kind).toBe('establish');
    expect(tour.shots[tour.shots.length - 1].kind).toBe('depart');
    const visits = tour.shots.filter((s) => s.kind === 'approach').map((s) => s.slug);
    expect(visits).toEqual(tour.panels.map((p) => p.slug));
    expect(tour.shots.filter((s) => s.kind === 'descend')).toHaveLength(tour.panels.length);
  });

  it('shots follow one another without a gap and end at the duration', () => {
    tour.shots.forEach((shot, i) => {
      expect(shot.end).toBeGreaterThan(shot.start);
      if (i > 0) expect(shot.start).toBeCloseTo(tour.shots[i - 1].end, 9);
    });
    expect(tour.shots[tour.shots.length - 1].end).toBeCloseTo(tour.duration, 9);
  });

  it('is in front of each panel, looking at it, when its approach ends', () => {
    for (const panel of tour.panels) {
      const approach = tour.shots.find((s) => s.kind === 'approach' && s.slug === panel.slug)!;
      const sample = tour.samples[Math.round(approach.end * tour.sampleRate)];
      // Within a sample of the key: the shot's end need not fall exactly on a sample.
      expect(Math.abs(sample.position.x - panel.top.x)).toBeLessThan(0.05);
      expect(Math.abs(sample.target.x - panel.top.x)).toBeLessThan(0.05);
      expect(sample.position.z).toBeGreaterThan(0);
      expect(sample.position.y).toBeLessThan(panel.top.y);
    }
  });

  it('glides down a tall page and ends the glide lower than it began', () => {
    const descend = tour.shots.find((s) => s.kind === 'descend' && s.slug === 'enclii')!;
    const start = tour.samples[Math.round(descend.start * tour.sampleRate)];
    const end = tour.samples[Math.round(descend.end * tour.sampleRate)];
    expect(end.position.y).toBeLessThan(start.position.y - 5);
    // A longer page takes longer to read.
    const short = tour.shots.find((s) => s.kind === 'descend' && s.slug === 'janua')!;
    expect(descend.end - descend.start).toBeGreaterThan(short.end - short.start);
  });

  it('samples cover the whole duration and never jump', () => {
    expect(tour.samples).toHaveLength(Math.round(tour.duration * tour.sampleRate) + 1);
    let largest = 0;
    for (let i = 1; i < tour.samples.length; i++) {
      const a = tour.samples[i - 1].position;
      const b = tour.samples[i].position;
      largest = Math.max(largest, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    }
    // No more than a fraction of a panel width between two samples a 60th of a second apart.
    expect(largest).toBeLessThan(1.5);
  });

  it('never goes closer to a page than its reading distance, or behind it', () => {
    // A curve through the keys once overshot on the way in and put the camera inside the page.
    const reading = Math.min(...tour.samples.map((s) => s.position.z));
    const atPanels = tour.shots
      .filter((s) => s.kind === 'descend')
      .map((s) => tour.samples[Math.round(s.start * tour.sampleRate)].position.z);
    expect(reading).toBeGreaterThan(0);
    expect(reading).toBeGreaterThanOrEqual(Math.min(...atPanels) * 0.95);
  });

  it('the same inputs in any order give the same tour', () => {
    const again = buildTour([...ESTATE].reverse(), { frameAspect: 16 / 9 });
    expect(JSON.stringify(again)).toBe(JSON.stringify(tour));
  });

  it('holds still before the first key and after the last', () => {
    const keys = [
      { t: 1, position: { x: 0, y: 0, z: 5 }, target: { x: 0, y: 0, z: 0 } },
      { t: 2, position: { x: 4, y: 0, z: 5 }, target: { x: 4, y: 0, z: 0 } },
    ];
    expect(cameraAt(keys, 0).position.x).toBe(0);
    expect(cameraAt(keys, 9).position.x).toBe(4);
    expect(cameraAt(keys, 1.5).position.x).toBeCloseTo(2, 9);
  });

  it('needs at least one capture', () => {
    expect(() => buildTour([])).toThrow('at least one capture');
  });
});

describe('tour stage document', () => {
  it('implements the stage contract and carries its own three.js', async () => {
    const html = await buildTourStageHtml(buildTour([capture('enclii', 'soil')]));

    expect(html).toContain('window.__stage');
    expect(html).toContain('window.__tour = ');
    expect(html).toContain('WebGLRenderer');
    // Self-contained: nothing is fetched from a network.
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)[a-z0-9.-]+\/[^"'\s]*\.js/i);
    expect(html.length).toBeGreaterThan(300000);
  }, 60000);

  it('reads no clock and uses no randomness of its own', () => {
    for (const banned of [
      'Date.now',
      'performance.now',
      'Math.random',
      'requestAnimationFrame',
      'setTimeout',
    ]) {
      expect(RUNTIME_SOURCE).not.toContain(banned);
    }
  });

  it('a product name cannot break out of the script it is embedded in', async () => {
    const hostile = { ...capture('enclii', 'soil'), name: '</script><script>alert(1)</script>' };
    const html = await buildTourStageHtml(buildTour([hostile]));

    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(html).not.toContain('<script>alert(1)');
  }, 60000);
});
