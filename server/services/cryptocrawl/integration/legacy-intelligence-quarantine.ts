import logger from '../../../logger.js';

let emitted = false;

export function logLegacyIntelligenceQuarantine(): void {
  if (emitted) return;
  emitted = true;
  logger.info('[CryptoCrawler] Legacy synthetic intelligence quarantine active', {
    component: 'LegacyIntelligenceQuarantine',
    disconnectedFromAuthoritativeTrading: [
      'intelligence/gravity-reaper.ts',
      'parallel-intelligence/parallel-lanes.ts',
      'parallel-intelligence/six-cane-system.ts',
    ],
    reason: 'Legacy producers contain randomized/simulated observations and must not be represented as measured live trading evidence',
    authoritativeReplacement: [
      'canonical_opportunity_state',
      'direct_exchange_quotes',
      'authenticated_cex_fees',
      'TradingView_live',
      'Alchemy_mempool',
      'MultiOracle_validation',
      'terminal_settlement_feedback',
    ],
  });
}
