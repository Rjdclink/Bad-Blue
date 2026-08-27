import type { TechnicalAnalysis } from '../babel/tradingview-integration.js';
import type { MempoolAnalysis } from '../capital-free/alchemy-integration.js';
import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import type { NormalizedRealizedExecution } from '../execution/settlement-types.js';
import { stageManager } from '../governance/stage-management.js';
import { getLatestOracleEvidence, type CanonicalOracleEvidence } from '../integration/oracle-evidence-wiring.js';

export type CanonicalOpportunityStatus =
  | 'observed'
  | 'assessed'
  | 'eligible'
  | 'blocked'
  | 'submitted'
  | 'settled'
  | 'failed';

export interface CanonicalMonteCarloState {
  mode: 'pretrade_bootstrap' | 'posttrade_calibrated';
  probabilityOfProfit: number;
  confidence: number;
  valueAtRisk95: number;
  expectedShortfall: number;
  maxDrawdown: number;
  marketRegime: string;
  calibrationSamples: number;
  evaluatedAt: number;
}

export interface CanonicalMarketDataState {
  source: string | null;
  priceUsd: number | null;
  volume24hUsd: number | null;
  marketCapUsd: number | null;
  priceChange24hPct: number | null;
}

export interface CanonicalOpportunityAssessmentInput {
  opportunityId: string;
  evaluatedAt: number;
  recommendation: 'observe' | 'consider' | 'reject';
  rankScore: number | null;
  executionConfidence: number | null;
  probabilityOfProfitableExecution: number | null;
  riskLevel: 'low' | 'medium' | 'high' | 'critical' | 'unknown';
  dataCompleteness: number;
  marketData?: CanonicalMarketDataState;
  missingInformation: string[];
  provenance: string[];
  monteCarlo: CanonicalMonteCarloState | null;
}

export interface CanonicalGovernanceSnapshot {
  stage: number;
  stageName: string;
  paused: boolean;
  killSwitchActive: boolean;
  canExecuteTrades: boolean;
  initialGasReady: boolean;
  liveValidation: {
    samples: number;
    passes: number;
    passRate: number;
    chainHealthy: boolean;
    lastObservedAt: number | null;
  };
  marketGate: {
    decision: 'ALLOW' | 'BLOCK';
    evaluatedAt: number;
    reasons: string[];
  } | null;
  automaticAdvancementBlockers: string[];
}

export interface CanonicalOpportunitySnapshot {
  opportunityId: string;
  observedAt: number;
  updatedAt: number;
  chain: string;
  symbol: string;
  status: CanonicalOpportunityStatus;
  plan: VerifiedArbitragePlan | null;
  technical: TechnicalAnalysis | null;
  mempool: MempoolAnalysis | null;
  oracle: CanonicalOracleEvidence | null;
  assessment: CanonicalOpportunityAssessmentInput | null;
  governance: CanonicalGovernanceSnapshot;
  settlement: NormalizedRealizedExecution | null;
  realized: {
    success: boolean | null;
    realizedProfitUsd: number | null;
    feeUsd: number | null;
    slippageBps: number | null;
    latencyMs: number | null;
    settlementStatus: string | null;
    settlementConfirmed: boolean | null;
  };
  missingInformation: string[];
  provenance: string[];
}

export interface CanonicalOpportunityMetrics {
  windowMs: number;
  observedOpportunities: number;
  verifiedPositiveOpportunities: number;
  eligibleOpportunities: number;
  expectedNetProfitUsd: number;
  realizedNetProfitUsd: number;
  realizedSettlementCount: number;
}

function clonePlan(plan: VerifiedArbitragePlan | null): VerifiedArbitragePlan | null {
  if (!plan) return null;
  return {
    ...plan,
    costs: { ...plan.costs },
    liquidity: { ...plan.liquidity, source: [...plan.liquidity.source] },
    feeEvidence: plan.feeEvidence
      ? { buy: { ...plan.feeEvidence.buy }, sell: { ...plan.feeEvidence.sell } }
      : undefined,
    bridge: plan.bridge ? { ...plan.bridge } : undefined,
  };
}

function cloneOracle(oracle: CanonicalOracleEvidence | null): CanonicalOracleEvidence | null {
  return oracle ? { ...oracle, sources: oracle.sources.map(source => ({ ...source })) } : null;
}

function matchingOracleEvidence(symbol: string): CanonicalOracleEvidence | null {
  const oracle = getLatestOracleEvidence();
  if (!oracle) return null;
  const normalizedSymbol = symbol.trim().toUpperCase();
  const baseAsset = normalizedSymbol.replace(/(USDT|USDC|USD)$/i, '');
  if (!baseAsset || baseAsset !== oracle.asset.trim().toUpperCase()) return null;
  const maxAgeMs = Math.max(1_000, Number(process.env.CRYPTOCRAWL_ORACLE_EVIDENCE_MAX_AGE_MS || 60_000));
  if (Date.now() - oracle.observedAt > maxAgeMs) return null;
  return cloneOracle(oracle);
}

