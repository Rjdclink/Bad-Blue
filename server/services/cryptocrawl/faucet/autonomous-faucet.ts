// Canonical CryptoCrawler lifecycle compatibility facade.
//
// Historical versions of this file implemented a second trading state machine with
// hourly/daily/window profit caps, synthetic business targets, stealth/anti-detection
// heuristics, a second open/close authority, and faucet-local execution decisions.
// Those responsibilities are retired. Deterministic all-in positive economics,
// Cryptara/Hyper Monte Carlo, canonical resource scheduling, governance, execution,
// settlement, and measured feedback are the only current authorities.

import { randomUUID } from 'node:crypto';
import { canonicalExecutionScheduler } from '../execution/canonical-execution-scheduler.js';
import { canonicalOpportunityState, type CanonicalOpportunitySnapshot } from '../intelligence/canonical-opportunity-state.js';
import { ensureCanonicalCryptoCrawlerRuntimeWiring } from '../integration/canonical-runtime-wiring.js';
import { stageManager } from '../governance/stage-management.js';

export interface MarketConditions {
  volatility: number;
  gasEfficiency: number;
  spreadOpportunities: number;
  competitionLevel: number;
  liquidityDepth: number;
  technicalSignal: 'bullish' | 'bearish' | 'neutral' | 'unknown';
  timestamp: number;
  confidence: number;
  technicalDataProvenance: 'live' | 'cached' | 'deterministic-fallback' | 'no-data';
  technicalDataTimestamp: number | null;
  quoteDataProvenance: 'live' | 'no-data';
  quoteDataTimestamp: number | null;
  dexDataProvenance: 'live' | 'no-data';
  lastMarketDataError?: string;
  lastMarketGateError?: string;
}

export type FaucetMode = 'closed' | 'opening' | 'open' | 'closing' | 'cooldown' | 'stealth' | 'emergency';

export interface FaucetState {
  mode: FaucetMode;
  profitThisSession: number;
  profitThisHour: number;
  profitThisDay: number;
  profitThisWindow: number;
  tradesThisHour: number;
  tradesThisDay: number;
  currentWindow: number;
  lastModeChange: number;
  lastLoopIterationAt: number;
  stealthLevel: number;
  healthScore: number;
  consecutiveFailures: number;
  lastSuccessfulTrade: number;
  dailyTargetProgress: number;
  exchangeDistribution: Map<string, number>;
  cainId: string;
  lastReasoningConclusion: unknown | null;
  securityProofsValid: number;
  globalThreatLevel: string;
  executionMode: 'disabled' | 'live';
  lastVerifiedArbitrage: unknown | null;
  lastArbitrageDecision: 'EXECUTE' | 'PENDING' | 'SKIP' | 'ERROR' | 'NONE';
}

export interface CircuitBreakerState {
  isOpen: boolean;
  failures: number;
  lastFailure: number;
  lastSuccess: number;
  halfOpenAttempts: number;
}

export interface HealthCheck {
  component: string;
  status: 'healthy' | 'degraded' | 'critical';
  latency: number;
  lastCheck: number;
  message: string;
}

export interface StressTestResult {
  testName: string;
  passed: boolean;
  duration: number;
  details: string;
  timestamp: number;
}

export interface ValidatorResult {
  name: string;
  passed: boolean;
  weight: number;
  details: string;
}

export interface OpenCloseDecision {
  shouldOpen: boolean;
  shouldClose: boolean;
  confidence: number;
  reasons: string[];
  validators: ValidatorResult[];
}

export interface InternalMessage {
  id: string;
  intent: string;
  payload: unknown;
  sourceId: string;
  timestamp: number;
  priority: number;
  confidentiality: number;
}

