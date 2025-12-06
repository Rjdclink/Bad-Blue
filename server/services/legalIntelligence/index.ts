/**
 * Legal Intelligence Services
 * TheHarvester-style email and DNS intelligence for legal contacts
 * Phase 2: SpiderFoot Legal Entity Correlation
 * Phase 3A: Crawl4AI Semantic Extraction
 */

export * from './types';
export * from './emailDiscovery';
export * from './certificateTransparency';
export * from './dnsIntelligence';

export { emailDiscoveryService } from './emailDiscovery';
export { certificateTransparencyService } from './certificateTransparency';
export { dnsIntelligenceService } from './dnsIntelligence';

// Phase 2: Correlation Engine Exports
export { correlationDatabase, CorrelationDatabase } from './correlationDB';
export { correlationEngine, CorrelationEngine, IntelligenceEventBus, ModuleThreadPool } from './correlationEngine';
export { correlationRulesEngine, CorrelationRulesEngine } from './correlationRules';
export { EntityGraph, createEntityGraph } from './entityGraph';
export { PatternDetectionEngine, createPatternDetectionEngine } from './patternDetection';

// Module exports
export * from './modules';

// Integration utilities
export * from './integrations';

// Phase 3A: Semantic Extraction Exports
export * from './schemas';
export * from './contentFilter';
export * from './markdownConverter';
export * from './extractionCache';
export * from './semanticExtractor';

export { contentFilter } from './contentFilter';
export { markdownConverter } from './markdownConverter';
export { extractionCache } from './extractionCache';
export { semanticLegalExtractor } from './semanticExtractor';

// Phase 3B: Adaptive Crawler + Browser Manager Exports
export { browserManager, BrowserManager } from './browserManager';
export { adaptiveLegalCrawler, AdaptiveLegalCrawler } from './adaptiveCrawler';

// Extractor exports
export { courtDocketExtractor, CourtDocketExtractor } from './extractors/courtDocketExtractor';
export { statuteExtractor, StatuteExtractor } from './extractors/statuteExtractor';
export { officerRecordsExtractor, OfficerRecordsExtractor } from './extractors/officerRecordsExtractor';
export { precedentExtractor, PrecedentExtractor } from './extractors/precedentExtractor';

export type { Jurisdiction, DocketExtractionOptions } from './extractors/courtDocketExtractor';
export type { StatuteSource, StatuteExtractionOptions } from './extractors/statuteExtractor';
export type { OfficerRecordsOptions } from './extractors/officerRecordsExtractor';
export type { PrecedentSource, PrecedentSearchOptions } from './extractors/precedentExtractor';
