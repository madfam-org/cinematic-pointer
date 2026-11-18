/**
 * Trailer catalog
 *
 * Turns the public product catalog (catalog/products.json) into one journey per trailer:
 * a landing tour for every filmable product and a pricing tour for every product whose public
 * pricing page is listed. Generation is deterministic, so `check` can fail on a missing, stale or
 * orphaned journey file.
 *
 * Generated journeys only read: they wait, scroll, mark and pause. They never click, fill or
 * navigate away, so a batch run cannot sign up, submit or buy anything.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';

import { z } from 'zod';

import { Journey, JourneyStep } from '../types';

export const CATALOG_SCHEMA = 'cinematic-pointer/catalog@1';
export const GENERATED_SUFFIX = '.cinematicpointer.json';

const PRODUCT_SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const TIER_SLUG = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

const httpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith('https://'), 'must be an https URL');

const productSchema = z
  .object({
    slug: z.string().regex(PRODUCT_SLUG),
    name: z.string().min(1),
    lifecycle: z.enum(['live', 'beta']),
    url: httpsUrl,
    tiers: z.array(z.string().regex(TIER_SLUG)),
    pricing_url: httpsUrl.optional(),
  })
  .strict();

const catalogSchema = z
  .object({
    schema: z.literal(CATALOG_SCHEMA),
    source: z.string(),
    source_last_updated: z.string(),
    products: z.array(productSchema).min(1),
    skipped: z.array(z.object({ slug: z.string(), reason: z.string() }).strict()),
  })
  .strict();

export type CatalogProduct = z.infer<typeof productSchema>;
export type Catalog = z.infer<typeof catalogSchema>;

export type TrailerKind = 'landing' | 'pricing';

export interface Trailer {
  /** `<product>.<kind>`, e.g. `dhanam.pricing`. */
  id: string;
  product: string;
  /** The product's display name, for title cards. */
  name: string;
  kind: TrailerKind;
  /** `<product>__<tier>` for every tier the trailer covers (pricing trailers only). */
  skus: string[];
  journey: Journey;
}

/** Parse and validate a catalog. Throws on any shape error or duplicate slug. */
export function parseCatalog(raw: unknown): Catalog {
  const catalog = catalogSchema.parse(raw);
  const seen = new Set<string>();
  for (const product of catalog.products) {
    if (seen.has(product.slug)) {
      throw new Error(`Duplicate product slug in catalog: ${product.slug}`);
    }
    seen.add(product.slug);
  }
  return catalog;
}

export async function loadCatalog(catalogPath: string): Promise<Catalog> {
  return parseCatalog(JSON.parse(await readFile(catalogPath, 'utf-8')));
}

const VIEWPORT = { w: 1920, h: 1080 };

/** A read-only tour: settle, then travel down the page in viewport-sized moves and return. */
function tourSteps(opening: string, closing: string, moves: number): JourneyStep[] {
  const steps: JourneyStep[] = [
    { comment: opening, action: 'pause', durationMs: 2500 },
    { action: 'cameraMark', cinema: { zoom: 1.15, beat: 'smooth' }, durationMs: 1500 },
  ];
  for (let i = 1; i <= moves; i++) {
    steps.push({
      action: 'scroll',
      to: { x: 0, y: Math.round(VIEWPORT.h * 0.85 * i) },
      durationMs: 1400,
    });
    steps.push({ action: 'pause', durationMs: 1600 });
  }
  steps.push({ action: 'scroll', to: 'bottom', durationMs: 1600 });
  steps.push({ action: 'pause', durationMs: 1200 });
  steps.push({ action: 'scroll', to: 'top', durationMs: 1800 });
  steps.push({ comment: closing, action: 'pause', durationMs: 2500 });
  return steps;
}

function hostOf(url: string): string {
  return new URL(url).host;
}

/** Build every trailer the catalog calls for, sorted by id. */
export function buildTrailers(catalog: Catalog): Trailer[] {
  const trailers: Trailer[] = [];

  for (const product of catalog.products) {
    trailers.push({
      id: `${product.slug}.landing`,
      product: product.slug,
      name: product.name,
      kind: 'landing',
      skus: [],
      journey: {
        meta: {
          name: `${product.slug}.landing`,
          description: `Landing trailer for ${product.name}`,
          viewport: VIEWPORT,
        },
        start: { url: product.url },
        steps: tourSteps(product.name, hostOf(product.url), 4),
        output: { preset: 'trailer', aspect: '16:9', captions: true },
      },
    });

    if (product.pricing_url) {
      trailers.push({
        id: `${product.slug}.pricing`,
        product: product.slug,
        name: product.name,
        kind: 'pricing',
        skus: product.tiers.map((tier) => `${product.slug}__${tier}`),
        journey: {
          meta: {
            name: `${product.slug}.pricing`,
            description: `Pricing trailer for ${product.name}`,
            viewport: VIEWPORT,
          },
          start: { url: product.pricing_url },
          // The page is filmed as published. No caption restates a price.
          steps: tourSteps(product.name, hostOf(product.pricing_url), 2),
          output: { preset: 'teaser', aspect: '16:9', captions: true },
        },
      });
    }
  }

  return trailers.sort((a, b) => a.id.localeCompare(b.id));
}

export function trailerFileName(trailer: Trailer): string {
  return `${trailer.id}${GENERATED_SUFFIX}`;
}

export function serializeJourney(journey: Journey): string {
  return JSON.stringify(journey, null, 2) + '\n';
}

export interface CatalogDrift {
  missing: string[];
  stale: string[];
  orphaned: string[];
}

export interface CatalogCheck extends CatalogDrift {
  trailers: number;
  products: number;
  skus: number;
  ok: boolean;
}

async function listGenerated(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(GENERATED_SUFFIX)).sort();
  } catch {
    return [];
  }
}

/** Compare the generated directory with what the catalog calls for. Writes nothing. */
export async function checkGenerated(catalog: Catalog, dir: string): Promise<CatalogCheck> {
  const trailers = buildTrailers(catalog);
  const expected = new Map(trailers.map((t) => [trailerFileName(t), serializeJourney(t.journey)]));
  const present = await listGenerated(dir);

  const missing: string[] = [];
  const stale: string[] = [];
  for (const [file, text] of expected) {
    if (!present.includes(file)) {
      missing.push(file);
    } else if ((await readFile(path.join(dir, file), 'utf-8')) !== text) {
      stale.push(file);
    }
  }
  const orphaned = present.filter((f) => !expected.has(f));

  return {
    trailers: trailers.length,
    products: catalog.products.length,
    skus: catalog.products.reduce((n, p) => n + p.tiers.length, 0),
    missing,
    stale,
    orphaned,
    ok: missing.length === 0 && stale.length === 0 && orphaned.length === 0,
  };
}

/** Write every generated journey and remove orphans. Returns the post-write check. */
export async function writeGenerated(catalog: Catalog, dir: string): Promise<CatalogCheck> {
  await mkdir(dir, { recursive: true });
  const before = await checkGenerated(catalog, dir);
  for (const trailer of buildTrailers(catalog)) {
    await writeFile(path.join(dir, trailerFileName(trailer)), serializeJourney(trailer.journey));
  }
  for (const file of before.orphaned) {
    await rm(path.join(dir, file));
  }
  return checkGenerated(catalog, dir);
}

/** Select trailers whose id matches the filter (a regular expression). No filter selects all. */
export function selectTrailers(trailers: Trailer[], filter?: string): Trailer[] {
  if (!filter) return trailers;
  const re = new RegExp(filter);
  return trailers.filter((t) => re.test(t.id));
}
