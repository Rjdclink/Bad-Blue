'use strict';
// ISB observation mesh. It cannot receive, send, rewrite, block or redirect requests.
const {normalize} = require('./normalize.cjs');

function createMesh(options = {}) {
  const requested = Number(options?.maxBuckets);
  const maxBuckets = Number.isInteger(requested) && requested >= 1 && requested <= 2048 ? requested : 256;
  const buckets = new Map();
  const totals = {observed: 0, rejected: 0, suspiciousProbes: 0, serverErrors: 0};

  function observe(raw) {
    const event = normalize(raw);
    if (!event) {
      totals.rejected++;
      return Object.freeze({accepted: false, action: 'observe'});
    }
    totals.observed++;
    if (event.level === 'suspicious') totals.suspiciousProbes++;
    if (event.statusClass === '5xx') totals.serverErrors++;
    let bucket = buckets.get(event.minute);
    if (!bucket) {
      if (buckets.size >= maxBuckets) buckets.delete(buckets.keys().next().value);
      bucket = {minute: event.minute, count: 0, suspiciousProbes: 0, serverErrors: 0, hosts: new Set()};
      buckets.set(event.minute, bucket);
    }
    bucket.count++;
    bucket.hosts.add(event.host);
    if (event.level === 'suspicious') bucket.suspiciousProbes++;
    if (event.statusClass === '5xx') bucket.serverErrors++;
    return Object.freeze({accepted: true, action: 'observe'});
  }

  function snapshot() {
    const summaries = [...buckets.values()].map(bucket => ({
      minute: bucket.minute,
      count: bucket.count,
      suspiciousProbes: bucket.suspiciousProbes,
      serverErrors: bucket.serverErrors,
      observedHosts: bucket.hosts.size
    })).sort((a, b) => a.minute.localeCompare(b.minute));
    const findings = summaries.filter(bucket => bucket.minute !== 'unknown' && bucket.suspiciousProbes >= 3)
      .map(bucket => ({minute: bucket.minute, kind: 'probe-burst', count: bucket.suspiciousProbes,
        recommendedResponse: 'operator-review', enforcement: 'none'}));
    return Object.freeze({version: 1, scope: 'legalwhat', mode: 'passive', action: 'observe',
      totals: {...totals}, buckets: summaries, findings});
  }
  return Object.freeze({observe, snapshot});
}
module.exports = {createMesh};
