import type { CexModeEconomics } from '../intelligence/cex-four-mode-matrix.js';

export interface AdaptiveProfitabilitySearchPolicy {
  orderedSymbols: string[];
  symbolLimit: number;
  scanIntervalMs: number;
  recoverySymbols: string[];
  explorationSymbols: string[];
  closestGapBps: number | null;
  closestRiskGapBps: number | null;
  hybridRecoverySymbols: string[];
  staleEvidenceSymbols: string[];
  authority: 'measured_search_scheduling_only';
  executionAuthority: false;
}

const lastFocusedAt = new Map<string, number>();
const lastFocusedGap = new Map<string, number>();

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function riskGap(item: CexModeEconomics): number {
  return finite((item as any).riskAdjustedBpsToBreakEven) ?? item.bpsToBreakEven;
}

function feeFreshness(item: CexModeEconomics): number {
  return clamp(finite((item as any).feeFreshnessScore) ?? 1, 0, 1);
}

function recoveryScore(item: CexModeEconomics, now: number): number {
  const gap = Math.max(0.01, item.bpsToBreakEven);
  const adjustedGap = Math.max(gap, riskGap(item));
  const efficiency = Math.max(0, finite(item.recoveryEfficiency) ?? 0);
  const freshness = feeFreshness(item);
  const makerSavings = Math.max(0, finite((item as any).makerFeeSavingsVsTakerBps) ?? 0);
  const grossSpread = Math.max(0, finite(item.grossSpreadBps) ?? 0);
  const combinedFees = Math.max(0.01, finite(item.combinedFeeBps) ?? 0.01);
  const feeCoverage = clamp(grossSpread / combinedFees, 0, 2);
  const lastAt = lastFocusedAt.get(item.symbol) ?? 0;
  const ageMs = Math.max(0, now - lastAt);
  const cooldownMs = clamp(Number(process.env.CRYPTOCRAWL_RECOVERY_SYMBOL_COOLDOWN_MS || 5_000), 1_000, 60_000);
  const cooldownFactor = lastAt === 0 ? 1 : clamp(ageMs / cooldownMs, 0.15, 1);
  const previousGap = lastFocusedGap.get(item.symbol);
  const improvementBoost = previousGap !== undefined && gap < previousGap ? 1.25 : 1;
  const hybridBoost = item.mode === 'MT' || item.mode === 'TM' ? 1.15 : 1;
  const makerSavingsBoost = 1 + Math.min(0.75, makerSavings / Math.max(1, gap) * 0.25);
  return (1 / adjustedGap)
    * (0.35 + 0.65 * freshness)
    * (1 + Math.min(1.5, efficiency))
    * (0.5 + 0.5 * Math.min(1.5, feeCoverage))
    * cooldownFactor
    * improvementBoost
    * hybridBoost
    * makerSavingsBoost;
}

function bestNearMissBySymbol(modes: readonly CexModeEconomics[]): CexModeEconomics[] {
  const best = new Map<string, CexModeEconomics>();
  for (const item of modes) {
    if (item.economicallyPositive || !Number.isFinite(item.bpsToBreakEven)) continue;
    const current = best.get(item.symbol);
    if (!current || riskGap(item) < riskGap(current) || (riskGap(item) === riskGap(current) && item.bpsToBreakEven < current.bpsToBreakEven)) {
      best.set(item.symbol, item);
    }
  }
  return [...best.values()];
}

function quoteAsset(symbol: string): string {
  const normalized = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (const suffix of ['USDT', 'USDC', 'USD', 'BTC', 'ETH']) {
    if (normalized.endsWith(suffix)) return suffix;
  }
  return 'OTHER';
}

