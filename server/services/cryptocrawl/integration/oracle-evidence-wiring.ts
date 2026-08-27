import logger from '../../../logger.js';
import { MultiOraclePriceValidator, type PriceValidationResult } from '../validation/multi-oracle-validator.js';

export interface CanonicalOracleEvidence {
  asset: string;
  chain: string;
  observedAt: number;
  isValid: boolean;
  consensusPrice: number;
  deviation: number;
  confidence: number;
  recommendation: PriceValidationResult['recommendation'];
  manipulationRisk: PriceValidationResult['manipulation']['risk'];
  sources: Array<{ oracle: string; status: string; price: number }>;
}

let installed = false;
let latest: CanonicalOracleEvidence | null = null;
const byAssetChain = new Map<string, CanonicalOracleEvidence>();

function key(asset: string, chain: string): string {
  return `${asset.trim().toUpperCase()}:${chain.trim().toLowerCase()}`;
}

function cloneEvidence(evidence: CanonicalOracleEvidence | null | undefined): CanonicalOracleEvidence | null {
  return evidence
    ? { ...evidence, sources: evidence.sources.map(source => ({ ...source })) }
    : null;
}

/**
 * Backward-compatible latest evidence accessor. Chain-scoped validations are no
 * longer exposed through this unscoped API because a caller without a candidate
 * chain cannot prove compatibility. Existing unscoped consumers therefore fail
 * closed instead of attaching Polygon evidence to Avalanche/Arbitrum/etc.
 */
export function getLatestOracleEvidence(): CanonicalOracleEvidence | null {
  if (!latest || latest.chain !== 'global_reference') return null;
  return cloneEvidence(latest);
}

/** Exact chain-aware decision evidence accessor. */
export function getOracleEvidence(asset: string, chain: string): CanonicalOracleEvidence | null {
  return cloneEvidence(byAssetChain.get(key(asset, chain)));
}

export function ensureOracleEvidenceWiring(): void {
  if (installed) return;
  installed = true;
  const prototype = MultiOraclePriceValidator.prototype as unknown as {
    validatePrice: (asset: string, chain: any, expectedPrice?: number) => Promise<PriceValidationResult>;
  };
  const original = prototype.validatePrice;
  prototype.validatePrice = async function(asset: string, chain: any, expectedPrice?: number): Promise<PriceValidationResult> {
    const result = await original.call(this, asset, chain, expectedPrice);
    const evidence: CanonicalOracleEvidence = {
      asset: String(asset).toUpperCase(),
      chain: String(chain).toLowerCase(),
      observedAt: Date.now(),
      isValid: result.isValid,
      consensusPrice: result.consensusPrice,
      deviation: result.deviation,
      confidence: result.confidence,
      recommendation: result.recommendation,
      manipulationRisk: result.manipulation.risk,
      sources: result.details.map(detail => ({
        oracle: detail.oracle,
        status: detail.status,
        price: detail.price,
      })),
    };
    latest = evidence;
    byAssetChain.set(key(evidence.asset, evidence.chain), evidence);
    if (byAssetChain.size > 256) {
      const cutoff = Date.now() - Math.max(60_000, Number(process.env.CRYPTOCRAWL_ORACLE_EVIDENCE_RETENTION_MS || 15 * 60_000));
      for (const [entryKey, entry] of byAssetChain.entries()) {
        if (entry.observedAt < cutoff) byAssetChain.delete(entryKey);
      }
    }
    return result;
  };
  logger.info('MultiOracle canonical evidence wiring installed', {
    component: 'OracleEvidenceWiring',
    correlationKey: 'asset+chain',
    unscopedChainEvidenceFailsClosed: true,
    crossChainReuseAllowed: false,
  });
}
