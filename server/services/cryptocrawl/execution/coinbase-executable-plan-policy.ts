import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { getCoinbaseAdvancedProductConstraints } from '../intelligence/coinbase-advanced-market-data.js';
import { floorToIncrement, validateCoinbaseOrderAgainstProduct } from './coinbase-product-policy.js';

function feeBps(plan: VerifiedArbitragePlan, side: 'buy' | 'sell'): number | null {
  const evidence = side === 'buy' ? plan.feeEvidence?.buy : plan.feeEvidence?.sell;
  const value = Number(evidence?.takerFeeBps);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function feeUsd(notionalUsd: number, bps: number): number {
  return notionalUsd * bps / 10_000;
}

/**
 * Coinbase product constraints are part of deterministic execution economics.
 * The plan is allowed to shrink to the nearest valid base increment because the
 * original depth-derived average prices are conservative for a smaller quantity:
 * consuming fewer asks cannot worsen the buy average and consuming fewer bids
 * cannot worsen the sell average. Price is never silently rounded; if the book
 * limit price is not a valid Coinbase price increment the plan fails closed.
 */
export async function normalizeCoinbaseExecutablePlan(
  plan: VerifiedArbitragePlan,
): Promise<VerifiedArbitragePlan | null> {
  const coinbaseSide = plan.buyVenue === 'coinbase'
    ? 'buy'
    : plan.sellVenue === 'coinbase' ? 'sell' : null;
  if (!coinbaseSide) return plan;

  const constraints = await getCoinbaseAdvancedProductConstraints(plan.symbol);
  const coinbasePrice = coinbaseSide === 'buy'
    ? plan.buyLimitPrice ?? plan.buyAsk
    : plan.sellLimitPrice ?? plan.sellBid;
  if (!Number.isFinite(coinbasePrice) || coinbasePrice <= 0) return null;

  let quantityUpperBound = plan.baseQty;
  if (constraints.baseMaxSize !== null) quantityUpperBound = Math.min(quantityUpperBound, constraints.baseMaxSize);
  if (constraints.quoteMaxSize !== null) quantityUpperBound = Math.min(quantityUpperBound, constraints.quoteMaxSize / coinbasePrice);
  const normalizedQuantity = floorToIncrement(quantityUpperBound, constraints.baseIncrement);
  if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) return null;

  const constraintCheck = validateCoinbaseOrderAgainstProduct(
    { quantity: normalizedQuantity, price: coinbasePrice },
    constraints,
  );
  if (!constraintCheck.valid) return null;

  const buyFeeBps = feeBps(plan, 'buy');
  const sellFeeBps = feeBps(plan, 'sell');
  if (buyFeeBps === null || sellFeeBps === null) return null;

  const acquisitionCostUsd = normalizedQuantity * plan.buyAsk;
  const proceedsUsd = normalizedQuantity * plan.sellBid;
  const buyFeeUsd = feeUsd(acquisitionCostUsd, buyFeeBps);
  const sellFeeUsd = feeUsd(proceedsUsd, sellFeeBps);
  const fixedCostsUsd = plan.costs.gasUsd + plan.costs.bridgeFeeUsd + (plan.costs.transferFeeUsd ?? 0);
  const totalCostsUsd = buyFeeUsd + sellFeeUsd + fixedCostsUsd;
  const grossProfitUsd = proceedsUsd - acquisitionCostUsd;
  const netProfitUsd = grossProfitUsd - totalCostsUsd;
  if (!Number.isFinite(netProfitUsd) || netProfitUsd <= 0) return null;

  return {
    ...plan,
    baseQty: normalizedQuantity,
    notionalUsd: acquisitionCostUsd,
    executableNotionalUsd: acquisitionCostUsd,
    grossProfitUsd,
    netProfitUsd,
    costs: {
      ...plan.costs,
      buyFeeUsd,
      sellFeeUsd,
      totalCostsUsd,
    },
  };
}
