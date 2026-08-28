export interface AtomicSizeSearchInput {
  seedNotionalUsd: number;
  maximumNotionalUsd: number;
  minimumNotionalUsd?: number;
  maxCandidates?: number;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
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
    // Stablecoin routes use six decimal places, so preserve cent-level sizing
    // while avoiding floating-point key noise.
    candidates.add(Math.round(bounded * 1_000_000) / 1_000_000);
  }

  const sorted = [...candidates].sort((left, right) => left - right);
  if (sorted.length <= limit) return sorted;

  // Preserve both tails, the seed neighborhood and the absolute cap instead of
  // truncating only the largest or smallest sizes.
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
