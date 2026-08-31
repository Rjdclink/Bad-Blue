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

function comparisonTolerance(...values: number[]): number {
  const scale = Math.max(...values.filter(Number.isFinite).map(value => Math.abs(value)), Number.MIN_VALUE);
  return scale * Number.EPSILON * 32;
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

function validateCoinbaseOrderAgainstProductInternal(
  request: CoinbaseOrderConstraintInput,
  constraints: CoinbaseAdvancedProductConstraints,
  mode: 'taker_ioc' | 'maker_post_only',
): CoinbaseOrderConstraintResult {
  const hardBlocked = constraints.isDisabled
    || constraints.tradingDisabled
    || constraints.cancelOnly
    || constraints.auctionMode
    || constraints.viewOnly;
  if (hardBlocked || (mode === 'taker_ioc' && constraints.postOnly)) {
    return {
      valid: false,
      reason: constraints.auctionMode
        ? 'Coinbase product is in auction mode and cannot satisfy the requested execution semantics'
        : mode === 'taker_ioc'
          ? 'Coinbase product is not currently available for taker IOC execution'
          : 'Coinbase product is not currently available for post-only maker execution',
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
  const baseTolerance = comparisonTolerance(request.quantity, constraints.baseMinSize, constraints.baseMaxSize ?? 0);
  if (request.quantity + baseTolerance < constraints.baseMinSize) {
    return { valid: false, reason: `Coinbase base quantity is below minimum ${constraints.baseMinSize}` };
  }
  if (constraints.baseMaxSize !== null && request.quantity > constraints.baseMaxSize + baseTolerance) {
    return { valid: false, reason: `Coinbase base quantity exceeds maximum ${constraints.baseMaxSize}` };
  }
  const quoteNotional = request.quantity * request.price;
  const quoteTolerance = comparisonTolerance(quoteNotional, constraints.quoteMinSize, constraints.quoteMaxSize ?? 0);
  if (!Number.isFinite(quoteNotional) || quoteNotional + quoteTolerance < constraints.quoteMinSize) {
    return { valid: false, reason: `Coinbase quote notional is below minimum ${constraints.quoteMinSize}` };
  }
  if (constraints.quoteMaxSize !== null && quoteNotional > constraints.quoteMaxSize + quoteTolerance) {
    return { valid: false, reason: `Coinbase quote notional exceeds maximum ${constraints.quoteMaxSize}` };
  }
  return { valid: true, reason: null };
}

export function validateCoinbaseOrderAgainstProduct(
  request: CoinbaseOrderConstraintInput,
  constraints: CoinbaseAdvancedProductConstraints,
): CoinbaseOrderConstraintResult {
  return validateCoinbaseOrderAgainstProductInternal(request, constraints, 'taker_ioc');
}

/**
 * Maker validation shares the same live product, increment and size authority as
 * IOC validation, but an exchange-declared post-only product is not a blocker for
 * a post-only order. This does not grant any execution authority by itself.
 */
export function validateCoinbasePostOnlyOrderAgainstProduct(
  request: CoinbaseOrderConstraintInput,
  constraints: CoinbaseAdvancedProductConstraints,
): CoinbaseOrderConstraintResult {
  return validateCoinbaseOrderAgainstProductInternal(request, constraints, 'maker_post_only');
}
