#!/usr/bin/env node
/* global process, console */
/**
 * Refresh catalog/products.json from MADFAM's public product projection.
 *
 *   node scripts/refresh-catalog.mjs <path/to/projection.public.json> [--check]
 *
 * The projection is the public-safe export of the product registry (private fields are stripped
 * upstream by allow-list). This script keeps only what a trailer needs: a slug, a display name, the
 * public landing URL and the tier slugs. A product is filmed only when it is live or beta AND has a
 * public primary host; everything else is listed under `skipped` with the reason, so "not filmed" is
 * never silent.
 *
 * Fail-closed: an unreadable projection, an unknown schema or an empty product list exits 2.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'catalog', 'products.json');
const PRICING = path.join(ROOT, 'catalog', 'pricing-pages.json');
const FILMABLE = new Set(['live', 'beta']);
const PRODUCT_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const TIER_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

const args = process.argv.slice(2);
const check = args.includes('--check');
const source = args.find((a) => !a.startsWith('--'));
if (!source) {
  console.error('usage: refresh-catalog.mjs <projection.public.json> [--check]');
  process.exit(2);
}

let projection;
try {
  projection = JSON.parse(readFileSync(source, 'utf8'));
} catch (e) {
  console.error(`catalog_refresh=UNDETERMINED cannot read projection: ${e.message}`);
  process.exit(2);
}
if (projection.schema !== 'madfam-product-projection/v1' || !Array.isArray(projection.products)) {
  console.error(`catalog_refresh=UNDETERMINED unexpected schema: ${projection.schema}`);
  process.exit(2);
}
if (projection.products.length === 0) {
  console.error('catalog_refresh=UNDETERMINED projection lists 0 products');
  process.exit(2);
}

const pricing = JSON.parse(readFileSync(PRICING, 'utf8')).pages;
const products = [];
const skipped = [];

for (const p of projection.products) {
  const primary = p.domains?.primary ?? null;
  const reason = !PRODUCT_RE.test(p.slug)
    ? 'slug is not kebab-case'
    : !FILMABLE.has(p.lifecycle)
      ? `lifecycle ${p.lifecycle}`
      : !primary
        ? 'no public primary host'
        : null;
  if (reason) {
    skipped.push({ slug: p.slug, reason });
    continue;
  }
  const tiers = (p.commerce?.tiers ?? []).filter((t) => TIER_RE.test(t));
  const entry = {
    slug: p.slug,
    name: p.display_name,
    lifecycle: p.lifecycle,
    url: `https://${primary}/`,
    tiers,
  };
  if (pricing[p.slug]) entry.pricing_url = pricing[p.slug];
  products.push(entry);
}

for (const slug of Object.keys(pricing)) {
  if (!products.some((p) => p.slug === slug)) {
    console.error(
      `catalog_refresh=FAIL pricing-pages.json names ${slug}, which is not a filmable product`,
    );
    process.exit(1);
  }
}

products.sort((a, b) => a.slug.localeCompare(b.slug));
skipped.sort((a, b) => a.slug.localeCompare(b.slug));

const catalog = {
  schema: 'cinematic-pointer/catalog@1',
  source: 'MADFAM public product projection (madfam-product-projection/v1)',
  source_last_updated: projection.last_updated,
  products,
  skipped,
};
const text = JSON.stringify(catalog, null, 2) + '\n';
const skus = products.reduce((n, p) => n + p.tiers.length, 0);
const summary = `read=${projection.products.length} products=${products.length} skus=${skus} skipped=${skipped.length}`;

if (check) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    // an absent catalog is drift
  }
  if (current !== text) {
    console.error(`catalog_refresh=DRIFT ${summary}`);
    process.exit(1);
  }
  console.log(`catalog_refresh=OK ${summary}`);
} else {
  writeFileSync(OUT, text);
  console.log(`catalog_refresh=WRITTEN ${summary}`);
}