function diversifyRecoverySymbols(ranked: readonly CexModeEconomics[], limit: number): string[] {
  const selected: string[] = [];
  const perQuoteAsset = new Map<string, number>();
  const quoteAssetCap = Math.max(2, Math.ceil(limit / 2));
  for (const item of ranked) {
    if (selected.length >= limit) break;
    const asset = quoteAsset(item.symbol);
    const used = perQuoteAsset.get(asset) || 0;
    if (used >= quoteAssetCap) continue;
    selected.push(item.symbol);
    perQuoteAsset.set(asset, used + 1);
  }
  for (const item of ranked) {
    if (selected.length >= limit) break;
    if (!selected.includes(item.symbol)) selected.push(item.symbol);
  }
  return selected;
}

export function buildAdaptiveProfitabilitySearchPolicy(input: {
  universeSymbols: readonly string[];
  latestModes: readonly CexModeEconomics[];
  baseSymbolLimit: number;
  baseIntervalMs: number;
  now?: number;
}): AdaptiveProfitabilitySearchPolicy {
  const now = input.now ?? Date.now();
  const nearMisses = bestNearMissBySymbol(input.latestModes);
  const ranked = [...nearMisses].sort((left, right) => recoveryScore(right, now) - recoveryScore(left, now));
  const closestGapBps = ranked.length > 0 ? Math.min(...ranked.map(item => item.bpsToBreakEven)) : null;
  const closestRiskGapBps = ranked.length > 0 ? Math.min(...ranked.map(riskGap)) : null;

  const expansion = closestGapBps !== null && closestGapBps <= 5 ? 24
    : closestGapBps !== null && closestGapBps <= 10 ? 16
      : closestGapBps !== null && closestGapBps <= 25 ? 8
        : 0;
  const symbolLimit = Math.max(4, Math.min(96, Math.trunc(input.baseSymbolLimit + expansion)));

  const recoveryQuota = Math.min(
    Math.max(4, Math.floor(symbolLimit * (closestGapBps !== null && closestGapBps <= 10 ? 0.6 : 0.4))),
    ranked.length,
  );
  const recoverySymbols = diversifyRecoverySymbols(ranked, recoveryQuota);

  const hybridRecoverySymbols = [...new Set(ranked
    .filter(item => item.mode === 'MT' || item.mode === 'TM')
    .slice(0, Math.max(2, Math.ceil(recoveryQuota / 3)))
    .map(item => item.symbol))];
  for (const symbol of hybridRecoverySymbols) {
    if (!recoverySymbols.includes(symbol) && recoverySymbols.length < recoveryQuota) recoverySymbols.push(symbol);
  }

  const recoverySet = new Set(recoverySymbols);
  const explorationSymbols = input.universeSymbols.filter(symbol => !recoverySet.has(symbol));
  const explorationQuota = Math.max(4, symbolLimit - recoverySymbols.length);
  const orderedSymbols = [...recoverySymbols, ...explorationSymbols.slice(0, explorationQuota)].slice(0, symbolLimit);

  for (const item of ranked.slice(0, recoveryQuota)) {
    lastFocusedAt.set(item.symbol, now);
    lastFocusedGap.set(item.symbol, item.bpsToBreakEven);
  }

  const staleEvidenceSymbols = ranked.filter(item => feeFreshness(item) < 0.75).map(item => item.symbol);
  const intervalFactor = closestGapBps !== null && closestGapBps <= 2 ? 0.33
    : closestGapBps !== null && closestGapBps <= 5 ? 0.5
      : closestGapBps !== null && closestGapBps <= 10 ? 0.67
        : closestGapBps !== null && closestGapBps >= 75 ? 1.5
          : 1;
  const scanIntervalMs = Math.max(3_000, Math.min(60_000, Math.round(input.baseIntervalMs * intervalFactor)));

  return {
    orderedSymbols,
    symbolLimit,
    scanIntervalMs,
    recoverySymbols,
    explorationSymbols: orderedSymbols.filter(symbol => !recoverySet.has(symbol)),
    closestGapBps,
    closestRiskGapBps,
    hybridRecoverySymbols,
    staleEvidenceSymbols,
    authority: 'measured_search_scheduling_only',
    executionAuthority: false,
  };
}