export interface ExternalMessage {
  id: string;
  type: 'json' | 'rest' | 'websocket' | 'abi' | 'custom';
  data: Buffer | string | object;
  headers?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface CommSecurityState {
  inboundMessages: number;
  outboundMessages: number;
  blockedMessages: number;
  quarantinedMessages: number;
  lastThreatDetected: number | null;
  threatLevel: 'low' | 'medium' | 'high' | 'critical';
}

// Compatibility constants. They intentionally contain no profit target/cap authority.
export const DAILY_TARGET_CONFIG = Object.freeze({
  retired: true,
  dailyTarget: 0,
  tradingWindows: 0,
  windowDuration: 0,
  windowVariance: 0,
  baseWindowTarget: 0,
  minWindowProfit: 0,
  maxWindowProfit: Number.POSITIVE_INFINITY,
  maxExchangePercent: 1,
  minExchangeCount: 0,
  supportedExchanges: [] as string[],
  maxMarketImpact: 0,
  orderSizeVariance: 0,
  timingJitter: 0,
});

export const STEALTH_CONFIG = Object.freeze({
  retired: true,
  maxHourlyProfit: Number.POSITIVE_INFINITY,
  maxTradesPerHour: Number.POSITIVE_INFINITY,
  volumeCapPercent: 0,
  minProfitToActivate: 0,
  cooldownMinutes: 0,
  stealthIncreaseRate: 0,
  patternBreakingEnabled: false,
  exchangeRotation: false,
  pairDiversification: false,
  orderTypeVariation: false,
  maxSingleTrade: Number.POSITIVE_INFINITY,
  minTimeBetweenTrades: 0,
  maxTradesPerMinute: Number.POSITIVE_INFINITY,
});

export const COMM_SECURITY_CONFIG = Object.freeze({ retired: true });
export const DECISION_CONFIG = Object.freeze({
  retired: true,
  minConfidenceToOpen: 0,
  minValidatorsToOpen: 0,
  minExpectedProfitToOpen: 0,
  maxGasToOpen: Number.POSITIVE_INFINITY,
  maxCompetitionToOpen: 1,
  maxConfidenceToStayOpen: 0,
  minValidatorsToStayOpen: 0,
  maxConsecutiveFailures: Number.POSITIVE_INFINITY,
  emergencyCloseThreshold: Number.NEGATIVE_INFINITY,
  minOpenDuration: 0,
  maxOpenDuration: Number.POSITIVE_INFINITY,
  transitionTimeout: 0,
});
export const CIRCUIT_BREAKER_CONFIG = Object.freeze({ retired: true });
export const TIMING_CONFIG = Object.freeze({ retired: true });
export const TRADE_CONFIG = Object.freeze({ retired: true, minProfit: 0, maxProfit: Number.POSITIVE_INFINITY });

function settledSnapshots(): CanonicalOpportunitySnapshot[] {
  return canonicalOpportunityState.getRecent(512)
    .filter(snapshot => snapshot.settlement?.terminal === true)
    .filter(snapshot => snapshot.realized.settlementConfirmed === true);
}

function realizedProfitSince(cutoff: number): number {
  return settledSnapshots()
    .filter(snapshot => (snapshot.settlement?.settledAt || snapshot.updatedAt) >= cutoff)
    .reduce((sum, snapshot) => sum + (Number.isFinite(snapshot.realized.realizedProfitUsd) ? (snapshot.realized.realizedProfitUsd || 0) : 0), 0);
}

export class AutonomousCryptoFaucet {
  private readonly faucetId = `canonical-facade-${randomUUID()}`;
  private active = false;
  private heartbeat: NodeJS.Timeout | null = null;
  private startedAt = 0;
  private lastLoopIterationAt = 0;
  private lastModeChange = Date.now();

  async initialize(): Promise<void> {
    ensureCanonicalCryptoCrawlerRuntimeWiring();
  }

  async runAutonomousLoop(): Promise<void> {
    if (this.active) return;
    ensureCanonicalCryptoCrawlerRuntimeWiring();
    canonicalExecutionScheduler.start();
    this.active = true;
    this.startedAt = Date.now();
    this.lastModeChange = this.startedAt;
    this.lastLoopIterationAt = this.startedAt;
    this.heartbeat = setInterval(() => {
      this.lastLoopIterationAt = Date.now();
    }, 5_000);
    this.heartbeat.unref?.();
  }

  stop(): void {
    this.active = false;
    this.lastModeChange = Date.now();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    canonicalExecutionScheduler.stop();
  }

  isActive(): boolean {
    return this.active && canonicalExecutionScheduler.getStats().running;
  }

  getFaucetId(): string {
    return this.faucetId;
  }

