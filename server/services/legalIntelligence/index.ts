/**
 * Legal Intelligence Services
 * TheHarvester-style email and DNS intelligence for legal contacts
 * Phase 2: SpiderFoot Legal Entity Correlation
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
