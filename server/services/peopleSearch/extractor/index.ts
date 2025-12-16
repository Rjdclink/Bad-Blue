/**
 * Extractor Module - Phase 2: Phantom Ninja
 * 
 * Browserless-first scrape router with tiered extraction
 * NO SIDE EFFECTS AT MODULE LOAD - all providers are import-safe
 */

export * from './types';
export { HttpProvider } from './HttpProvider';
export { ZenRowsProvider } from './ZenRowsProvider';
export { ExtractorRouter } from './ExtractorRouter';
export type { ExtractorConfig, ExtractionResult } from './ExtractorRouter';
