import type Cryptara from '../../cryptara/index.js';
import {
  getCryptara,
  type CryptaraOpportunityAssessment,
  type CryptaraOpportunityContext,
} from '../../cryptara/index.js';
import { createLogger } from '../../../logger.js';
import {
  getKalshiPredictionSignalsForAsset,
  type KalshiPredictionMarketSignal,
} from '../intelligence/kalshi-prediction-market-authority.js';

const log = createLogger('CryptaraKalshiPredictionWiring');
const installed = new WeakSet<object>();
const MAX_SNAPSHOTS = Math.max(100, Math.min(10_000, Number(process.env.CRYPTARA_KALSHI_MAX_SNAPSHOTS || 2_000)));
const MAX_SIGNAL_AGE_MS = Math.max(1_000, Math.min(15 * 60_000, Number(process.env.CRYPTARA_KALSHI_MAX_SIGNAL_AGE_MS || 60_000)));
const MAX_SIGNALS_PER_OPPORTUNITY = Math.max(1, Math.min(64, Number(process.env.CRYPTARA_KALSHI_MAX_SIGNALS_PER_OPPORTUNITY || 24)));

export interface CryptaraKalshiPredictionSnapshot {
  opportunityId: string;
  symbol: string;
  asset: string;
  evaluatedAt: number;
  signalCount: number;
  freshSignalCount: number;
  rulesCompleteCount: number;
  liquidSignalCount: number;
  medianSpreadBps: number | null;
  aggregateLiquidityUsd: number;
  aggregateVolume24h: number;
  qualityScore: number;
  signals: Array<{
    ticker: string;
    eventTicker: string;
    impliedProbability: number | null;
    spreadBps: number | null;
    liquidityUsd: number | null;
    volume24h: number | null;
    occurrenceAt: number | null;
    expectedExpirationAt: number | null;
    rulesFingerprint: string;
    ageMs: number;
  }>;
  calibratedDirectionalAuthority: false;
  economicAuthority: false;
  monteCarloAuthority: false;
  executionAuthority: false;
  syntheticEvidence: false;
}

type CryptaraAssessmentTarget = {
  assessOpportunity: (context: CryptaraOpportunityContext) => Promise<CryptaraOpportunityAssessment>;
};

const snapshots = new Map<string, CryptaraKalshiPredictionSnapshot>();

function assetFromSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/(USDT|USDC|USD)$/, '');
}

function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function rulesComplete(signal: KalshiPredictionMarketSignal): boolean {
  return Boolean(signal.rulesFingerprint && (signal.rulesPrimary.trim() || signal.rulesSecondary.trim()));
}

function qualityFor(signals: KalshiPredictionMarketSignal[], now: number): number {
  if (signals.length === 0) return 0;
  const freshFraction = signals.filter(signal => now - signal.observedAt <= MAX_SIGNAL_AGE_MS).length / signals.length;
  const rulesFraction = signals.filter(rulesComplete).length / signals.length;
  const liquidFraction = signals.filter(signal => (signal.liquidityUsd ?? 0) > 0 || (signal.volume24h ?? 0) > 0).length / signals.length;
  const spreadValues = signals.map(signal => signal.spreadBps).filter((value): value is number => value !== null && Number.isFinite(value));
  const spreadQuality = spreadValues.length === 0
    ? 0
    : spreadValues.reduce((sum, spread) => sum + Math.max(0, Math.min(1, 1 - spread / 2_500)), 0) / spreadValues.length;
  return Number((freshFraction * 0.35 + rulesFraction * 0.30 + liquidFraction * 0.20 + spreadQuality * 0.15).toFixed(6));
}

