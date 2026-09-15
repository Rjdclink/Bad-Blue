import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';

/**
 * Immutable, provenance-bearing input-asset price evidence.
 *
 * This is deliberately separate from opportunity lifetime: consumers validate the
 * price observation's own timestamps instead of assuming that a live candidate
 * automatically implies a live USD price. No I/O is performed by this module.
 */
export interface PriceEvidence {
  readonly priceUsd: number;
  readonly observedAt: number;
  readonly expiresAt: number;
  readonly source: string;
  readonly confidence?: number;
  readonly blockNumber?: number;
  readonly roundId?: string;
}

export type PriceEvidencedOpportunity = ZeroCapitalOpportunity & {
  readonly priceEvidence?: PriceEvidence;
};

const residentPriceEvidence = new WeakMap<object, PriceEvidence>();

function validEvidence(evidence: PriceEvidence | undefined, now: number): evidence is PriceEvidence {
  return !!evidence
    && Number.isFinite(evidence.priceUsd)
    && evidence.priceUsd > 0
    && Number.isFinite(evidence.observedAt)
    && Number.isFinite(evidence.expiresAt)
    && evidence.observedAt <= now
    && evidence.expiresAt > now
    && evidence.expiresAt > evidence.observedAt
    && typeof evidence.source === 'string'
    && evidence.source.trim().length > 0;
}

/**
 * Attach already-measured evidence to the exact opportunity object by reference.
 * This preserves Stage-1 object identity and adds only a WeakMap write.
 */
export function rememberResidentPriceEvidence(
  opportunity: ZeroCapitalOpportunity,
  evidence: PriceEvidence,
  now = Date.now(),
): boolean {
  if (!validEvidence(evidence, now)) return false;
  residentPriceEvidence.set(opportunity, Object.freeze({ ...evidence }));
  return true;
}

/**
 * Read fresh price evidence without network/database/model work. During migration,
 * a legacy scalar already carried by the candidate is wrapped once with explicit
 * provenance and freshness instead of being treated as timeless. Missing scalars
 * remain missing; this function never fabricates a stablecoin peg or price.
 */
export function getResidentPriceEvidence(
  opportunity: ZeroCapitalOpportunity,
  now = Date.now(),
): PriceEvidence | null {
  const explicit = (opportunity as PriceEvidencedOpportunity).priceEvidence;
  if (validEvidence(explicit, now)) {
    const frozen = Object.isFrozen(explicit) ? explicit : Object.freeze({ ...explicit });
    residentPriceEvidence.set(opportunity, frozen);
    return frozen;
  }

  const cached = residentPriceEvidence.get(opportunity);
  if (validEvidence(cached, now)) return cached;
  if (cached) residentPriceEvidence.delete(opportunity);

  const legacyPrice = Number(opportunity.inputAssetUsdPrice);
  if (!Number.isFinite(legacyPrice) || legacyPrice <= 0) return null;
  if (opportunity.timestamp > now || opportunity.expiresAt <= now || opportunity.expiresAt <= opportunity.timestamp) return null;

  const migrated = Object.freeze<PriceEvidence>({
    priceUsd: legacyPrice,
    observedAt: opportunity.timestamp,
    expiresAt: opportunity.expiresAt,
    source: 'candidate_input_asset_usd_price',
  });
  residentPriceEvidence.set(opportunity, migrated);
  return migrated;
}

/** Preserve the exact immutable evidence reference across a local refinement. */
export function inheritResidentPriceEvidence(
  source: ZeroCapitalOpportunity,
  target: ZeroCapitalOpportunity,
  now = Date.now(),
): void {
  const evidence = getResidentPriceEvidence(source, now);
  if (evidence) residentPriceEvidence.set(target, evidence);
}
