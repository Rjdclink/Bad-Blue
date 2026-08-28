/**
 * CryptoCrawler legacy compatibility surface.
 *
 * Nothing exported from this module is a canonical trading authority. These
 * namespaces exist only for historical tooling, demos, migration, and forensic
 * comparison. New production code MUST import from `server/services/cryptocrawl`
 * or from the specific canonical module instead.
 *
 * Legacy modules MUST NOT authorize live execution, fabricate settlement/profit,
 * or override canonical discovery, Cryptara, QuantiComp, governance, execution,
 * settlement, or terminal-feedback authorities.
 */

export * as edenStorage from '../core/eden-storage.js';
export * as cain from '../core/cain-crawler.js';
export * as neurofusion from '../core/neurofusion.js';
export * as conjoinedTwin from '../agents/conjoined-twin-crawler.js';
export * as starburstReplication from '../agents/starburst-replication.js';
export * as starburstSnake from '../agents/starburst-snake.js';
export * as enhancedMicroCrawler from '../agents/enhanced-micro-crawler.js';
export * as swarmOrchestrator from '../agents/swarm-orchestrator.js';
export * as microtaskEngine from '../core/microtask-engine.js';
export * as lightCommunication from '../core/light-communication.js';
export * as stealthSecurity from '../core/stealth-security.js';
export * as masterOrchestrator from '../core/master-orchestrator.js';
export * as luxSwarm from '../core/lux-swarm.js';
export * as edenDeployment from '../eden/deployment.js';
export * as legacyIntelligence from '../intelligence/index.js';
export * as legacyCapitalFree from '../capital-free/index.js';
export * as aiHarmony from '../ai/index.js';
export * as legacyEvolution from '../evolution/index.js';
export * as legacyMonteCarlo from '../validation/monte-carlo-engine.js';
export * as divineOptimization from '../optimization/index.js';
export * as maximumProfitabilityConfig from '../config/maximum-profitability.js';
export * as cainTwinHybrid from '../agents/cain-twin-hybrid.js';

export const LEGACY_CRYPTOCRAWLER_AUTHORITY = 'none' as const;
export const LEGACY_CRYPTOCRAWLER_EXECUTION_ALLOWED = false as const;
