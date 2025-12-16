/**
 * Extractor Module - Phase 3: Phantom Ninja with PhantomDecision
 * 
 * Browserless-first scrape router with tiered extraction and full observability
 * Tier 0 (HTTP) → Tier 1 (API Discovery) → Tier 2 (Remote Render)
 * NO SIDE EFFECTS AT MODULE LOAD - all providers are import-safe
 */

export * from './types';
export { HttpProvider } from './HttpProvider';
export { ApiDiscoveryProvider} from './ApiDiscoveryProvider';
export { ZenRowsProvider } from './ZenRowsProvider';
export { ExtractorRouter } from './ExtractorRouter';
export type { ExtractorConfig, ExtractionResult, ScoringFactors } from './ExtractorRouter';

// Phase 3 exports
export { getPhantomConfig, DEFAULT_PHANTOM_CONFIG, type PhantomConfig, Tier2Provider } from './PhantomConfig';
export {
  createPhantomDecision,
  logPhantomDecision,
  isEscalationEligible,
  PhantomReasonCode,
  ESCALATION_ELIGIBLE_CODES,
  type PhantomDecision,
} from './PhantomDecision';
