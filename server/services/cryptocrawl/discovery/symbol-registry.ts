const QUOTE_ASSETS = ['USDT', 'USDC', 'USD'] as const;
export type CanonicalQuoteAsset = typeof QUOTE_ASSETS[number];

export interface CanonicalSymbol {
  symbol: string;
  base: string;
  quote: CanonicalQuoteAsset;
}

const STABLE_BASES = new Set(['USDT', 'USDC', 'USD', 'DAI', 'FDUSD', 'TUSD', 'USDP']);

export function canonicalizeCexSymbol(raw: string): CanonicalSymbol | null {
  const normalized = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[\/_:\-]/g, '');
  if (!normalized) return null;

  const quote = QUOTE_ASSETS.find(candidate => normalized.endsWith(candidate));
  if (!quote) return null;
  const base = normalized.slice(0, -quote.length);
  if (!base || base === quote) return null;
  if (!/^[A-Z0-9]{2,15}$/.test(base)) return null;

  return { symbol: `${base}${quote}`, base, quote };
}

export function isUsefulArbitrageSymbol(raw: string): boolean {
  const canonical = canonicalizeCexSymbol(raw);
  if (!canonical) return false;
  if (canonical.base === canonical.quote) return false;
  // Stable/stable markets can be useful for dedicated FX/basis strategies, but
  // the present spot-asset arbitrage verifier is not that strategy. Excluding
  // them prevents a top-market-cap slot such as USDTUSDT from starving a real
  // tradable asset without pretending the pair is invalid globally.
  if (STABLE_BASES.has(canonical.base) && STABLE_BASES.has(canonical.quote)) return false;
  return true;
}

export function dedupeCanonicalSymbols(symbols: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of symbols) {
    const canonical = canonicalizeCexSymbol(raw);
    if (!canonical || !isUsefulArbitrageSymbol(canonical.symbol) || seen.has(canonical.symbol)) continue;
    seen.add(canonical.symbol);
    result.push(canonical.symbol);
  }
  return result;
}
