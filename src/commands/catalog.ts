import chalk from 'chalk';

import { CatalogCheck, checkGenerated, loadCatalog, writeGenerated } from '../catalog';

interface CatalogOptions {
  catalog: string;
  dir: string;
}

function summary(verdict: string, check: CatalogCheck): string {
  return (
    `catalog_journeys=${verdict} products=${check.products} skus=${check.skus} ` +
    `trailers=${check.trailers} missing=${check.missing.length} stale=${check.stale.length} ` +
    `orphaned=${check.orphaned.length}`
  );
}

/** Write the generated journeys from the catalog. */
export async function catalogGenerate(options: CatalogOptions): Promise<void> {
  try {
    const check = await writeGenerated(await loadCatalog(options.catalog), options.dir);
    console.log(summary(check.ok ? 'WRITTEN' : 'FAIL', check));
    process.exit(check.ok ? 0 : 1);
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(2);
  }
}

/** Fail when a generated journey is missing, stale or orphaned. Exit 2 when nothing could be read. */
export async function catalogCheck(options: CatalogOptions): Promise<void> {
  try {
    const check = await checkGenerated(await loadCatalog(options.catalog), options.dir);
    for (const file of check.missing) console.error(`missing: ${file}`);
    for (const file of check.stale) console.error(`stale: ${file}`);
    for (const file of check.orphaned) console.error(`orphaned: ${file}`);
    console.log(summary(check.ok ? 'OK' : 'DRIFT', check));
    process.exit(check.ok ? 0 : 1);
  } catch (error) {
    console.error(
      `catalog_journeys=UNDETERMINED ${error instanceof Error ? error.message : error}`,
    );
    process.exit(2);
  }
}
