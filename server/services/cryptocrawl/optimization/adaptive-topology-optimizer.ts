import type { ExecutionOutcomeObservation } from '../learning/execution-outcome.js';
import {
  measuredCandidateRegistry,
  type MeasuredOpportunityTopology,
} from '../discovery/measured-candidate-registry.js';
import { computeProfitabilityScore } from './profitability-score.js';

export interface TopologyPerformanceState {
  topology: MeasuredOpportunityTopology;
  terminalSamples: number;
  successfulSamples: number;
  realizedBpsEwma: number | null;
  successRateEwma: number | null;
  realizedCostMultiplierEwma: number | null;
  lastRealizedBps: number | null;
  lastObservedAt: number | null;
  priorityWeight: number;
}

export interface AdaptiveAssemblyPolicy {
  empirical: boolean;
  terminalSamples: number;
  realizedBpsEwma: number | null;
  reliabilityEwma: number | null;
  minIncrementalBps: number;
  minLegs: number;
  maxLegs: number;
}

export interface DynamicAdmissionPolicy {
  empirical: boolean;
  terminalSamples: number;
  profitableRate: number | null;
  profitabilityScoreThreshold: number;
  confidenceThreshold: number;
}

interface AdmissionOutcome {
  profitabilityScore: number;
  confidenceLevel: number;
  profitable: boolean;
}

const TOPOLOGIES: MeasuredOpportunityTopology[] = [
  'CEX_CEX',
  'DEX_ATOMIC',
  'ZERO_CAPITAL_ATOMIC',
  'CROSS_CHAIN',
  'MEMPOOL_BACKRUN',
  'LIQUIDATION',
  'MAKER_CEX',
  'FUNDING_ARBITRAGE',
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function ewma(previous: number | null, next: number, alpha: number): number {
  return previous === null ? next : previous * (1 - alpha) + next * alpha;
}

function quantile(values: number[], probability: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * clamp(probability, 0, 1))));
  return sorted[index];
}

function inferredNotionalUsd(opportunityId: string): number | null {
  const candidate = measuredCandidateRegistry.get(opportunityId);
  if (!candidate) return null;
  const explicit = candidate.economics.notionalUsd;
  if (explicit !== null && explicit !== undefined && Number.isFinite(explicit) && explicit > 0) return explicit;

  const netBps = candidate.economics.netProfitBps;
  const netUsd = candidate.economics.deterministicNetProfitUsd;
  if (netBps !== null && netBps !== undefined && Number.isFinite(netBps) && netBps !== 0 &&
      netUsd !== null && Number.isFinite(netUsd)) {
    const inferred = Math.abs(netUsd * 10_000 / netBps);
    if (Number.isFinite(inferred) && inferred > 0) return inferred;
  }

  const grossBps = candidate.economics.grossProfitBps;
  const grossUsd = candidate.economics.grossProfitUsd;
  if (grossBps !== null && grossBps !== undefined && Number.isFinite(grossBps) && grossBps !== 0 &&
      grossUsd !== null && Number.isFinite(grossUsd)) {
    const inferred = Math.abs(grossUsd * 10_000 / grossBps);
    if (Number.isFinite(inferred) && inferred > 0) return inferred;
  }

  if ((candidate.topology === 'CEX_CEX' || candidate.topology === 'MAKER_CEX') && grossUsd !== null && grossUsd > 0) {
    const ask = candidate.rawQuotes.find(quote => Number.isFinite(quote.ask))?.ask;
    const bid = candidate.rawQuotes.find(quote => Number.isFinite(quote.bid))?.bid;
    if (ask !== null && ask !== undefined && bid !== null && bid !== undefined && bid > ask && ask > 0) {
      const baseQty = grossUsd / (bid - ask);
      const inferred = baseQty * ask;
      if (Number.isFinite(inferred) && inferred > 0) return inferred;
    }
  }

  if (candidate.topology === 'DEX_ATOMIC') {
    const amountIn = candidate.rawQuotes.find(quote => quote.amountIn && /^\d+$/.test(quote.amountIn))?.amountIn;
    if (amountIn) {
      const inferred = Number(amountIn) / 1_000_000;
      if (Number.isFinite(inferred) && inferred > 0) return inferred;
    }
  }
  return null;
}

