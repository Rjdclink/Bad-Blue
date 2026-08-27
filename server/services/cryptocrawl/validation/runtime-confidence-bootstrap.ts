import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';

export const DEFAULT_RUNTIME_CONFIDENCE_SUCCESS_THRESHOLD = 10;

export type RuntimeConfidenceBootstrapState = 'bootstrap' | 'calibrated';

export interface RuntimeConfidenceBootstrapStatus {
  state: RuntimeConfidenceBootstrapState;
  confidenceEnabled: boolean;
  successfulTrades: number;
  requiredSuccessfulTrades: number;
  remainingSuccessfulTrades: number;
  startedAt: number;
}

function normalizeThreshold(value: number): number {
  return Number.isFinite(value) && value >= 1
    ? Math.max(1, Math.floor(value))
    : DEFAULT_RUNTIME_CONFIDENCE_SUCCESS_THRESHOLD;
}

function qualifies(feedback: CryptaraExecutionFeedback): boolean {
  if (feedback.success !== true || feedback.settlementConfirmed !== true) return false;
  if (feedback.realizedProfitUsd === null || !Number.isFinite(feedback.realizedProfitUsd) || feedback.realizedProfitUsd <= 0) return false;
  if (feedback.settlement && feedback.settlement.terminal !== true) return false;
  return true;
}

function successKey(feedback: CryptaraExecutionFeedback): string {
  const transactionHash = feedback.settlement?.transactionHash?.trim().toLowerCase();
  if (transactionHash) return `tx:${feedback.chain}:${transactionHash}`;

  const orderIds = feedback.settlement?.orders
    ?.map(order => `${order.venue}:${order.orderId}`)
    .filter(Boolean)
    .sort();
  if (orderIds && orderIds.length > 0) return `orders:${feedback.chain}:${orderIds.join('|')}`;

  return [
    'execution',
    feedback.opportunityId || 'unknown-opportunity',
    feedback.chain,
    feedback.symbol,
    feedback.timestamp,
    feedback.realizedProfitUsd,
    feedback.latencyMs,
  ].join(':');
}

export class RuntimeConfidenceBootstrapCounter {
  private readonly requiredSuccessfulTrades: number;
  private readonly startedAt = Date.now();
  private readonly successfulTradeKeys = new Set<string>();
  private successfulTrades = 0;

  constructor(requiredSuccessfulTrades = DEFAULT_RUNTIME_CONFIDENCE_SUCCESS_THRESHOLD) {
    this.requiredSuccessfulTrades = normalizeThreshold(requiredSuccessfulTrades);
  }

  record(feedback: CryptaraExecutionFeedback): RuntimeConfidenceBootstrapStatus {
    if (this.successfulTrades >= this.requiredSuccessfulTrades || !qualifies(feedback)) return this.getStatus();
    const key = successKey(feedback);
    if (this.successfulTradeKeys.has(key)) return this.getStatus();
    this.successfulTradeKeys.add(key);
    this.successfulTrades += 1;
    return this.getStatus();
  }

  getStatus(): RuntimeConfidenceBootstrapStatus {
    const confidenceEnabled = this.successfulTrades >= this.requiredSuccessfulTrades;
    return {
      state: confidenceEnabled ? 'calibrated' : 'bootstrap',
      confidenceEnabled,
      successfulTrades: this.successfulTrades,
      requiredSuccessfulTrades: this.requiredSuccessfulTrades,
      remainingSuccessfulTrades: Math.max(0, this.requiredSuccessfulTrades - this.successfulTrades),
      startedAt: this.startedAt,
    };
  }
}
