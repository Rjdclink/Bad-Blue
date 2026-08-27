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

export function getLatestOracleEvidence(): CanonicalOracleEvidence | null {
  return latest
    ? { ...latest, sources: latest.sources.map(source => ({ ...source })) }
    : null;
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
    latest = {
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
    return result;
  };
  logger.info('MultiOracle canonical evidence wiring installed', {
    component: 'OracleEvidenceWiring',
  });
}
