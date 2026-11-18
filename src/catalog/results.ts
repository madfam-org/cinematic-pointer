/**
 * Batch results: the record a `produce` run leaves, and the rules that turn it into an exit code.
 * Kept free of I/O so the rules are unit-tested without a browser or FFmpeg.
 */

export const RESULTS_SCHEMA = 'cinematic-pointer/results@1';

export interface RenderProof {
  aspect: string;
  path: string;
  bytes: number;
  seconds: number;
  width: number;
  height: number;
}

export interface TrailerResult {
  id: string;
  product: string;
  kind: string;
  skus: string[];
  url: string;
  status: 'rendered' | 'failed';
  reason?: string;
  httpStatus?: number;
  stepsExecuted?: number;
  stepsFailed?: number;
  renders: RenderProof[];
}

export interface ProduceResults {
  schema: typeof RESULTS_SCHEMA;
  catalog_source_last_updated: string;
  selected: number;
  rendered: number;
  failed: number;
  trailers: TrailerResult[];
}

export function parseAspects(value: string): string[] {
  const aspects = value
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
  const allowed = ['16:9', '1:1', '9:16', '4:5'];
  for (const aspect of aspects) {
    if (!allowed.includes(aspect)) {
      throw new Error(`Unknown aspect "${aspect}". Allowed: ${allowed.join(', ')}`);
    }
  }
  if (aspects.length === 0) throw new Error('At least one aspect is required');
  // 16:9 is the master every other aspect is reframed from.
  return ['16:9', ...aspects.filter((a) => a !== '16:9')];
}

/**
 * Exit code for a batch: 0 only when something was selected and everything rendered.
 * "Selected nothing" is 2, never 0: an empty read is not a clean run.
 */
export function exitCodeFor(results: ProduceResults): number {
  if (results.selected === 0) return 2;
  if (results.failed > 0 || results.rendered !== results.selected) return 1;
  return 0;
}
