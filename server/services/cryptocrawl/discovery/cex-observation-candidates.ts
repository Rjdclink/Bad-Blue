import type { MeasuredCandidate } from './measured-candidate-registry.js';
import type { PublicCexBboObservation } from './public-cex-discovery.js';

const INTEGRATED_EXECUTABLE_CEX_VENUES = new Set(['coinbase', 'kraken', 'okx']);

type GrossCexObservation = {
  buyVenue: string;
  sellVenue: string;
  buyAsk: number;
  sellBid: number;
  grossSpreadBps: number;
};

function bestMeasuredGrossSpread(rows: readonly PublicCexBboObservation[]): GrossCexObservation | null {
  let best: GrossCexObservation | null = null;
  for (const buy of rows) {
    if (!Number.isFinite(buy.ask) || !(buy.ask > 0)) continue;
    for (const sell of rows) {
      if (buy.venue === sell.venue || !Number.isFinite(sell.bid) || !(sell.bid > 0)) continue;
      const grossSpreadBps = ((sell.bid - buy.ask) / buy.ask) * 10_000;
      if (!Number.isFinite(grossSpreadBps)) continue;
      if (!best || grossSpreadBps > best.grossSpreadBps) {
        best = {
          buyVenue: buy.venue,
          sellVenue: sell.venue,
          buyAsk: buy.ask,
          sellBid: sell.bid,
          grossSpreadBps,
        };
      }
    }
  }
  return best;
}

/**
 * Convert measured discovery-only public BBOs into non-executable CEX_CEX
 * observation candidates. This is observability/search evidence only: no fee,
 * depth, deterministic-profit, eligibility, or execution evidence is invented.
 *
 * Public venues without a settlement-safe integrated executor are deliberately
 * advisory discovery surfaces. Their unavailable private fees/depth/settlement
 * are not "missing" evidence for CryptoCrawler to repeatedly reacquire. Only a
 * symbol observed on at least two integrated executable venues is allowed to
 * advertise execution-hydration requirements.
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

    const integratedVenues = [...new Set(measured
      .map(row => row.venue.trim().toLowerCase())
      .filter(venue => INTEGRATED_EXECUTABLE_CEX_VENUES.has(venue)))];
    const executionHydrationPossible = integratedVenues.length >= 2;
    const observedAt = Math.max(...measured.map(row => row.observedAt));
    const expiry = observedAt + Math.max(250, ttlMs);
    const grossObservation = bestMeasuredGrossSpread(measured);
    candidates.push({
      opportunityId: `public-cex-observed:${symbol}`,
      topology: 'CEX_CEX',
      observedAt,
      expiresAt: expiry,
      // A public-only venue pair is terminally non-executable for the current
      // integration set, not an active evidence backlog. It remains visible as
      // blocked advisory market intelligence while broad discovery keeps moving.
      status: executionHydrationPossible ? 'observed' : 'blocked',
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
        provenance: [
          `public_cex:${row.venue}`,
          'discovery_only',
          INTEGRATED_EXECUTABLE_CEX_VENUES.has(row.venue.trim().toLowerCase())
            ? 'integrated_venue_public_measurement'
            : 'public_only_venue_advisory_measurement',
        ],
      })),
      depth: {
        status: 'unavailable',
        detail: executionHydrationPossible
          ? 'Public top-of-book discovery is a signal only; integrated venue depth is measured by the canonical executable CEX verifier when a positive integrated edge warrants hydration'
          : 'Public-only venue observations remain advisory because no two settlement-safe integrated execution legs exist for this symbol in the observation',
      },
      economics: {
        grossProfitUsd: null,
        deterministicNetProfitUsd: null,
        feeUsd: null,
        gasUsd: null,
        bridgeUsd: null,
        expectedSlippageBps: null,
        expectedPriceImpactBps: null,
        grossProfitBps: grossObservation?.grossSpreadBps ?? null,
        netProfitBps: null,
        bpsToBreakEven: null,
      },
      quoteAgeMs: Math.max(0, Date.now() - observedAt),
      executableCapability: false,
      executionCapabilityReason: executionHydrationPossible
        ? 'Two integrated execution venues are observed publicly; canonical authenticated fees, measured depth, product constraints, sizing and deterministic positive all-in economics are still required before execution'
        : 'Advisory public-only venue pair has no two integrated settlement-safe execution legs; this is an explicit capability boundary, not missing evidence and not a reacquisition target',
      missingInformation: executionHydrationPossible
        ? [
            'required:authenticated_fee_evidence',
            'required:executable_depth',
            'required:deterministic_all_in_economics',
          ]
        : [
            'advisory:public_only_venue_pair_not_integrated_for_execution',
          ],
      provenance: [
        'measured_public_cex_bbo',
        'cross_venue_observation',
        'discovery_only_non_authoritative_for_execution',
        ...(grossObservation ? [
          `measured_gross_bps:${grossObservation.grossSpreadBps}`,
          `measured_gross_route:${grossObservation.buyVenue}->${grossObservation.sellVenue}`,
          'measured_gross_bps_execution_authority:false',
        ] : []),
        executionHydrationPossible
          ? 'execution_hydration_possible:two_or_more_integrated_venues'
          : 'execution_hydration_not_applicable:public_only_venue_scope',
      ],
    });
  }

  return candidates;
}