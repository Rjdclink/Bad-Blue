import logger from '../../../logger.js';

let emitted = false;

/**
 * Operator-visible inventory of historical CryptoCrawler systems that are kept
 * only for compatibility/research and have no authoritative trading role.
 */
export const LEGACY_NON_AUTHORITATIVE_COMPONENTS = [
  'core/master-orchestrator.ts',
  'core/eden-storage.ts',
  'core/cain-crawler.ts',
  'core/neurofusion.ts',
  'core/lux-swarm.ts',
  'core/microtask-engine.ts',
  'core/light-communication.ts',
  'core/stealth-security.ts',
  'agents/conjoined-twin-crawler.ts',
  'agents/cain-twin-hybrid.ts',
  'agents/enhanced-micro-crawler.ts',
  'agents/swarm-orchestrator.ts',
  'agents/starburst-replication.ts',
  'agents/starburst-snake.ts',
  'capital-free/index.ts (legacy namespace only)',
  'capital-free/starburst-scaling.ts',
  'eden/deployment.ts',
  'eden/service.ts',
  'intelligence/index.ts (legacy namespace only)',
  'intelligence/gravity-reaper.ts',
  'ai/index.ts (legacy namespace only)',
  'evolution/index.ts (legacy namespace only)',
  'parallel-intelligence/parallel-lanes.ts',
  'parallel-intelligence/six-cane-system.ts',
  'validation/monte-carlo-engine.ts (base/research fallback; not live authority)',
  'evolution/hyper-evolution-engine.ts (research/legacy)',
  'evolution/swarm-intelligence.ts (research/legacy)',
  'optimization/index.ts (legacy namespace only)',
  'optimization/divine-engine.ts',
  'config/maximum-profitability.ts (legacy compatibility config only)',
] as const;

export function logLegacyIntelligenceQuarantine(): void {
  if (emitted) return;
  emitted = true;
  logger.info('[CryptoCrawler] Legacy synthetic/research quarantine active', {
    component: 'LegacyIntelligenceQuarantine',
    disconnectedFromAuthoritativeTrading: LEGACY_NON_AUTHORITATIVE_COMPONENTS,
    legacyPublicEntryPoint: 'server/services/cryptocrawl/legacy/index.ts',
    reason: 'Historical components contain simulated, placeholder, duplicate, or superseded authority and must not be represented as measured live trading evidence',
    authoritativeReplacement: [
      'canonical_measured_runtime',
      'canonical_opportunity_state',
      'Cryptara_assessment_wiring',
      'QuantiComp_compute_authority',
      'authoritative_adaptive_monte_carlo',
      'direct_exchange_quotes',
      'authenticated_cex_fees',
      'TradingView_live',
      'Alchemy_mempool',
      'MultiOracle_validation',
      'governed_execution',
      'normalized_terminal_settlement',
      'terminal_settlement_feedback',
    ],
  });
}
