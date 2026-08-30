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

export interface CryptaraPriorityDecisionVector {
  marketTruthReady: boolean;
  marketTruthScore: number;
  deterministicNetProfitUsd: number | null;
  netProfitBps: number | null;
  bpsToBreakEven: number | null;
  latencyMs: number | null;
  slippageBps: number | null;
  executableNotionalUsd: number | null;
  profitLadderMaxNotionalUsd: number;
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Lexicographic priority comparison. A lower-priority gain may never compensate
 * for worse market truth or worse deterministic economics.
 */
export function compareCryptaraDecisionVectors(
  left: CryptaraPriorityDecisionVector,
  right: CryptaraPriorityDecisionVector,
): number {
  if (left.marketTruthReady !== right.marketTruthReady) return Number(right.marketTruthReady) - Number(left.marketTruthReady);
  if (left.marketTruthScore !== right.marketTruthScore) return right.marketTruthScore - left.marketTruthScore;

  const leftNet = finite(left.deterministicNetProfitUsd) ?? Number.NEGATIVE_INFINITY;
  const rightNet = finite(right.deterministicNetProfitUsd) ?? Number.NEGATIVE_INFINITY;
  const leftPositive = leftNet > 0;
  const rightPositive = rightNet > 0;
  if (leftPositive !== rightPositive) return Number(rightPositive) - Number(leftPositive);

  const leftBps = finite(left.netProfitBps) ?? Number.NEGATIVE_INFINITY;
  const rightBps = finite(right.netProfitBps) ?? Number.NEGATIVE_INFINITY;
  if (leftBps !== rightBps) return rightBps - leftBps;

  const leftGap = Math.max(0, finite(left.bpsToBreakEven) ?? Number.POSITIVE_INFINITY);
  const rightGap = Math.max(0, finite(right.bpsToBreakEven) ?? Number.POSITIVE_INFINITY);
  if (leftGap !== rightGap) return leftGap - rightGap;

  const leftLatency = Math.max(0, finite(left.latencyMs) ?? Number.POSITIVE_INFINITY);
  const rightLatency = Math.max(0, finite(right.latencyMs) ?? Number.POSITIVE_INFINITY);
  if (leftLatency !== rightLatency) return leftLatency - rightLatency;

  const leftSlip = Math.max(0, finite(left.slippageBps) ?? Number.POSITIVE_INFINITY);
  const rightSlip = Math.max(0, finite(right.slippageBps) ?? Number.POSITIVE_INFINITY);
  if (leftSlip !== rightSlip) return leftSlip - rightSlip;

  const leftNotional = Math.min(
    Math.max(0, finite(left.executableNotionalUsd) ?? 0),
    Math.max(0, finite(left.profitLadderMaxNotionalUsd) ?? 0),
  );
  const rightNotional = Math.min(
    Math.max(0, finite(right.executableNotionalUsd) ?? 0),
    Math.max(0, finite(right.profitLadderMaxNotionalUsd) ?? 0),
  );
  return rightNotional - leftNotional;
}

export function getCryptaraDecisionPriorityList() {
  return CRYPTARA_DECISION_PRIORITIES.map(priority => ({ ...priority }));
}
