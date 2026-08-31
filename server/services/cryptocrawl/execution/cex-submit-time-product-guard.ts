import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { isIncrementAligned } from './coinbase-product-policy.js';
import {
  getSpotProductConstraints,
  type ConstrainedSpotVenue,
  type SpotProductConstraints,
} from './cex-spot-product-policy.js';

function validateLeg(
  side: 'buy' | 'sell',
  quantity: number,
  price: number,
  constraint: SpotProductConstraints,
): void {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) {
    throw new Error(`REJECT_PRODUCT_DRIFT: ${constraint.venue} ${side} order values are invalid`);
  }
  if (!isIncrementAligned(quantity, constraint.baseIncrement)) {
    throw new Error(`REJECT_PRODUCT_DRIFT: ${constraint.venue} ${side} quantity no longer aligns to lot increment ${constraint.baseIncrement}`);
  }
  if (!isIncrementAligned(price, constraint.priceIncrement)) {
    throw new Error(`REJECT_PRODUCT_DRIFT: ${constraint.venue} ${side} price no longer aligns to tick increment ${constraint.priceIncrement}`);
  }
  if (quantity + constraint.baseIncrement * 1e-7 < constraint.baseMinSize) {
    throw new Error(`REJECT_PRODUCT_DRIFT: ${constraint.venue} ${side} quantity is below current minimum ${constraint.baseMinSize}`);
  }
  if (constraint.quoteMinSize !== null && quantity * price + constraint.baseIncrement * constraint.priceIncrement < constraint.quoteMinSize) {
    throw new Error(`REJECT_PRODUCT_DRIFT: ${constraint.venue} ${side} notional is below current quote minimum ${constraint.quoteMinSize}`);
  }
  if (constraint.baseMaxSize !== null && quantity > constraint.baseMaxSize + constraint.baseIncrement * 1e-7) {
    throw new Error(`REJECT_PRODUCT_DRIFT: ${constraint.venue} ${side} quantity exceeds current single-order maximum ${constraint.baseMaxSize}`);
  }
  if (constraint.quoteMaxSize !== null && quantity * price > constraint.quoteMaxSize + constraint.baseIncrement * constraint.priceIncrement) {
    throw new Error(`REJECT_PRODUCT_DRIFT: ${constraint.venue} ${side} notional exceeds current single-order maximum ${constraint.quoteMaxSize}`);
  }
}

async function freshConstraint(venue: ConstrainedSpotVenue, symbol: string): Promise<SpotProductConstraints> {
  try {
    return await getSpotProductConstraints(venue, symbol, true);
  } catch (error) {
    throw new Error(`REJECT_PRODUCT_DRIFT: ${venue} ${symbol} live product refresh failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Immediately before order submission, re-read the same canonical live product
 * authority used by planning. There is no second symbol parser or product route
 * here: product identity, venue aliases, increments, minimums and per-order
 * maximums all come from cex-spot-product-policy.
 *
 * Validation-only: no plan resizing or economic mutation occurs after approval.
 */
export async function assertFreshCexProductConstraints(plan: VerifiedArbitragePlan): Promise<void> {
  const checks: Array<Promise<{ side: 'buy' | 'sell'; constraint: SpotProductConstraints }>> = [];
  if (plan.buyVenue === 'kraken' || plan.buyVenue === 'okx') {
    checks.push(freshConstraint(plan.buyVenue, plan.symbol).then(constraint => ({ side: 'buy' as const, constraint })));
  }
  if (plan.sellVenue === 'kraken' || plan.sellVenue === 'okx') {
    checks.push(freshConstraint(plan.sellVenue, plan.symbol).then(constraint => ({ side: 'sell' as const, constraint })));
  }

  const constraints = await Promise.all(checks);
  for (const { side, constraint } of constraints) {
    const price = side === 'buy' ? (plan.buyLimitPrice ?? plan.buyAsk) : (plan.sellLimitPrice ?? plan.sellBid);
    validateLeg(side, plan.baseQty, price, constraint);
  }
}