function buildSnapshot(context: CryptaraOpportunityContext): CryptaraKalshiPredictionSnapshot {
  const now = Date.now();
  const asset = assetFromSymbol(context.symbol);
  const candidates = getKalshiPredictionSignalsForAsset(asset)
    .filter(signal => signal.expiresAt > now)
    .slice(0, MAX_SIGNALS_PER_OPPORTUNITY);
  const fresh = candidates.filter(signal => now - signal.observedAt <= MAX_SIGNAL_AGE_MS);
  const liquid = candidates.filter(signal => (signal.liquidityUsd ?? 0) > 0 || (signal.volume24h ?? 0) > 0);
  const selected = candidates.map(signal => ({
    ticker: signal.ticker,
    eventTicker: signal.eventTicker,
    impliedProbability: signal.impliedProbability,
    spreadBps: signal.spreadBps,
    liquidityUsd: signal.liquidityUsd,
    volume24h: signal.volume24h,
    occurrenceAt: signal.occurrenceAt,
    expectedExpirationAt: signal.expectedExpirationAt,
    rulesFingerprint: signal.rulesFingerprint,
    ageMs: Math.max(0, now - signal.observedAt),
  }));
  return {
    opportunityId: context.opportunityId,
    symbol: context.symbol,
    asset,
    evaluatedAt: now,
    signalCount: candidates.length,
    freshSignalCount: fresh.length,
    rulesCompleteCount: candidates.filter(rulesComplete).length,
    liquidSignalCount: liquid.length,
    medianSpreadBps: median(candidates.map(signal => signal.spreadBps).filter((value): value is number => value !== null)),
    aggregateLiquidityUsd: candidates.reduce((sum, signal) => sum + Math.max(0, signal.liquidityUsd ?? 0), 0),
    aggregateVolume24h: candidates.reduce((sum, signal) => sum + Math.max(0, signal.volume24h ?? 0), 0),
    qualityScore: qualityFor(candidates, now),
    signals: selected,
    calibratedDirectionalAuthority: false,
    economicAuthority: false,
    monteCarloAuthority: false,
    executionAuthority: false,
    syntheticEvidence: false,
  };
}

function storeSnapshot(snapshot: CryptaraKalshiPredictionSnapshot): void {
  snapshots.delete(snapshot.opportunityId);
  snapshots.set(snapshot.opportunityId, snapshot);
  while (snapshots.size > MAX_SNAPSHOTS) {
    const oldest = snapshots.keys().next().value as string | undefined;
    if (!oldest) break;
    snapshots.delete(oldest);
  }
}

export function getCryptaraKalshiPredictionSnapshot(opportunityId: string): CryptaraKalshiPredictionSnapshot | null {
  const snapshot = snapshots.get(opportunityId);
  return snapshot ? structuredClone(snapshot) : null;
}

export function getCryptaraKalshiPredictionSummary(): {
  tracked: number;
  withSignals: number;
  averageQualityScore: number;
  calibratedDirectionalAuthority: false;
  economicAuthority: false;
  executionAuthority: false;
} {
  const values = [...snapshots.values()];
  return {
    tracked: values.length,
    withSignals: values.filter(value => value.signalCount > 0).length,
    averageQualityScore: values.length
      ? Number((values.reduce((sum, value) => sum + value.qualityScore, 0) / values.length).toFixed(6))
      : 0,
    calibratedDirectionalAuthority: false,
    economicAuthority: false,
    executionAuthority: false,
  };
}

/**
 * Makes Kalshi's resolved-market-quality prediction surface visible to Cryptara
 * without pretending unrelated event probabilities are a directional crypto
 * forecast. The wrapper consumes only the already-cached Kalshi snapshot; it adds
 * no hot-path network request and cannot alter deterministic economics, Monte
 * Carlo probabilities, governance, sizing or execution admission.
 */
export function ensureCryptaraKalshiPredictionWiring(): Cryptara {
  const instance = getCryptara();
  if (installed.has(instance)) return instance;
  installed.add(instance);

  const target = instance as unknown as CryptaraAssessmentTarget;
  const originalAssessOpportunity = target.assessOpportunity.bind(target);
  target.assessOpportunity = async (context: CryptaraOpportunityContext): Promise<CryptaraOpportunityAssessment> => {
    const assessment = await originalAssessOpportunity(context);
    const snapshot = buildSnapshot(context);
    storeSnapshot(snapshot);
    return {
      ...assessment,
      provenance: [...new Set([
        ...assessment.provenance,
        `kalshi_prediction_signals:${snapshot.signalCount}`,
        `kalshi_prediction_fresh:${snapshot.freshSignalCount}`,
        `kalshi_prediction_quality:${snapshot.qualityScore.toFixed(6)}`,
        'kalshi_prediction_directional_authority:false',
        'kalshi_prediction_economic_authority:false',
      ])],
    };
  };

  log.info('Cryptara Kalshi prediction-intelligence wiring installed', {
    cachedSignalOnly: true,
    hotPathNetworkRequestsAdded: false,
    unrelatedProbabilitiesAggregatedDirectionally: false,
    calibratedDirectionalAuthority: false,
    economicsChanged: false,
    monteCarloChanged: false,
    governanceChanged: false,
    executionAuthority: false,
  });
  return instance;
}
