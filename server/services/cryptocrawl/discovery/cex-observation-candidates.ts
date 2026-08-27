import type { MeasuredCandidate } from './measured-candidate-registry.js';
import type { PublicCexBboObservation } from './public-cex-discovery.js';

/**
 * Convert measured discovery-only public BBOs into non-executable CEX_CEX
 * observation candidates. This is observability/search evidence only: no fee,
 * depth, deterministic-profit, eligibility, or execution evidence is invented.
 */
export function buildObservedCexCandidates(
  observations: readonly PublicCexBboObservation[],
  ttlMs: number,
): Array<Omit<MeasuredCandidate, 'updatedAt'>> {
  const grouped = new Map<string, PublicCexBboObservation[]>();
  for (const observation of observations) {
    const symbol = observation.symbol.trim().toUpperCase();
    if (!symbol) continue;
    const current = grouped.get(symbol) || [];
    current.push(observation);
    grouped.set(symbol, current);
  }

  const candidates: Array<Omit<MeasuredCandidate, 'updatedAt'>> = [];
  for (const [symbol, rows] of grouped.entries()) {
    const latestByVenue = new Map<string, PublicCexBboObservation>();
    for (const row of rows) {
      const previous = latestByVenue.get(row.venue);
      if (!previous || row.observedAt > previous.observedAt) latestByVenue.set(row.venue, row);
    }
    const measured = [...latestByVenue.values()].sort((left, right) => left.venue.localeCompare(right.venue));
    if (measured.length < 2) continue;

    const observedAt = Math.max(...measured.map(row => row.observedAt));
    const expiry = observedAt + Math.max(250, ttlMs);
    candidates.push({
      opportunityId: `public-cex-observed:${symbol}`,
      topology: 'CEX_CEX',
      observedAt,
      expiresAt: expiry,
      status: 'observed',
      assets: [symbol],
      venues: measured.map(row => row.venue),
      chains: ['cex'],
      rawQuotes: measured.map(row => ({
        source: row.source,
        venue: row.venue,
        symbol,
        observedAt: row.observedAt,
        bid: row.bid,
        ask: row.ask,
        executable: false,
        provenance: [`public_cex:${row.venue}`, 'discovery_only'],
      })),
      depth: {
        status: 'unavailable',
        detail: 'Public top-of-book discovery does not establish executable depth',
      },
      economics: {
        grossProfitUsd: null,
        deterministicNetProfitUsd: null,
        feeUsd: null,
        gasUsd: null,
        bridgeUsd: null,
        expectedSlippageBps: null,
        expectedPriceImpactBps: null,
      },
      quoteAgeMs: Math.max(0, Date.now() - observedAt),
      executableCapability: false,
      executionCapabilityReason: 'Discovery-only public venues are signal sources; executable admission requires settlement-safe venue adapters, authenticated fees, depth, sizing, and deterministic positive all-in economics',
      missingInformation: [
        'settlement_safe_executable_venue_pair_required',
        'authenticated_fee_evidence_required',
        'executable_depth_required',
        'deterministic_all_in_economics_required',
      ],
      provenance: [
        'measured_public_cex_bbo',
        'cross_venue_observation',
        'discovery_only_non_authoritative_for_execution',
      ],
    });
  }

  return candidates;
}