function governanceSnapshot(): CanonicalGovernanceSnapshot {
  const state = stageManager.getState();
  const config = stageManager.getStageConfig();
  const marketGate = state.automaticAdvancementEvidence?.marketGate;
  return {
    stage: state.currentStage,
    stageName: config.stageName,
    paused: state.isPaused,
    killSwitchActive: state.killSwitchActive,
    canExecuteTrades: stageManager.canExecuteTrades(),
    initialGasReady: stageManager.isInitialGasReady(),
    liveValidation: {
      samples: state.proofMetrics.liveValidationSamples,
      passes: state.proofMetrics.liveValidationPasses,
      passRate: state.proofMetrics.liveValidationPassRate,
      chainHealthy: state.proofMetrics.chainHealthy,
      lastObservedAt: state.proofMetrics.lastLiveValidationAt ?? null,
    },
    marketGate: marketGate
      ? {
          decision: marketGate.decision,
          evaluatedAt: marketGate.evaluatedAt,
          reasons: [...marketGate.reasons],
        }
      : null,
    automaticAdvancementBlockers: [...state.automaticAdvancementBlockers],
  };
}

class CanonicalOpportunityStateStore {
  private readonly snapshots = new Map<string, CanonicalOpportunitySnapshot>();
  private latestOpportunityId: string | null = null;
  private readonly maxEntries = 512;

  recordAssessment(input: {
    opportunityId: string;
    observedAt: number;
    chain: string;
    symbol: string;
    plan: VerifiedArbitragePlan | null;
    technical: TechnicalAnalysis | null;
    mempool: MempoolAnalysis | null;
    assessment: CanonicalOpportunityAssessmentInput;
  }): CanonicalOpportunitySnapshot {
    const previous = this.snapshots.get(input.opportunityId);
    const positiveEconomics = !!input.plan && Number.isFinite(input.plan.netProfitUsd) && input.plan.netProfitUsd > 0;
    const status: CanonicalOpportunityStatus = input.assessment.recommendation === 'consider' && positiveEconomics
      ? 'eligible'
      : input.assessment.recommendation === 'reject'
        ? 'blocked'
        : 'assessed';
    const oracle = matchingOracleEvidence(input.symbol);
    const snapshot: CanonicalOpportunitySnapshot = {
      opportunityId: input.opportunityId,
      observedAt: input.observedAt,
      updatedAt: Date.now(),
      chain: input.chain,
      symbol: input.symbol,
      status,
      plan: clonePlan(input.plan),
      technical: input.technical ? { ...input.technical } : null,
      mempool: input.mempool ? { ...input.mempool } : null,
      oracle,
      assessment: {
        ...input.assessment,
        marketData: input.assessment.marketData ? { ...input.assessment.marketData } : undefined,
        missingInformation: [...input.assessment.missingInformation],
        provenance: [...input.assessment.provenance],
        monteCarlo: input.assessment.monteCarlo ? { ...input.assessment.monteCarlo } : null,
      },
      governance: governanceSnapshot(),
      settlement: previous?.settlement ? { ...previous.settlement } : null,
      realized: previous?.realized
        ? { ...previous.realized }
        : {
            success: null,
            realizedProfitUsd: null,
            feeUsd: null,
            slippageBps: null,
            latencyMs: null,
            settlementStatus: null,
            settlementConfirmed: null,
          },
      missingInformation: [...new Set(input.assessment.missingInformation)],
      provenance: [...new Set([
        ...input.assessment.provenance,
        ...(oracle ? [`multi_oracle:${oracle.asset}:${oracle.chain}`] : []),
      ])],
    };
    this.snapshots.set(input.opportunityId, snapshot);
    this.latestOpportunityId = input.opportunityId;
    this.prune();
    return this.clone(snapshot);
  }

  recordExecution(input: {
    opportunityId?: string;
    chain: string;
    symbol: string;
    success: boolean;
    realizedProfitUsd: number | null;
    feeUsd: number | null;
    slippageBps: number | null;
    latencyMs: number;
    settlementStatus?: string;
    settlementConfirmed?: boolean;
    settlement?: NormalizedRealizedExecution;
    provenance?: string[];
  }): CanonicalOpportunitySnapshot | null {
    const opportunityId = input.opportunityId || this.findLatestBySymbol(input.symbol)?.opportunityId;
    if (!opportunityId) return null;
    const previous = this.snapshots.get(opportunityId);
    if (!previous) return null;
    const settlementConfirmed = input.settlementConfirmed === true;
    const status: CanonicalOpportunityStatus = settlementConfirmed
      ? (input.success ? 'settled' : 'failed')
      : input.success
        ? 'submitted'
        : 'failed';
    const next: CanonicalOpportunitySnapshot = {
      ...previous,
      updatedAt: Date.now(),
      chain: input.chain || previous.chain,
      symbol: input.symbol || previous.symbol,
      status,
      governance: governanceSnapshot(),
      settlement: input.settlement ? { ...input.settlement } : previous.settlement,
      realized: {
        success: input.success,
        realizedProfitUsd: input.realizedProfitUsd,
        feeUsd: input.feeUsd,
        slippageBps: input.slippageBps,
        latencyMs: Number.isFinite(input.latencyMs) ? input.latencyMs : null,
        settlementStatus: input.settlementStatus || null,
        settlementConfirmed: input.settlementConfirmed ?? null,
      },
      provenance: [...new Set([...previous.provenance, ...(input.provenance || []), 'canonical_execution_feedback'])],
    };
    this.snapshots.set(opportunityId, next);
    this.latestOpportunityId = opportunityId;
    return this.clone(next);
  }