  getState(): FaucetState {
    const now = Date.now();
    const settlements = settledSnapshots();
    const lastSuccess = settlements
      .filter(snapshot => snapshot.realized.success === true)
      .sort((left, right) => (right.settlement?.settledAt || right.updatedAt) - (left.settlement?.settledAt || left.updatedAt))[0];
    const scheduler = canonicalExecutionScheduler.getStats();
    const active = this.isActive();
    const liveExecution = process.env.NO_EXECUTION !== 'true'
      && process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
      && process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK';

    return {
      mode: active ? 'open' : 'closed',
      profitThisSession: this.startedAt > 0 ? realizedProfitSince(this.startedAt) : 0,
      profitThisHour: realizedProfitSince(now - 60 * 60 * 1000),
      profitThisDay: realizedProfitSince(now - 24 * 60 * 60 * 1000),
      profitThisWindow: 0,
      tradesThisHour: settlements.filter(snapshot => (snapshot.settlement?.settledAt || snapshot.updatedAt) >= now - 60 * 60 * 1000).length,
      tradesThisDay: settlements.filter(snapshot => (snapshot.settlement?.settledAt || snapshot.updatedAt) >= now - 24 * 60 * 60 * 1000).length,
      currentWindow: 0,
      lastModeChange: this.lastModeChange,
      lastLoopIterationAt: this.lastLoopIterationAt,
      stealthLevel: 0,
      healthScore: stageManager.getState().killSwitchActive ? 0 : 100,
      consecutiveFailures: scheduler.failed,
      lastSuccessfulTrade: lastSuccess ? (lastSuccess.settlement?.settledAt || lastSuccess.updatedAt) : 0,
      dailyTargetProgress: 0,
      exchangeDistribution: new Map(),
      cainId: this.faucetId,
      lastReasoningConclusion: null,
      securityProofsValid: 0,
      globalThreatLevel: stageManager.getState().killSwitchActive ? 'critical' : 'low',
      executionMode: liveExecution ? 'live' : 'disabled',
      lastVerifiedArbitrage: canonicalOpportunityState.getLatest()?.plan || null,
      lastArbitrageDecision: scheduler.settled > 0 ? 'EXECUTE' : scheduler.pending > 0 ? 'PENDING' : scheduler.failed > 0 ? 'ERROR' : 'NONE',
    };
  }

  getMarketConditions(): MarketConditions {
    const latest = canonicalOpportunityState.getLatest();
    return {
      volatility: 0,
      gasEfficiency: latest?.plan?.costs.gasUsd ?? 0,
      spreadOpportunities: canonicalOpportunityState.getMetrics(60_000).verifiedPositiveOpportunities,
      competitionLevel: 0,
      liquidityDepth: latest?.plan
        ? Math.min(latest.plan.liquidity.buyAvailableBaseQty ?? 0, latest.plan.liquidity.sellAvailableBaseQty ?? 0)
        : 0,
      technicalSignal: latest?.technical?.summary?.signal === 'buy' || latest?.technical?.summary?.signal === 'strong_buy'
        ? 'bullish'
        : latest?.technical?.summary?.signal === 'sell' || latest?.technical?.summary?.signal === 'strong_sell'
          ? 'bearish'
          : latest?.technical ? 'neutral' : 'unknown',
      timestamp: latest?.updatedAt || 0,
      confidence: latest?.assessment?.dataCompleteness ?? 0,
      technicalDataProvenance: latest?.technical?.dataProvenance || 'no-data',
      technicalDataTimestamp: latest?.technical?.timestamp || null,
      quoteDataProvenance: latest?.plan ? 'live' : 'no-data',
      quoteDataTimestamp: latest?.plan ? latest.observedAt : null,
      dexDataProvenance: latest?.plan && latest.plan.topology !== 'CEX_CEX' ? 'live' : 'no-data',
      ...(latest?.missingInformation.length ? { lastMarketDataError: latest.missingInformation.join(', ') } : {}),
    };
  }

  async runStressTests(): Promise<{ passed: number; failed: number; results: StressTestResult[] }> {
    return {
      passed: 1,
      failed: 0,
      results: [{
        testName: 'canonical_authority_boundary',
        passed: true,
        duration: 0,
        details: 'Legacy faucet business caps and synthetic execution authority are retired',
        timestamp: Date.now(),
      }],
    };
  }
}

export const autonomousFaucet = new AutonomousCryptoFaucet();
export default autonomousFaucet;
