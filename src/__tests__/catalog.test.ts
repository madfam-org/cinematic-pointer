import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  buildTrailers,
  CATALOG_SCHEMA,
  checkGenerated,
  parseCatalog,
  selectTrailers,
  trailerFileName,
  writeGenerated,
} from '../catalog';
import {
  exitCodeFor,
  parseAspects,
  parseViewport,
  ProduceResults,
  RESULTS_SCHEMA,
} from '../catalog/results';
import { validateJourney } from '../utils/validation';

const raw = () => ({
  schema: CATALOG_SCHEMA,
  source: 'test',
  source_last_updated: '2026-01-01',
  products: [
    {
      slug: 'alpha-app',
      name: 'Alpha',
      lifecycle: 'live',
      url: 'https://alpha.example/',
      tiers: ['free', 'pro_plus'],
      pricing_url: 'https://alpha.example/pricing',
    },
    { slug: 'beta', name: 'Beta', lifecycle: 'beta', url: 'https://beta.example/', tiers: [] },
  ],
  skipped: [{ slug: 'gamma', reason: 'lifecycle incubating' }],
});

describe('catalog', () => {
  describe('parseCatalog', () => {
    it('accepts a well-formed catalog', () => {
      expect(parseCatalog(raw()).products).toHaveLength(2);
    });

    it('rejects an empty product list', () => {
      expect(() => parseCatalog({ ...raw(), products: [] })).toThrow();
    });

    it('rejects an unknown schema', () => {
      expect(() => parseCatalog({ ...raw(), schema: 'other@1' })).toThrow();
    });

    it('rejects an underscore product slug and a hyphenated tier', () => {
      const bad = raw();
      bad.products[0].slug = 'alpha_app';
      expect(() => parseCatalog(bad)).toThrow();
      const badTier = raw();
      badTier.products[0].tiers = ['pro-plus'];
      expect(() => parseCatalog(badTier)).toThrow();
    });

    it('rejects a non-https URL and an unknown key', () => {
      const bad = raw();
      bad.products[0].url = 'http://alpha.example/';
      expect(() => parseCatalog(bad)).toThrow();
      expect(() => parseCatalog({ ...raw(), notes: 'private' })).toThrow();
    });

    it('rejects a duplicate slug', () => {
      const bad = raw();
      bad.products[1].slug = 'alpha-app';
      expect(() => parseCatalog(bad)).toThrow(/Duplicate/);
    });
  });

  describe('buildTrailers', () => {
    const trailers = buildTrailers(parseCatalog(raw()));

    it('builds a landing trailer per product and a pricing trailer per listed page', () => {
      expect(trailers.map((t) => t.id)).toEqual([
        'alpha-app.landing',
        'alpha-app.pricing',
        'beta.landing',
      ]);
    });

    it('names SKUs as <product>__<tier> on the pricing trailer only', () => {
      expect(trailers[1].skus).toEqual(['alpha-app__free', 'alpha-app__pro_plus']);
      expect(trailers[0].skus).toEqual([]);
    });

    it('generates journeys that only read the page', () => {
      const readOnly = ['pause', 'scroll', 'cameraMark', 'waitFor'];
      for (const trailer of trailers) {
        expect(trailer.journey.steps.length).toBeGreaterThan(4);
        for (const step of trailer.journey.steps) {
          expect(readOnly).toContain(step.action);
        }
      }
    });

    it('generates journeys the validator accepts', () => {
      for (const trailer of trailers) {
        expect(() => validateJourney(trailer.journey)).not.toThrow();
      }
    });

    it('never writes a digit-bearing caption on a pricing trailer', () => {
      for (const step of trailers[1].journey.steps) {
        if (step.comment) expect(step.comment).not.toMatch(/\d/);
      }
    });

    it('filters by id', () => {
      expect(selectTrailers(trailers, '^alpha-app\\.').map((t) => t.id)).toHaveLength(2);
      expect(selectTrailers(trailers, 'pricing$')).toHaveLength(1);
      expect(selectTrailers(trailers, 'nothing')).toHaveLength(0);
      expect(selectTrailers(trailers)).toHaveLength(3);
    });
  });

  describe('generated files', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(path.join(os.tmpdir(), 'cp-catalog-'));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('reports everything missing in an empty directory', async () => {
      const check = await checkGenerated(parseCatalog(raw()), dir);
      expect(check.ok).toBe(false);
      expect(check.missing).toHaveLength(3);
      expect(check).toMatchObject({ products: 2, skus: 2, trailers: 3 });
    });

    it('writes, then checks clean, then detects stale and orphaned files', async () => {
      const catalog = parseCatalog(raw());
      expect((await writeGenerated(catalog, dir)).ok).toBe(true);

      const first = trailerFileName(buildTrailers(catalog)[0]);
      await writeFile(path.join(dir, first), '{}\n');
      await writeFile(path.join(dir, 'gone.landing.cinematicpointer.json'), '{}\n');
      const drift = await checkGenerated(catalog, dir);
      expect(drift.ok).toBe(false);
      expect(drift.stale).toEqual([first]);
      expect(drift.orphaned).toEqual(['gone.landing.cinematicpointer.json']);

      const repaired = await writeGenerated(catalog, dir);
      expect(repaired.ok).toBe(true);
      expect(JSON.parse(await readFile(path.join(dir, first), 'utf-8')).meta.name).toBe(
        'alpha-app.landing',
      );
    });
  });
});

describe('produce results', () => {
  const results = (selected: number, rendered: number, failed: number): ProduceResults => ({
    schema: RESULTS_SCHEMA,
    catalog_source_last_updated: '2026-01-01',
    selected,
    rendered,
    failed,
    trailers: [],
  });

  it('exits 0 only when everything selected rendered', () => {
    expect(exitCodeFor(results(3, 3, 0))).toBe(0);
  });

  it('exits 2 when nothing was selected: an empty read is not a clean run', () => {
    expect(exitCodeFor(results(0, 0, 0))).toBe(2);
  });

  it('exits 1 on a failure or an unaccounted trailer', () => {
    expect(exitCodeFor(results(3, 2, 1))).toBe(1);
    expect(exitCodeFor(results(3, 2, 0))).toBe(1);
  });

  it('always renders 16:9 first and rejects unknown aspects', () => {
    expect(parseAspects('9:16')).toEqual(['16:9', '9:16']);
    expect(parseAspects('16:9, 1:1,9:16')).toEqual(['16:9', '1:1', '9:16']);
    expect(() => parseAspects('3:2')).toThrow(/Unknown aspect/);
    expect(() => parseAspects(' , ')).toThrow(/At least one/);
  });

  it('parses a viewport override and rejects nonsense', () => {
    expect(parseViewport('1280x720')).toEqual({ w: 1280, h: 720 });
    expect(() => parseViewport('1280')).toThrow(/must look like/);
    expect(() => parseViewport('100x100')).toThrow(/outside/);
    expect(() => parseViewport('9999x9999')).toThrow(/outside/);
  });
});
