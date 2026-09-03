import type { StreamOrderBookQuote } from './cex-order-book-stream.js';

export interface MakerTickQueueDecision {
  side: 'buy' | 'sell';
  currentPrice: number;
  suggestedPrice: number;
  tickSize: number;
  priceImprovementBps: number;
  queueJumpPotential: boolean;
  expectedQueueValueBps: number;
  reason: string;
  authority: 'maker_tick_queue_advisory_only';
  executionAuthority: false;
  economicBpsAuthority: false;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundToTick(value: number, tickSize: number, direction: 'down' | 'up'): number {
  if (!(tickSize > 0)) return value;
  const units = value / tickSize;
  const rounded = direction === 'down' ? Math.floor(units + 1e-10) : Math.ceil(units - 1e-10);
  return Number((rounded * tickSize).toPrecision(15));
}

/**
 * Advisory-only queue-jump valuation. A one-tick price improvement is proposed
 * only when it remains strictly non-marketable. The estimated queue value is a
 * search/ranking signal, never a fabricated realized BPS saving.
 */
export function evaluateMakerTickQueueJump(input: {
  quote: StreamOrderBookQuote;
  side: 'buy' | 'sell';
  tickSize: number;
  rawFillProbability: number;
}): MakerTickQueueDecision {
  const { quote, side } = input;
  const tickSize = Number(input.tickSize);
  const rawFillProbability = clamp(Number(input.rawFillProbability) || 0, 0, 1);
  const currentPrice = side === 'buy' ? quote.bid : quote.ask;
  if (!(tickSize > 0) || !(currentPrice > 0) || !(quote.bid > 0) || !(quote.ask > quote.bid)) {
    return {
      side,
      currentPrice,
      suggestedPrice: currentPrice,
      tickSize,
      priceImprovementBps: 0,
      queueJumpPotential: false,
      expectedQueueValueBps: 0,
      reason: 'invalid_tick_or_spread',
      authority: 'maker_tick_queue_advisory_only',
      executionAuthority: false,
      economicBpsAuthority: false,
    };
  }

  const candidate = side === 'buy'
    ? roundToTick(currentPrice + tickSize, tickSize, 'down')
    : roundToTick(currentPrice - tickSize, tickSize, 'up');
  const nonMarketable = side === 'buy' ? candidate < quote.ask : candidate > quote.bid;
  if (!nonMarketable || candidate <= 0 || Math.abs(candidate - currentPrice) < tickSize * 0.5) {
    return {
      side,
      currentPrice,
      suggestedPrice: currentPrice,
      tickSize,
      priceImprovementBps: 0,
      queueJumpPotential: false,
      expectedQueueValueBps: 0,
      reason: 'one_tick_improvement_would_cross_or_not_change_price',
      authority: 'maker_tick_queue_advisory_only',
      executionAuthority: false,
      economicBpsAuthority: false,
    };
  }

  const priceImprovementBps = Math.abs(candidate - currentPrice) / currentPrice * 10_000;
  // A queue jump spends one tick of quoted edge to potentially improve fill
  // probability. Value only the unfilled-probability portion so already-high
  // fill routes are not over-prioritized. This remains advisory until terminal
  // evidence calibrates the actual fill response.
  const expectedQueueValueBps = Math.max(0, priceImprovementBps * (1 - rawFillProbability));
  return {
    side,
    currentPrice,
    suggestedPrice: candidate,
    tickSize,
    priceImprovementBps,
    queueJumpPotential: true,
    expectedQueueValueBps,
    reason: 'one_tick_non_marketable_queue_jump_available',
    authority: 'maker_tick_queue_advisory_only',
    executionAuthority: false,
    economicBpsAuthority: false,
  };
}
