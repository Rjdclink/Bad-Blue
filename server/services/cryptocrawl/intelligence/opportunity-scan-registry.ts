export interface BroadOpportunityScore {
  symbol: string;
  observedAt: number;
  netSpreadAfterFeesBps: number;
}

export type BroadOpportunityScanner = (symbols: readonly string[]) => Promise<readonly BroadOpportunityScore[]>;

let scanner: BroadOpportunityScanner | null = null;
let inFlight: Promise<void> | null = null;
let lastScanAt = 0;
const scores = new Map<string, BroadOpportunityScore>();

export function registerBroadOpportunityScanner(next: BroadOpportunityScanner): void {
  scanner = next;
}

async function refreshScores(symbols: readonly string[]): Promise<void> {
  if (!scanner || symbols.length === 0) return;
  const minIntervalMs = Math.max(1_000, Number(process.env.CRYPTO_ARBITRAGE_BROAD_SCAN_INTERVAL_MS || 5_000));
  if (Date.now() - lastScanAt < minIntervalMs) return;
  if (inFlight) return inFlight;

  const maxSymbols = Math.min(50, Math.max(4, Number(process.env.CRYPTO_ARBITRAGE_BROAD_SCAN_SYMBOLS || 24)));
  const unique = [...new Set(symbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))].slice(0, maxSymbols);
  inFlight = scanner(unique).then(nextScores => {
    for (const score of nextScores) {
      if (!Number.isFinite(score.netSpreadAfterFeesBps) || !Number.isFinite(score.observedAt)) continue;
      scores.set(score.symbol.trim().toUpperCase(), { ...score, symbol: score.symbol.trim().toUpperCase() });
    }
    lastScanAt = Date.now();
    const staleBefore = lastScanAt - Math.max(10_000, minIntervalMs * 4);
    for (const [symbol, score] of scores) {
      if (score.observedAt < staleBefore) scores.delete(symbol);
    }
  }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export async function rankDiscoveryUniverse<T extends { symbol: string }>(assets: readonly T[]): Promise<T[]> {
  await refreshScores(assets.map(asset => asset.symbol));
  return assets.map((asset, index) => ({ asset, index, score: scores.get(asset.symbol.trim().toUpperCase())?.netSpreadAfterFeesBps }))
    .sort((left, right) => {
      const leftScore = left.score;
      const rightScore = right.score;
      if (leftScore !== undefined && rightScore !== undefined && leftScore !== rightScore) return rightScore - leftScore;
      if (leftScore !== undefined && rightScore === undefined) return -1;
      if (leftScore === undefined && rightScore !== undefined) return 1;
      return left.index - right.index;
    })
    .map(entry => entry.asset);
}

export function getBroadOpportunityScores(): ReadonlyArray<Readonly<BroadOpportunityScore>> {
  return [...scores.values()].map(score => ({ ...score }));
}
