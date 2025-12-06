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

// Phase 3B: Adaptive Crawler & Extractors Exports
export { BrowserManager, getBrowserManager, browserManager } from './browserManager';
export { AdaptiveCrawler, getAdaptiveCrawler, adaptiveCrawler } from './adaptiveCrawler';
export { CourtDocketExtractor, getCourtDocketExtractor, courtDocketExtractor } from './extractors/courtDocketExtractor';
export { StatuteExtractor, getStatuteExtractor, statuteExtractor } from './extractors/statuteExtractor';
export { OfficerRecordsExtractor, getOfficerRecordsExtractor, officerRecordsExtractor } from './extractors/officerRecordsExtractor';
export { PrecedentExtractor, getPrecedentExtractor, precedentExtractor } from './extractors/precedentExtractor';

export type { DocketData } from './extractors/courtDocketExtractor';
export type { StatuteData } from './extractors/statuteExtractor';
export type { OfficerRecordData } from './extractors/officerRecordsExtractor';
export type { CaseLawData } from './extractors/precedentExtractor';
