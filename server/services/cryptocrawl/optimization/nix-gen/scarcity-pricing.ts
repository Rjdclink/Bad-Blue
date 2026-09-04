import type { NixGenOptimizationResult, NixGenStrategyBid } from './types.js';

const EPSILON = 1e-9;

export type NixGenScarcityBand = 'idle' | 'normal' | 'elevated' | 'scarce' | 'saturated';

export interface NixGenScarcityPrice {
  resourceKey: string;
  used: number;
  capacity: number;
  utilization: number;
  headroomUnits: number;
  /** Heuristic congestion/scarcity diagnostic only; not a dual-derived shadow price. */
  normalizedScarcitySignal: number;
  band: NixGenScarcityBand;
}

export interface NixGenScarcitySnapshot {
  generatedAt: number;
  authority: 'nix_gen_advisory_scarcity';
  executionAuthority: false;
  resourceAuthority: false;
  prices: NixGenScarcityPrice[];
  priceIndex: Readonly<Record<string, number>>;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function utilizationFor(used: number, capacity: number): number {
  if (capacity <= EPSILON) return 1;
  return clamp01(used / capacity);
}

function normalizedScarcitySignal(utilization: number): number {
  // Advisory congestion signal only. Hard resource truth remains owned by the
  // canonical resource schedulers. This is intentionally not called a shadow
  // price because no dual optimization model produced it.
  if (utilization <= 0.5) return 0;
  const normalizedPressure = clamp01((utilization - 0.5) / 0.5);
  return normalizedPressure * normalizedPressure;
}

function scarcityBand(utilization: number): NixGenScarcityBand {
  if (utilization >= 1 - EPSILON) return 'saturated';
  if (utilization >= 0.85) return 'scarce';
  if (utilization >= 0.65) return 'elevated';
  if (utilization >= 0.35) return 'normal';
  return 'idle';
}

export function deriveNixGenScarcitySnapshot(result: NixGenOptimizationResult): NixGenScarcitySnapshot {
  const prices = result.resourceUsage.map(resource => {
    const utilization = utilizationFor(resource.used, resource.capacity);
    return {
      resourceKey: resource.resourceKey,
      used: resource.used,
      capacity: resource.capacity,
      utilization,
      headroomUnits: Math.max(0, resource.capacity - resource.used),
      normalizedScarcitySignal: normalizedScarcitySignal(utilization),
      band: scarcityBand(utilization),
    } satisfies NixGenScarcityPrice;
  });

  return {
    generatedAt: result.generatedAt,
    authority: 'nix_gen_advisory_scarcity',
    executionAuthority: false,
    resourceAuthority: false,
    prices,
    priceIndex: Object.fromEntries(prices.map(price => [price.resourceKey, price.normalizedScarcitySignal])),
  };
}

export function nixGenBidScarcityBurden(
  bid: NixGenStrategyBid,
  snapshot: NixGenScarcitySnapshot,
): number {
  const byKey = new Map(snapshot.prices.map(price => [price.resourceKey, price]));
  let burden = 0;
  for (const demand of bid.resources) {
    const price = byKey.get(demand.resourceKey);
    if (!price || !Number.isFinite(demand.units) || demand.units <= 0) continue;
    const normalizedUnits = demand.units / Math.max(EPSILON, price.capacity);
    burden += price.normalizedScarcitySignal * normalizedUnits;
  }
  return Math.max(0, burden);
}