class AdaptiveTopologyOptimizer {
  private readonly performance = new Map<MeasuredOpportunityTopology, TopologyPerformanceState>();
  private readonly alpha = clamp(Number(process.env.CRYPTOCRAWL_ADAPTIVE_BPS_EWMA_ALPHA || 0.25), 0.01, 1);
  private readonly admissionOutcomes: AdmissionOutcome[] = [];
  private readonly admissionWindow = Math.max(16, Math.min(512, Number(process.env.CRYPTOCRAWL_ADMISSION_HISTORY_WINDOW || 128)));

  constructor() {
    for (const topology of TOPOLOGIES) {
      this.performance.set(topology, {
        topology,
        terminalSamples: 0,
        successfulSamples: 0,
        realizedBpsEwma: null,
        successRateEwma: null,
        realizedCostMultiplierEwma: null,
        lastRealizedBps: null,
        lastObservedAt: null,
        priorityWeight: 1,
      });
    }
  }

  recordTerminalOutcome(outcome: ExecutionOutcomeObservation): void {
    if (!outcome.opportunityId || outcome.settlement?.terminal !== true) return;
    const candidate = measuredCandidateRegistry.get(outcome.opportunityId);
    if (!candidate) return;
    const state = this.performance.get(candidate.topology);
    if (!state) return;

    const admission = computeProfitabilityScore(candidate, state, outcome.timestamp);
    this.admissionOutcomes.push({
      profitabilityScore: admission.profitabilityScore,
      confidenceLevel: admission.confidenceLevel,
      profitable: outcome.success && outcome.realizedProfitUsd !== null && outcome.realizedProfitUsd > 0,
    });
    if (this.admissionOutcomes.length > this.admissionWindow) {
      this.admissionOutcomes.splice(0, this.admissionOutcomes.length - this.admissionWindow);
    }

    const notionalUsd = inferredNotionalUsd(outcome.opportunityId);
    if (notionalUsd !== null && outcome.realizedProfitUsd !== null && Number.isFinite(outcome.realizedProfitUsd)) {
      const realizedBps = outcome.realizedProfitUsd / notionalUsd * 10_000;
      if (Number.isFinite(realizedBps)) {
        state.terminalSamples += 1;
        if (outcome.success && realizedBps > 0) state.successfulSamples += 1;
        state.realizedBpsEwma = ewma(state.realizedBpsEwma, realizedBps, this.alpha);
        state.successRateEwma = ewma(state.successRateEwma, outcome.success ? 1 : 0, this.alpha);
        state.lastRealizedBps = realizedBps;
        state.lastObservedAt = outcome.timestamp;

        const estimatedCostUsd = Math.max(0,
          Number(candidate.economics.feeUsd || 0) +
          Number(candidate.economics.gasUsd || 0) +
          Number(candidate.economics.bridgeUsd || 0),
        );
        if (estimatedCostUsd > 0 && outcome.feeUsd !== null && Number.isFinite(outcome.feeUsd) && outcome.feeUsd >= 0) {
          const realizedCostMultiplier = clamp(outcome.feeUsd / estimatedCostUsd, 0.1, 10);
          state.realizedCostMultiplierEwma = ewma(state.realizedCostMultiplierEwma, realizedCostMultiplier, this.alpha);
        }

        measuredCandidateRegistry.updateStatus(outcome.opportunityId, candidate.status, {
          economics: {
            ...candidate.economics,
            notionalUsd,
            realizedNetProfitBps: realizedBps,
          },
          provenance: ['adaptive_optimizer:terminal_realized_bps', 'adaptive_optimizer:dynamic_admission_feedback'],
        });
      }
    }
    this.recomputeWeights();
  }

