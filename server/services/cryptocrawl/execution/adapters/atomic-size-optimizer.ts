export interface AtomicSizeSearchInput {
  seedNotionalUsd: number;
  maximumNotionalUsd: number;
  minimumNotionalUsd?: number;
  maxCandidates?: number;
}

export interface AtomicSizeRefinementInput {
  coarseCandidates: readonly number[];
  bestNotionalUsd: number;
  minimumNotionalUsd?: number;
  maximumNotionalUsd: number;
  maxCandidates?: number;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizedUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Build a bounded quote-size curve. No linear-profit assumption is made: every
 * returned size must be quoted independently by the venue/pool path and compared
 * on actual all-in net profit. The one-cent lower bound is representational only,
 * not a profit threshold.
 */
export function buildAtomicNotionalCandidates(input: AtomicSizeSearchInput): number[] {
  const seed = finitePositive(input.seedNotionalUsd, 1);
  const maximum = Math.max(seed > input.maximumNotionalUsd ? input.maximumNotionalUsd : seed, finitePositive(input.maximumNotionalUsd, seed));
  const minimum = Math.max(0.01, finitePositive(input.minimumNotionalUsd ?? 0.01, 0.01));
  const limit = Math.max(3, Math.min(16, Math.floor(finitePositive(input.maxCandidates ?? 10, 10))));

  const candidates = new Set<number>();
  const anchors = [
    minimum,
    seed * 0.1,
    seed * 0.25,
    seed * 0.5,
    seed * 0.75,
    seed,
    seed * 1.5,
    seed * 2,
    seed * 3,
    seed * 5,
    maximum,
  ];
  for (const raw of anchors) {
    if (!Number.isFinite(raw) || raw <= 0) continue;
    const bounded = Math.max(minimum, Math.min(maximum, raw));
    candidates.add(normalizedUsd(bounded));
  }

  const sorted = [...candidates].sort((left, right) => left - right);
  if (sorted.length <= limit) return sorted;

  const selected = new Set<number>([sorted[0], sorted[sorted.length - 1]]);
  const seedIndex = sorted.reduce((best, value, index) =>
    Math.abs(value - seed) < Math.abs(sorted[best] - seed) ? index : best, 0);
  selected.add(sorted[seedIndex]);
  for (let step = 1; selected.size < limit; step++) {
    const lower = seedIndex - step;
    const upper = seedIndex + step;
    if (lower >= 0) selected.add(sorted[lower]);
    if (selected.size >= limit) break;
    if (upper < sorted.length) selected.add(sorted[upper]);
    if (lower < 0 && upper >= sorted.length) break;
  }
  return [...selected].sort((left, right) => left - right);
}

/**
 * Second-stage size search around the best independently quoted coarse point.
 * This does not interpolate or manufacture economics. It only chooses a small
 * set of additional notionals between the winning coarse point and its measured
 * neighbors; every returned value still requires a fresh route quote.
 */
export function buildAtomicNotionalRefinementCandidates(input: AtomicSizeRefinementInput): number[] {
  const minimum = Math.max(0.01, finitePositive(input.minimumNotionalUsd ?? 0.01, 0.01));
  const maximum = Math.max(minimum, finitePositive(input.maximumNotionalUsd, minimum));
  const best = Math.max(minimum, Math.min(maximum, finitePositive(input.bestNotionalUsd, minimum)));
  const limit = Math.max(0, Math.min(6, Math.floor(Number.isFinite(input.maxCandidates) ? Number(input.maxCandidates) : 4)));
  if (limit === 0) return [];

  const coarse = [...new Set(input.coarseCandidates
    .filter(value => Number.isFinite(value) && value > 0)
    .map(value => normalizedUsd(Math.max(minimum, Math.min(maximum, value)))))]
    .sort((left, right) => left - right);
  const existing = new Set(coarse);
  const insertion = coarse.findIndex(value => value >= best);
  const bestIndex = insertion >= 0 && Math.abs(coarse[insertion] - best) < 1e-9
    ? insertion
    : Math.max(0, Math.min(coarse.length - 1, insertion < 0 ? coarse.length - 1 : insertion));
  const lower = bestIndex > 0 ? coarse[bestIndex - 1] : minimum;
  const upper = bestIndex < coarse.length - 1 ? coarse[bestIndex + 1] : maximum;
  const candidates = new Set<number>();

  // Concentrate the limited extra quote budget close to the measured winner.
  for (const fraction of [0.5, 0.25, 0.75]) {
    if (lower < best) candidates.add(normalizedUsd(lower + (best - lower) * fraction));
    if (best < upper) candidates.add(normalizedUsd(best + (upper - best) * fraction));
  }

  return [...candidates]
    .filter(value => value >= minimum && value <= maximum && !existing.has(value) && Math.abs(value - best) > 1e-9)
    .sort((left, right) => Math.abs(left - best) - Math.abs(right - best) || left - right)
    .slice(0, limit)
    .sort((left, right) => left - right);
}

export function selectHighestNetProfit<T>(
  values: readonly T[],
  netProfit: (value: T) => number | bigint,
): T | null {
  let best: T | null = null;
  for (const value of values) {
    const profit = netProfit(value);
    const positive = typeof profit === 'bigint' ? profit > 0n : Number.isFinite(profit) && profit > 0;
    if (!positive) continue;
    if (best === null) {
      best = value;
      continue;
    }
    const current = netProfit(best);
    if (typeof profit === 'bigint' && typeof current === 'bigint' ? profit > current : Number(profit) > Number(current)) best = value;
  }
  return best;
}
