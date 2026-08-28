const QUOTE_ASSETS = ['USDT', 'USDC', 'USD'] as const;
export type CanonicalQuoteAsset = typeof QUOTE_ASSETS[number];

export interface CanonicalSymbol {
  symbol: string;
  base: string;
  quote: CanonicalQuoteAsset;
}

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

  // Stable/stable spot markets are valid cross-venue arbitrage instruments when
  // the exact pair exists on both executable venues. They use the same measured
  // order-book, authenticated-fee, inventory, settlement and all-in net-profit
  // authorities as any other spot pair, so excluding them would hide legitimate
  // USDC/USDT, DAI/USDT, FDUSD/USDT, etc. opportunities. No peg assumption is made.
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
