import type Cryptara from '../../cryptara/index.js';
import type {
  CryptaraOpportunityContext,
  MonteCarloResult,
} from '../../cryptara/index.js';
import { createLogger } from '../../../logger.js';
import { runProfitabilityMonteCarlo } from '../execution/adapters/monte-carlo-profitability.js';
import { monteCarloCalibrationStore } from '../validation/monte-carlo-calibration-store.js';
import type { MonteCarloTopology } from '../validation/monte-carlo-policy.js';
import {
  ensureCryptaraBootstrapWiring,
  getRuntimeConfidenceBootstrapStatus,
} from './cryptara-bootstrap-wiring.js';

const log = createLogger('AuthoritativeMonteCarloWiring');
const installed = new WeakSet<object>();
export const AUTHORITATIVE_LIVE_MC_MODEL_VERSION = 'cryptocrawl-authoritative-live-mc-1.1.0';

type LiveEvidence = {
  simulationId: string;
  evaluatedAt: number;
  sourceOpportunityId: string;
  sourceObservedAt: number;
  mode: 'pretrade_bootstrap' | 'posttrade_calibrated';
  calibrationSamples: number;
  modelVersion: string;
  policyVersion: string;
  iterations: number;
  seed: number;
  workersUsed: number;
  convergence: number;
  stoppedEarly: boolean;
  expectedProfit: number;
  probabilityOfProfit: number;
  probabilityInterval: [number, number];
  probabilityBothLegsFill: number;
  probabilityLossExceedsThreshold: number;
  probabilityPartialFillLoss: number | null;
  valueAtRisk95: number;
  valueAtRisk99: number;
  expectedShortfall: number;
  expectedShortfall975: number;
  expectedShortfall99: number;
  p50: number;
  p25: number;
  p10: number;
  p5: number;
  p1: number;
  worst: number;
  maxDrawdown: number;
  marketRegime: string;
  confidence: number;
  distribution: string;
  distributionProvenance: string;
  executionDeadlineMs: number;
  executionHorizonMs: number;
  recommendedNotionalUsd: number;
  maxSafeNotionalUsd: number;
  averageSampledSlippageBps: number;
  averageSampledLatencyMs: number;
  confidenceEnabled: boolean;
  confidenceState: string;
  runtimeSuccessfulTrades: number;
  runtimeRequiredSuccessfulTrades: number;
  runtimeRemainingSuccessfulTrades: number;
  runtimeConfidenceStartedAt: number;
  missingInformation: string[];
};

type Internals = {
  status: {
    isRunning: boolean;
    lastSimulationTime: Date | null;
    totalSimulations: number;
    errorCount: number;
  };
  latestOpportunityContext: CryptaraOpportunityContext | null;
  latestMonteCarloEvidence: LiveEvidence | null;
  runMonteCarloSimulation: (context?: CryptaraOpportunityContext, signal?: AbortSignal) => Promise<MonteCarloResult>;
  emit: (event: string, ...args: unknown[]) => boolean;
};

function topology(context: CryptaraOpportunityContext): MonteCarloTopology {
  if (context.routeObservation) return 'ZERO_CAPITAL';
  if (context.plan?.bridge) return 'CROSS_CHAIN';
  return 'CEX_CEX';
}

function technicalEvidence(context: CryptaraOpportunityContext): { ready: boolean; ageMs: number | null; missing: string[]; required: boolean } {
  const technical = context.tradingView;
  const mcTopology = topology(context);

  // CEX arbitrage is non-directional and its execution truth is the current
  // executable venue pair: synchronized books, authenticated fees, measured
  // depth, exact size, freshness and settlement capability. Directional TA may
  // enrich search/ranking, but it must not veto an otherwise complete CEX plan.
  // Cross-chain/on-chain topologies keep the existing technical-evidence rule.
  if (mcTopology === 'CEX_CEX') {
    if (!technical) return { ready: false, ageMs: null, missing: [], required: false };
    const ageMs = Math.max(0, Date.now() - technical.sourceTimestamp);
    const maxAgeMs = Math.max(30_000, Number(process.env.TRADINGVIEW_DATA_TTL_MS || 300_000));
    const ready = technical.dataProvenance !== 'deterministic-fallback' && ageMs <= maxAgeMs;
    return { ready, ageMs, missing: [], required: false };
  }

  if (!technical) return { ready: false, ageMs: null, missing: ['live_technical_analysis'], required: true };
  if (technical.dataProvenance === 'deterministic-fallback') {
    return { ready: false, ageMs: Math.max(0, Date.now() - technical.sourceTimestamp), missing: ['live_technical_analysis'], required: true };
  }
  const ageMs = Math.max(0, Date.now() - technical.sourceTimestamp);
  const maxAgeMs = Math.max(30_000, Number(process.env.TRADINGVIEW_DATA_TTL_MS || 300_000));
  return {
    ready: ageMs <= maxAgeMs,
    ageMs,
    missing: ageMs <= maxAgeMs ? [] : ['fresh_live_technical_analysis'],
    required: true,
  };
}

