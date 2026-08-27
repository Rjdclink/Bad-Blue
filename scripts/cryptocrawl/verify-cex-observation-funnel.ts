import assert from 'node:assert/strict';
import { buildObservedCexCandidates } from '../../server/services/cryptocrawl/discovery/cex-observation-candidates.js';
import { measuredCandidateRegistry } from '../../server/services/cryptocrawl/discovery/measured-candidate-registry.js';
import type { PublicCexBboObservation } from '../../server/services/cryptocrawl/discovery/public-cex-discovery.js';

const now = Date.now();

function observation(
  venue: PublicCexBboObservation['venue'],
  symbol: string,
  bid: number,
  ask: number,
  ageMs: number,
): PublicCexBboObservation {
  return {
    venue,
    symbol,
    bid,
    ask,
    observedAt: now - ageMs,
    source: 'public_rest_bbo',
    executable: false,
  };
}

const oneVenue = buildObservedCexCandidates([
  observation('binance', 'ETHUSDT', 3000, 3001, 100),
], 1500);
assert.equal(oneVenue.length, 0, 'one public venue must not create a cross-venue CEX observation candidate');

const measured = buildObservedCexCandidates([
  observation('binance', 'ETHUSDT', 3000, 3001, 100),
  observation('bybit', 'ETHUSDT', 3000.5, 3001.5, 80),
  observation('binance', 'ETHUSDT', 2999, 3002, 500), // older duplicate must be ignored
], 1500);

assert.equal(measured.length, 1);
const candidate = measured[0];
assert.equal(candidate.topology, 'CEX_CEX');
assert.equal(candidate.status, 'observed');
assert.equal(candidate.executableCapability, false);
assert.equal(candidate.venues.length, 2);
assert.equal(candidate.rawQuotes.length, 2);
assert.ok(candidate.rawQuotes.every(quote => quote.executable === false));
assert.equal(candidate.economics.grossProfitUsd, null);
assert.equal(candidate.economics.deterministicNetProfitUsd, null);
assert.equal(candidate.economics.feeUsd, null);
assert.equal(candidate.depth.status, 'unavailable');
assert.ok(candidate.missingInformation.includes('authenticated_fee_evidence_required'));
assert.ok(candidate.missingInformation.includes('deterministic_all_in_economics_required'));

measuredCandidateRegistry.record(candidate);
const metrics = measuredCandidateRegistry.getMetrics(60_000);
assert.equal(metrics.byTopology.CEX_CEX.observed, 1);
assert.equal(metrics.byTopology.CEX_CEX.deterministicPositive, 0);
assert.equal(metrics.byTopology.CEX_CEX.eligible, 0);
assert.equal(metrics.deterministicPositive, 0);
assert.equal(metrics.eligible, 0);

console.log('CEX observation funnel verification passed');