  refreshGovernance(opportunityId?: string): CanonicalOpportunitySnapshot | null {
    const id = opportunityId || this.latestOpportunityId;
    if (!id) return null;
    const previous = this.snapshots.get(id);
    if (!previous) return null;
    const next: CanonicalOpportunitySnapshot = {
      ...previous,
      updatedAt: Date.now(),
      governance: governanceSnapshot(),
    };
    this.snapshots.set(id, next);
    return this.clone(next);
  }

  get(opportunityId: string): CanonicalOpportunitySnapshot | null {
    const snapshot = this.snapshots.get(opportunityId);
    return snapshot ? this.clone(snapshot) : null;
  }

  getLatest(): CanonicalOpportunitySnapshot | null {
    if (!this.latestOpportunityId) return null;
    return this.get(this.latestOpportunityId);
  }

  getRecent(limit = 50): CanonicalOpportunitySnapshot[] {
    return [...this.snapshots.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, Math.max(1, limit))
      .map(snapshot => this.clone(snapshot));
  }

  getMetrics(windowMs = 60_000): CanonicalOpportunityMetrics {
    const boundedWindowMs = Math.max(1_000, Math.min(3_600_000, windowMs));
    const cutoff = Date.now() - boundedWindowMs;
    const recent = [...this.snapshots.values()].filter(snapshot => snapshot.observedAt >= cutoff);
    const verifiedPositive = recent.filter(snapshot =>
      !!snapshot.plan && Number.isFinite(snapshot.plan.netProfitUsd) && snapshot.plan.netProfitUsd > 0,
    );
    const realized = recent.filter(snapshot =>
      snapshot.realized.settlementConfirmed === true &&
      snapshot.realized.realizedProfitUsd !== null &&
      Number.isFinite(snapshot.realized.realizedProfitUsd),
    );
    return {
      windowMs: boundedWindowMs,
      observedOpportunities: recent.length,
      verifiedPositiveOpportunities: verifiedPositive.length,
      eligibleOpportunities: recent.filter(snapshot => snapshot.status === 'eligible').length,
      expectedNetProfitUsd: verifiedPositive.reduce((sum, snapshot) => sum + (snapshot.plan?.netProfitUsd || 0), 0),
      realizedNetProfitUsd: realized.reduce((sum, snapshot) => sum + (snapshot.realized.realizedProfitUsd || 0), 0),
      realizedSettlementCount: realized.length,
    };
  }

  private findLatestBySymbol(symbol: string): CanonicalOpportunitySnapshot | null {
    const normalized = symbol.trim().toUpperCase();
    const match = [...this.snapshots.values()]
      .filter(snapshot => snapshot.symbol.trim().toUpperCase() === normalized)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    return match || null;
  }

  private prune(): void {
    while (this.snapshots.size > this.maxEntries) {
      const oldest = [...this.snapshots.entries()].sort(([, left], [, right]) => left.updatedAt - right.updatedAt)[0];
      if (!oldest) return;
      this.snapshots.delete(oldest[0]);
    }
  }

  private clone(snapshot: CanonicalOpportunitySnapshot): CanonicalOpportunitySnapshot {
    return {
      ...snapshot,
      plan: clonePlan(snapshot.plan),
      technical: snapshot.technical ? { ...snapshot.technical } : null,
      mempool: snapshot.mempool ? { ...snapshot.mempool } : null,
      oracle: cloneOracle(snapshot.oracle),
      assessment: snapshot.assessment
        ? {
            ...snapshot.assessment,
            marketData: snapshot.assessment.marketData ? { ...snapshot.assessment.marketData } : undefined,
            monteCarlo: snapshot.assessment.monteCarlo ? { ...snapshot.assessment.monteCarlo } : null,
            missingInformation: [...snapshot.assessment.missingInformation],
            provenance: [...snapshot.assessment.provenance],
          }
        : null,
      governance: {
        ...snapshot.governance,
        liveValidation: { ...snapshot.governance.liveValidation },
        marketGate: snapshot.governance.marketGate
          ? { ...snapshot.governance.marketGate, reasons: [...snapshot.governance.marketGate.reasons] }
          : null,
        automaticAdvancementBlockers: [...snapshot.governance.automaticAdvancementBlockers],
      },
      settlement: snapshot.settlement ? { ...snapshot.settlement } : null,
      realized: { ...snapshot.realized },
      missingInformation: [...snapshot.missingInformation],
      provenance: [...snapshot.provenance],
    };
  }
}

export const canonicalOpportunityState = new CanonicalOpportunityStateStore();
