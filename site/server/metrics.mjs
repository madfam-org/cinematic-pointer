// @ts-check
/** Request counters and a duration histogram in the Prometheus text format. In memory; reset on restart. */

const BUCKETS = [0.001, 0.005, 0.025, 0.1, 0.5];
/** @type {Map<string, number>} */
const requests = new Map();
const histogram = { counts: BUCKETS.map(() => 0), sum: 0, count: 0 };

/** @param {string} route @param {number} status @param {number} seconds */
export function observe(route, status, seconds) {
  const key = `${route}|${status}`;
  requests.set(key, (requests.get(key) ?? 0) + 1);
  BUCKETS.forEach((le, i) => {
    if (seconds <= le) histogram.counts[i] += 1;
  });
  histogram.sum += seconds;
  histogram.count += 1;
}

export function render() {
  const name = 'trailer_landing';
  const lines = [`# TYPE ${name}_requests_total counter`];
  for (const [key, n] of [...requests].sort()) {
    const [route, status] = key.split('|');
    lines.push(`${name}_requests_total{route="${route}",status="${status}"} ${n}`);
  }
  lines.push(`# TYPE ${name}_request_duration_seconds histogram`);
  BUCKETS.forEach((le, i) =>
    lines.push(`${name}_request_duration_seconds_bucket{le="${le}"} ${histogram.counts[i]}`),
  );
  lines.push(`${name}_request_duration_seconds_bucket{le="+Inf"} ${histogram.count}`);
  lines.push(
    `${name}_request_duration_seconds_sum ${histogram.sum}`,
    `${name}_request_duration_seconds_count ${histogram.count}`,
  );
  return `${lines.join('\n')}\n`;
}
