import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';

interface SymbolEvidence {
  symbol: string;
  attempts: number;
  positives: number;
  lastAttemptAt: number | null;
  lastPositiveAt: number | null;
  recentNetProfitUsd: number | null;
  recentNetProfitBpsProxy: number | null;
}

export interface CexFormationSymbolScore {
  symbol: string;
  score: number | null;
  positiveProbability: number;
  freshness: number;
  edgePotential: number;
  valueOfInformation: number;
  authority: 'scan_attention_advisory_only';
  executionAuthority: false;
}

export interface CexFormationSelection {
  symbols: string[];
  exploitation: string[];
  exploration: string[];
  scores: CexFormationSymbolScore[];
  authority: 'scan_attention_advisory_only';
  executionAuthority: false;
}

const evidence = new Map<string, SymbolEvidence>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function normalizedSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function scoreSymbol(symbol: string, now: number): CexFormationSymbolScore {
  const item = evidence.get(normalizedSymbol(symbol));
  if (!item || item.attempts === 0) {
    return {
      symbol: normalizedSymbol(symbol),
      score: null,
      positiveProbability: 0.5,
      freshness: 0,
      edgePotential: 0,
      valueOfInformation: 0,
      authority: 'scan_attention_advisory_only',
      executionAuthority: false,
    };
  }
  const positiveProbability = (item.positives + 1) / (item.attempts + 2);
  const halfLifeMs = clamp(Number(process.env.CRYPTOCRAWL_FORMATION_SYMBOL_HALF_LIFE_MS || 120_000), 5_000, 60 * 60_000);
  const lastPositiveAge = item.lastPositiveAt === null ? Number.POSITIVE_INFINITY : Math.max(0, now - item.lastPositiveAt);
  const freshness = Number.isFinite(lastPositiveAge) ? Math.pow(0.5, lastPositiveAge / halfLifeMs) : 0;
  const edgePotential = Math.log1p(Math.max(0, item.recentNetProfitUsd ?? 0));
  const uncertainty = 4 * positiveProbability * (1 - positiveProbability);
  const valueOfInformation = uncertainty * (1 + edgePotential);
  const score = (positiveProbability * (0.35 + 0.65 * freshness) * (1 + edgePotential)) + (0.35 * valueOfInformation);
  return {
    symbol: item.symbol,
    score: Number.isFinite(score) ? score : null,
    positiveProbability,
    freshness,
    edgePotential,
    valueOfInformation,
    authority: 'scan_attention_advisory_only',
    executionAuthority: false,
  };
}

export function recordCexFormationOutcome(symbol: string, plan: VerifiedArbitragePlan | null, observedAt = Date.now()): void {
  const key = normalizedSymbol(symbol);
  if (!key) return;
  const current = evidence.get(key) ?? {
    symbol: key,
    attempts: 0,
    positives: 0,
    lastAttemptAt: null,
    lastPositiveAt: null,
    recentNetProfitUsd: null,
    recentNetProfitBpsProxy: null,
  };
  current.attempts += 1;
  current.lastAttemptAt = observedAt;
  if (plan && Number.isFinite(plan.netProfitUsd) && plan.netProfitUsd > 0) {
    current.positives += 1;
    current.lastPositiveAt = observedAt;
    current.recentNetProfitUsd = plan.netProfitUsd;
    current.recentNetProfitBpsProxy = plan.notionalUsd > 0 ? (plan.netProfitUsd / plan.notionalUsd) * 10_000 : null;
  }
  evidence.set(key, current);
}

/**
 * Information-value attention scheduler. A deterministic exploration slice keeps
 * the whole measured universe alive; the rest of the bounded budget is directed
 * toward symbols with recent edge, persistence and unresolved information value.
 * This function can only choose what to scan. It cannot declare profit or trade.
 */
export function selectCexFormationSymbols(
  symbols: readonly string[],
  budgetInput: number,
  configuredSymbol?: string,
): CexFormationSelection {
  const unique = [...new Set(symbols.map(normalizedSymbol).filter(Boolean))];
  const budget = Math.max(1, Math.min(unique.length || 1, Math.floor(budgetInput)));
  const now = Date.now();
  const scores = unique.map(symbol => scoreSymbol(symbol, now));
  const configured = configuredSymbol ? normalizedSymbol(configuredSymbol) : '';
  const selected = new Set<string>();
  if (configured && unique.includes(configured)) selected.add(configured);

  const explorationFraction = clamp(Number(process.env.CRYPTOCRAWL_FORMATION_EXPLORATION_FRACTION || 0.25), 0.10, 0.75);
  const explorationTarget = Math.max(1, Math.ceil(budget * explorationFraction));
  const exploration = unique
    .filter(symbol => !selected.has(symbol))
    .sort((left, right) => {
      const leftAt = evidence.get(left)?.lastAttemptAt ?? 0;
      const rightAt = evidence.get(right)?.lastAttemptAt ?? 0;
      if (leftAt !== rightAt) return leftAt - rightAt;
      return left.localeCompare(right);
    })
    .slice(0, Math.max(0, explorationTarget - selected.size));
  for (const symbol of exploration) selected.add(symbol);

  const ranked = [...scores]
    .filter(score => !selected.has(score.symbol) && score.score !== null)
    .sort((left, right) => (right.score ?? -1) - (left.score ?? -1) || left.symbol.localeCompare(right.symbol));
  const exploitation: string[] = [];
  for (const score of ranked) {
    if (selected.size >= budget) break;
    selected.add(score.symbol);
    exploitation.push(score.symbol);
  }

  if (selected.size < budget) {
    const fill = unique
      .filter(symbol => !selected.has(symbol))
      .sort((left, right) => left.localeCompare(right))
      .slice(0, budget - selected.size);
    for (const symbol of fill) {
      selected.add(symbol);
      exploration.push(symbol);
    }
  }

  return {
    symbols: [...selected].slice(0, budget),
    exploitation,
    exploration,
    scores,
    authority: 'scan_attention_advisory_only',
    executionAuthority: false,
  };
}

export function getCexFormationEvidence(): SymbolEvidence[] {
  return [...evidence.values()].map(item => ({ ...item }));
}
