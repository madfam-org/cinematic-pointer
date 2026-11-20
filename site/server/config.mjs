// @ts-check
/**
 * Runtime configuration from the environment. The repository carries names only; values come from
 * the deployment manifests. Nothing here is a secret: the landing has none.
 */

export const SERVICE = 'cinematic-pointer-landing';

/**
 * The page stays out of search until the owner says to index it (2026-11-19). Lifting this is a code
 * change made on the owner's word, never a deployment setting.
 */
export const INDEXABLE = false;

/**
 * @typedef {object} Config
 * @property {string} env
 * @property {boolean} production
 * @property {string[]} hosts the hosts that get the page in production; any other host gets 421
 * @property {number} port
 * @property {number} metricsPort
 * @property {string | null} revision
 */

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {Config}
 */
export function configFromEnv(env = process.env) {
  const name = env.TRAILER_ENV ?? 'development';
  // An environment spelled any other way would silently turn the host rule and HSTS off.
  if (name !== 'production' && name !== 'development') {
    throw new Error('TRAILER_ENV must be "production" or "development"');
  }
  const hosts = (env.TRAILER_PUBLIC_HOSTS ?? 'trailer.madfam.io')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (hosts.length === 0) throw new Error('TRAILER_PUBLIC_HOSTS names no host');
  const port = Number(env.TRAILER_PORT || 8000);
  const metricsPort = Number(env.TRAILER_METRICS_PORT || 9090);
  const valid = (/** @type {number} */ p) => Number.isInteger(p) && p >= 1 && p <= 65535;
  if (!valid(port) || !valid(metricsPort) || port === metricsPort) {
    throw new Error(
      'TRAILER_PORT and TRAILER_METRICS_PORT must be two different ports between 1 and 65535',
    );
  }
  return {
    env: name,
    production: name === 'production',
    hosts,
    port,
    metricsPort,
    revision: env.TRAILER_REVISION || null,
  };
}