function authenticatedFeeEvidence(context: CryptaraOpportunityContext): boolean {
  const evidence = context.plan?.feeEvidence;
  if (!evidence) return false;
  return evidence.buy.source !== 'configured_override' && evidence.sell.source !== 'configured_override';
}

function liquidityCoverage(context: CryptaraOpportunityContext): number {
  const plan = context.plan;
  if (!plan || plan.liquidity.status !== 'measured' ||
      plan.liquidity.buyAvailableBaseQty === null || plan.liquidity.sellAvailableBaseQty === null ||
      !(plan.baseQty > 0)) return 0;
  return Math.max(0, Math.min(1,
    Math.min(plan.liquidity.buyAvailableBaseQty, plan.liquidity.sellAvailableBaseQty) / plan.baseQty,
  ));
}

function venuePair(context: CryptaraOpportunityContext): string | undefined {
  const plan = context.plan;
  return plan ? `${plan.buyVenue}->${plan.sellVenue}` : undefined;
}

function sizeBucket(notionalUsd: number): string {
  if (notionalUsd < 50) return 'lt50';
  if (notionalUsd < 100) return '50_100';
  if (notionalUsd < 250) return '100_250';
  if (notionalUsd < 500) return '250_500';
  if (notionalUsd < 1000) return '500_1000';
  if (notionalUsd < 5000) return '1000_5000';
  return 'gte5000';
}

function toMonteCarloResult(input: {
  simulationId: string;
  notionalUsd: number;
  result: ReturnType<typeof runProfitabilityMonteCarlo>;
}): MonteCarloResult {
  const scale = Math.max(input.notionalUsd, 1e-12);
  const result = input.result;
  return {
    simulationId: input.simulationId,
    timestamp: new Date(),
    iterations: result.samples,
    scenarios: [{
      name: result.calibrationSamples > 0
        ? 'Terminal-settlement calibrated adaptive execution distribution'
        : 'Cold-start symmetric heavy-tail adaptive execution distribution',
      probability: result.profitableProbability,
      expectedReturn: result.p50NetProfitUsd / scale,
      maxDrawdown: Math.max(0, -result.worstNetProfitUsd / scale),
      sharpeRatio: 0,
    }],
    optimalStrategy: 'verified-arbitrage-authoritative-adaptive-mc',
    riskMetrics: {
      valueAtRisk: result.valueAtRisk95Usd / scale,
      expectedShortfall: result.expectedShortfall95Usd / scale,
      maxDrawdown: Math.max(0, -result.worstNetProfitUsd / scale),
      volatility: Math.max(0, (result.p50NetProfitUsd - result.p10NetProfitUsd) / scale),
    },
    learnings: [
      `${result.policyVersion}; ${result.distributionProvenance}; P(profit)=${result.profitableProbability.toFixed(4)}; CI=${result.profitableProbabilityInterval[0].toFixed(4)}-${result.profitableProbabilityInterval[1].toFixed(4)}; p10=${result.p10NetProfitUsd.toFixed(4)}; p5=${result.p5NetProfitUsd.toFixed(4)}; p1=${result.p1NetProfitUsd.toFixed(4)}; ES99=${result.expectedShortfall99Usd.toFixed(4)}`,
    ],
  };
}

