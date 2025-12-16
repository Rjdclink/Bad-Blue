/**
 * Extractor Module - Phase 2 (Updated): Phantom Ninja
 * 
 * Browserless-first scrape router with tiered extraction
 * Tier 0 (HTTP) → Tier 1 (API Discovery) → Tier 2 (Remote Render)
 * NO SIDE EFFECTS AT MODULE LOAD - all providers are import-safe
 */

export * from './types';
export { HttpProvider } from './HttpProvider';
export { ApiDiscoveryProvider } from './ApiDiscoveryProvider';
export { ZenRowsProvider } from './ZenRowsProvider';
export { ExtractorRouter } from './ExtractorRouter';
export type { ExtractorConfig, ExtractionResult, ScoringFactors } from './ExtractorRouter';