  private recomputeWeights(): void {
    const scored = [...this.performance.values()].map(state => {
      if (state.terminalSamples === 0 || state.realizedBpsEwma === null) return { state, score: 1 };
      const positiveYield = Math.max(0, state.realizedBpsEwma);
      const reliability = state.successRateEwma ?? 0;
      const score = 1 + Math.log1p(positiveYield) * 0.30 + reliability * 0.70;
      return { state, score };
    });
    const averageScore = scored.reduce((sum, item) => sum + item.score, 0) / Math.max(1, scored.length);
    for (const item of scored) {
      item.state.priorityWeight = clamp(item.score / Math.max(0.01, averageScore), 0.50, 2.00);
    }
  }

  getDynamicAdmissionPolicy(): DynamicAdmissionPolicy {
    if (this.admissionOutcomes.length === 0) {
      return {
        empirical: false,
        terminalSamples: 0,
        profitableRate: null,
        profitabilityScoreThreshold: 0,
        confidenceThreshold: 0,
      };
    }

    const profitable = this.admissionOutcomes.filter(item => item.profitable);
    const profitableRate = profitable.length / this.admissionOutcomes.length;
    const profitableScores = profitable.map(item => item.profitabilityScore).filter(value => Number.isFinite(value) && value > 0);
    const profitableConfidence = profitable.map(item => item.confidenceLevel).filter(value => Number.isFinite(value) && value > 0);
    const failurePressure = 1 - profitableRate;

    const baselineScore = profitableScores.length > 0
      ? quantile(profitableScores, 0.25)
      : quantile(this.admissionOutcomes.map(item => item.profitabilityScore), 0.50);
    const baselineConfidence = profitableConfidence.length > 0
      ? quantile(profitableConfidence, 0.25)
      : quantile(this.admissionOutcomes.map(item => item.confidenceLevel), 0.50);

    return {
      empirical: true,
      terminalSamples: this.admissionOutcomes.length,
      profitableRate,
      profitabilityScoreThreshold: Math.max(0, baselineScore * (0.75 + 0.50 * failurePressure)),
      confidenceThreshold: clamp(baselineConfidence * (0.75 + 0.25 * failurePressure), 0, 1),
    };
  }

  getAssemblyPolicy(): AdaptiveAssemblyPolicy {
    const empiricalStates = [...this.performance.values()].filter(state =>
      state.terminalSamples > 0 && state.realizedBpsEwma !== null && state.successRateEwma !== null,
    );
    const terminalSamples = empiricalStates.reduce((sum, state) => sum + state.terminalSamples, 0);
    if (terminalSamples === 0) {
      return {
        empirical: false,
        terminalSamples: 0,
        realizedBpsEwma: null,
        reliabilityEwma: null,
        minIncrementalBps: 0,
        minLegs: 2,
        maxLegs: 5,
      };
    }

    const sampleWeight = empiricalStates.reduce((sum, state) => sum + state.terminalSamples, 0);
    const realizedBpsEwma = empiricalStates.reduce(
      (sum, state) => sum + Math.max(0, state.realizedBpsEwma ?? 0) * state.terminalSamples,
      0,
    ) / Math.max(1, sampleWeight);
    const reliabilityEwma = empiricalStates.reduce(
      (sum, state) => sum + clamp(state.successRateEwma ?? 0, 0, 1) * state.terminalSamples,
      0,
    ) / Math.max(1, sampleWeight);

    const minIncrementalBps = Math.max(0, realizedBpsEwma * (0.05 + (1 - reliabilityEwma) * 0.20));
    const maxLegs = Math.max(2, Math.min(5, 2 + Math.round(reliabilityEwma * 3)));
    return {
      empirical: true,
      terminalSamples,
      realizedBpsEwma,
      reliabilityEwma,
      minIncrementalBps,
      minLegs: 2,
      maxLegs,
    };
  }

  getPerformanceState(topology: MeasuredOpportunityTopology): TopologyPerformanceState {
    return { ...this.performance.get(topology)! };
  }

  getPriority(topology: MeasuredOpportunityTopology): number {
    return this.performance.get(topology)?.priorityWeight ?? 1;
  }

  getSnapshot(): TopologyPerformanceState[] {
    return TOPOLOGIES.map(topology => ({ ...this.performance.get(topology)! }));
  }
}

export const adaptiveTopologyOptimizer = new AdaptiveTopologyOptimizer();