export function ensureAuthoritativeMonteCarloWiring(): Cryptara {
  const instance = ensureCryptaraBootstrapWiring();
  if (installed.has(instance)) return instance;
  installed.add(instance);
  const target = instance as unknown as Internals;

  target.runMonteCarloSimulation = async (
    contextOverride?: CryptaraOpportunityContext,
    signal?: AbortSignal,
  ): Promise<MonteCarloResult> => {
    if (!target.status.isRunning) throw new Error('CRYPTARA is not running. Call initialize() first.');
    const source = contextOverride ?? target.latestOpportunityContext;
    if (!source) throw new Error('EVIDENCE_INCOMPLETE: verified_opportunity_context');
    const context = structuredClone(source);
    const plan = context.plan;
    if (!plan || !Number.isFinite(plan.netProfitUsd) || plan.netProfitUsd <= 0) {
      throw new Error('EVIDENCE_INCOMPLETE: verified_positive_opportunity_economics');
    }
    if (signal?.aborted) throw new Error('MC_ABORTED: authoritative Monte Carlo aborted before execution');

    const technical = technicalEvidence(context);
    const missing = [
      ...technical.missing,
      ...(!authenticatedFeeEvidence(context) ? ['authenticated_fee_evidence'] : []),
      ...(plan.liquidity.status !== 'measured' ? ['measured_liquidity'] : []),
      ...(!Number.isFinite(plan.expectedSlippageBps) ? ['measured_slippage_or_impact'] : []),
      ...(!Number.isFinite(plan.expectedPriceImpactBps) ? ['measured_slippage_or_impact'] : []),
    ];
    if (missing.length > 0) throw new Error(`EVIDENCE_INCOMPLETE: ${[...new Set(missing)].join(',')}`);

    const mcTopology = topology(context);
    await monteCarloCalibrationStore.hydrate();
    const calibration = monteCarloCalibrationStore.getSamples({
      topology: mcTopology,
      venuePair: venuePair(context),
      symbol: context.symbol,
      chain: context.chain,
      strategy: mcTopology === 'CEX_CEX' ? 'verified_cex_arbitrage' : undefined,
      sizeBucket: sizeBucket(plan.notionalUsd),
      limit: 2048,
    });
    const quoteMaxAgeMs = Math.max(1, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5000));
    const freshness = Math.max(0, Math.min(1, 1 - plan.quoteAgeMs / quoteMaxAgeMs));
    const liquidity = liquidityCoverage(context);
    const empiricalFill = calibration.bothLegsFillRate;
    const confidence = empiricalFill !== null
      ? Math.max(0.01, Math.min(0.999, empiricalFill * 0.70 + freshness * 0.20 + liquidity * 0.10))
      : Math.max(0.01, Math.min(0.999, freshness * liquidity));

    target.latestMonteCarloEvidence = null;
    target.status.totalSimulations++;
    try {
      const result = runProfitabilityMonteCarlo({
        seed: `${context.opportunityId}:${context.observedAt}:${plan.buyAsk}:${plan.sellBid}:${plan.notionalUsd}`,
        topology: mcTopology,
        notionalUsd: plan.notionalUsd,
        expectedNetProfitUsd: plan.netProfitUsd,
        estimatedExecutionCostUsd: Math.max(0, plan.costs.totalCostsUsd),
        expectedSlippageBps: Math.max(0, plan.expectedSlippageBps ?? 0),
        quoteLatencyMs: Math.max(0, plan.quoteAgeMs),
        quoteMaxAgeMs,
        executionHorizonMs: plan.bridge ? Math.max(quoteMaxAgeMs, plan.bridge.estimatedTimeSec * 1000) : quoteMaxAgeMs,
        confidence,
        baselineSlippageAlreadyIncluded: true,
        calibrationSamples: calibration.samples,
        measuredProfitResidualsUsd: calibration.profitResidualsUsd,
        measuredCostMultipliers: calibration.costMultipliers,
        measuredSlippageResidualsBps: calibration.slippageResidualsBps,
        measuredLatenciesMs: calibration.latenciesMs,
        measuredJointResiduals: calibration.observations.map(observation => ({
          profitResidualUsd: observation.profitResidualUsd,
          costMultiplier: observation.costMultiplier,
          slippageResidualBps: observation.slippageResidualBps,
          latencyMs: observation.latencyMs,
          bothLegsFilled: observation.bothLegsFilled,
          partialFill: observation.partialFill,
          providerFailure: observation.providerFailure,
        })),
      });
      if (signal?.aborted) throw new Error('MC_ABORTED: authoritative Monte Carlo aborted');

      const simulationId = `adaptive-${context.opportunityId}-${context.observedAt}-${result.samples}`;
      const publicResult = toMonteCarloResult({ simulationId, notionalUsd: plan.notionalUsd, result });
      const runtimeConfidence = getRuntimeConfidenceBootstrapStatus(instance);
      const scale = Math.max(plan.notionalUsd, 1e-12);
      const calibrated = calibration.samples >= 3;
      target.latestMonteCarloEvidence = {
        simulationId,
        evaluatedAt: Date.now(),
        sourceOpportunityId: context.opportunityId,
        sourceObservedAt: context.observedAt,
        mode: calibrated ? 'posttrade_calibrated' : 'pretrade_bootstrap',
        calibrationSamples: calibration.samples,
        modelVersion: AUTHORITATIVE_LIVE_MC_MODEL_VERSION,
        policyVersion: result.policyVersion,
        iterations: result.samples,
        seed: 0,
        workersUsed: 1,
        convergence: result.converged ? 1 : 0,
        stoppedEarly: result.stoppedEarly,
        expectedProfit: result.p50NetProfitUsd / scale,
        probabilityOfProfit: result.profitableProbability,
        probabilityInterval: [...result.profitableProbabilityInterval] as [number, number],
        probabilityBothLegsFill: result.probabilityBothLegsFill,
        probabilityLossExceedsThreshold: result.probabilityLossExceedsThreshold,
        probabilityPartialFillLoss: result.probabilityPartialFillLoss,
        valueAtRisk95: result.valueAtRisk95Usd / scale,
        valueAtRisk99: result.valueAtRisk99Usd / scale,
        expectedShortfall: result.expectedShortfall95Usd / scale,
        expectedShortfall975: result.expectedShortfall975Usd / scale,
        expectedShortfall99: result.expectedShortfall99Usd / scale,
        p50: result.p50NetProfitUsd / scale,
        p25: result.p25NetProfitUsd / scale,
        p10: result.p10NetProfitUsd / scale,
        p5: result.p5NetProfitUsd / scale,
        p1: result.p1NetProfitUsd / scale,
        worst: result.worstNetProfitUsd / scale,
        maxDrawdown: Math.max(0, -result.worstNetProfitUsd / scale),
        marketRegime: mcTopology === 'CEX_CEX' ? 'execution_microstructure' : 'execution_calibrated',
        confidence,
        distribution: result.distribution,
        distributionProvenance: result.distributionProvenance,
        executionDeadlineMs: quoteMaxAgeMs,
        executionHorizonMs: result.executionHorizonMs,
        recommendedNotionalUsd: plan.notionalUsd,
        maxSafeNotionalUsd: plan.executableNotionalUsd,
        averageSampledSlippageBps: Math.max(0, plan.expectedSlippageBps ?? 0),
        averageSampledLatencyMs: calibration.latenciesMs.length > 0
          ? calibration.latenciesMs.reduce((sum, value) => sum + value, 0) / calibration.latenciesMs.length
          : plan.quoteAgeMs,
        confidenceEnabled: runtimeConfidence.confidenceEnabled,
        confidenceState: runtimeConfidence.state,
        runtimeSuccessfulTrades: runtimeConfidence.successfulTrades,
        runtimeRequiredSuccessfulTrades: runtimeConfidence.requiredSuccessfulTrades,
        runtimeRemainingSuccessfulTrades: runtimeConfidence.remainingSuccessfulTrades,
        runtimeConfidenceStartedAt: runtimeConfidence.startedAt,
        missingInformation: [
          ...(runtimeConfidence.confidenceEnabled ? [] : ['runtime_confidence_bootstrap']),
          ...(result.approved ? [] : ['monte_carlo_approval']),
        ],
      };
      target.status.lastSimulationTime = new Date();
      target.emit('simulation:completed', publicResult);
      log.info('Authoritative live Monte Carlo completed', {
        opportunityId: context.opportunityId,
        observedAt: context.observedAt,
        topology: mcTopology,
        policyVersion: result.policyVersion,
        distribution: result.distribution,
        distributionProvenance: result.distributionProvenance,
        calibrationSamples: calibration.samples,
        samples: result.samples,
        converged: result.converged,
        probabilityOfProfit: result.profitableProbability,
        probabilityInterval: result.profitableProbabilityInterval,
        probabilityBothLegsFill: result.probabilityBothLegsFill,
        p10NetProfitUsd: result.p10NetProfitUsd,
        p5NetProfitUsd: result.p5NetProfitUsd,
        p1NetProfitUsd: result.p1NetProfitUsd,
        expectedShortfall95Usd: result.expectedShortfall95Usd,
        expectedShortfall975Usd: result.expectedShortfall975Usd,
        expectedShortfall99Usd: result.expectedShortfall99Usd,
        executionHorizonMs: result.executionHorizonMs,
        approved: result.approved,
        evidenceProvenance: [
          'deterministic_positive_economics',
          'measured_order_book',
          'authenticated_fee_evidence',
          'measured_slippage_and_price_impact',
          mcTopology === 'CEX_CEX'
            ? (technical.ready ? 'technical_advisory_available' : 'technical_advisory_not_required')
            : (technical.ready ? 'fresh_live_or_cached_from_live_technical' : 'technical_unavailable'),
          ...calibration.provenance,
        ],
      });
      return publicResult;
    } catch (error) {
      target.latestMonteCarloEvidence = null;
      target.status.errorCount++;
      throw error;
    }
  };

  log.info('Shared adaptive Monte Carlo installed as live Cryptara authority', {
    component: 'AuthoritativeMonteCarloWiring',
    modelVersion: AUTHORITATIVE_LIVE_MC_MODEL_VERSION,
    livePolicy: 'monte-carlo-policy',
    terminalCalibration: true,
    empiricalJointResiduals: true,
    cexTechnicalAnalysisRole: 'advisory_not_execution_gate',
    cexExecutionCriticalEvidence: ['deterministic_positive_economics', 'authenticated_fee_evidence', 'measured_liquidity', 'measured_slippage_or_impact', 'quote_freshness'],
    legacyHyperRole: 'training_compatibility_only',
    legacyGeneralMonteCarloRole: 'non_authoritative_compatibility',
    deterministicPositiveGate: true,
  });
  return instance;
}
