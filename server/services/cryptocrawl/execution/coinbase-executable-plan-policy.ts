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
 * Normalize a Coinbase-participating PARENT plan without allowing a single-order
 * product maximum to truncate the parent target. Per-order base_max_size and
 * quote_max_size are execution constraints for the child-order planner. The
 * parent remains the already-measured depth/profit target and may later be split
 * into FOK child pairs whose individual sizes satisfy current Coinbase limits.
 *
 * We still align the parent quantity to the live base increment and verify the
 * product/trading state by validating one legal child-sized quantity. Price is
 * never rounded. Smaller increment normalization receives a fresh deterministic
 * economics calculation; no better price or liquidity is invented.
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

  const normalizedQuantity = floorToIncrement(plan.baseQty, constraints.baseIncrement);
  if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) return null;

  // Validate current product state with the largest legal single child that could
  // be submitted. Parent oversize is intentionally NOT rejected here; it is split
  // downstream. This preserves Coinbase's live maximum as a per-order authority,
  // not a competing strategy/notional authority.
  let legalChildQuantity = normalizedQuantity;
  if (constraints.baseMaxSize !== null) legalChildQuantity = Math.min(legalChildQuantity, constraints.baseMaxSize);
  if (constraints.quoteMaxSize !== null) legalChildQuantity = Math.min(legalChildQuantity, constraints.quoteMaxSize / coinbasePrice);
  legalChildQuantity = floorToIncrement(legalChildQuantity, constraints.baseIncrement);
  if (!(legalChildQuantity > 0)) return null;

  const constraintCheck = validateCoinbaseOrderAgainstProduct(
    { quantity: legalChildQuantity, price: coinbasePrice },
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
