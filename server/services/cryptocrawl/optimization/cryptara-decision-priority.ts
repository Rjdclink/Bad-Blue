export const CRYPTARA_DECISION_PRIORITIES = [
  {
    rank: 1,
    id: 'market_truth',
    objective: 'Verify that the live market, executable product, quotes, fees, depth and provider evidence are current and internally consistent.',
  },
  {
    rank: 2,
    id: 'profitability_bps',
    objective: 'Improve deterministic all-in economics by reducing the BPS-to-break-even burden and maximizing positive net BPS/net dollars.',
  },
  {
    rank: 3,
    id: 'latency_slippage',
    objective: 'Reduce decision, quote and execution latency plus realized slippage without weakening market truth or profitability evidence.',
  },
  {
    rank: 4,
    id: 'notional',
    objective: 'Maximize safely executable notional only inside the current profit-ladder/stage/resource/liquidity envelope.',
  },
  {
    rank: 5,
    id: 'exploration',
    objective: 'Explore new routes, modes and strategies only with residual compute capacity and without displacing higher-priority work.',
  },
] as const;

export type CryptaraDecisionPriorityId = typeof CRYPTARA_DECISION_PRIORITIES[number]['id'];

export function getCryptaraDecisionPriorityList() {
  return CRYPTARA_DECISION_PRIORITIES.map(priority => ({ ...priority }));
}
