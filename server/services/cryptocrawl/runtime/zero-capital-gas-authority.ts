import type { GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';
import { zeroCapitalEngine, type SupportedChain } from '../core/zero-capital-engine.js';
import { getProvenZeroCapitalGasFundingDecision } from './system-owned-gas-funding-proof-wiring.js';

/**
 * Single runtime entrypoint for strict zero-personal-cost gas proof.
 * Callers may consume this decision; none may derive or override funding truth.
 */
export async function getCanonicalZeroCapitalGasDecision(chain: SupportedChain): Promise<GasFundingDecision> {
  return getProvenZeroCapitalGasFundingDecision(zeroCapitalEngine as any, chain);
}
