import type { CoinbaseAdvancedProductConstraints } from '../intelligence/coinbase-advanced-market-data.js';

export interface CoinbaseOrderConstraintInput {
  quantity: number;
  price: number;
}

export interface CoinbaseOrderConstraintResult {
  valid: boolean;
  reason: string | null;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function floorToIncrement(value: number, increment: number): number {
  if (!finitePositive(value) || !finitePositive(increment)) return 0;
  const units = Math.floor(value / increment + 1e-10);
  if (!Number.isFinite(units) || units <= 0) return 0;
  const normalized = units * increment;
  return Number(normalized.toPrecision(15));
}

export function isIncrementAligned(value: number, increment: number): boolean {
  if (!finitePositive(value) || !finitePositive(increment)) return false;
  const units = value / increment;
  if (!Number.isFinite(units)) return false;
  const nearest = Math.round(units) * increment;
  const tolerance = Math.max(increment * 1e-7, Math.abs(value) * Number.EPSILON * 16);
  return Math.abs(value - nearest) <= tolerance;
}

export function validateCoinbaseOrderAgainstProduct(
  request: CoinbaseOrderConstraintInput,
  constraints: CoinbaseAdvancedProductConstraints,
): CoinbaseOrderConstraintResult {
  if (constraints.isDisabled || constraints.tradingDisabled || constraints.cancelOnly || constraints.postOnly || constraints.viewOnly) {
    return {
      valid: false,
      reason: 'Coinbase product is not currently available for taker IOC execution',
    };
  }
  if (!finitePositive(request.quantity) || !finitePositive(request.price)) {
    return { valid: false, reason: 'Coinbase order quantity and price must be finite and positive' };
  }
  if (!isIncrementAligned(request.quantity, constraints.baseIncrement)) {
    return { valid: false, reason: `Coinbase base quantity is not aligned to ${constraints.baseIncrement}` };
  }
  if (!isIncrementAligned(request.price, constraints.priceIncrement)) {
    return { valid: false, reason: `Coinbase limit price is not aligned to ${constraints.priceIncrement}` };
  }
  if (request.quantity + 1e-12 < constraints.baseMinSize) {
    return { valid: false, reason: `Coinbase base quantity is below minimum ${constraints.baseMinSize}` };
  }
  if (constraints.baseMaxSize !== null && request.quantity > constraints.baseMaxSize + 1e-12) {
    return { valid: false, reason: `Coinbase base quantity exceeds maximum ${constraints.baseMaxSize}` };
  }
  const quoteNotional = request.quantity * request.price;
  if (!Number.isFinite(quoteNotional) || quoteNotional + 1e-12 < constraints.quoteMinSize) {
    return { valid: false, reason: `Coinbase quote notional is below minimum ${constraints.quoteMinSize}` };
  }
  if (constraints.quoteMaxSize !== null && quoteNotional > constraints.quoteMaxSize + 1e-12) {
    return { valid: false, reason: `Coinbase quote notional exceeds maximum ${constraints.quoteMaxSize}` };
  }
  return { valid: true, reason: null };
}
