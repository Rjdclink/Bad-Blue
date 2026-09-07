import type Cryptara from '../../cryptara/index.js';
import type { CryptaraOpportunityContext, MonteCarloResult } from '../../cryptara/index.js';
import { createLogger } from '../../../logger.js';
import { ensureCryptaraBeamWiring } from './cryptara-beam-wiring.js';
import { getCryptaraKalshiPredictionSnapshot } from './cryptara-kalshi-prediction-wiring.js';
import { getKalshiQuantiContext, type KalshiQuantiContext } from './kalshi-quanti-context.js';

const log = createLogger('KalshiMonteCarloContextWiring');
const installed = new WeakSet<object>();
const contexts = new Map<string, KalshiMonteCarloContextSnapshot>();
const MAX_CONTEXTS = Math.max(100, Math.min(10_000, Number(process.env.KALSHI_MC_CONTEXT_MAX || 2_000)));

export interface KalshiMonteCarloContextSnapshot {
  opportunityId: string;
  simulationId: string;
  evaluatedAt: number;
  kalshiSignalCount: number;
  kalshiFreshSignalCount: number;
  kalshiQualityScore: number;
  quantiContextAvailable: boolean;
  quantiContext: KalshiQuantiContext | null;
  baseMonteCarloIterations: number;
  baseScenarioProbabilities: number[];
  kalshiProbabilityAdjustmentApplied: false;
  deterministicEconomicsChanged: false;
  monteCarloAuthorityChanged: false;
  executionAuthority: false;
}

type MonteCarloTarget = {
  latestOpportunityContext: CryptaraOpportunityContext | null;
  runMonteCarloSimulation: (context?: CryptaraOpportunityContext, signal?: AbortSignal) => Promise<MonteCarloResult>;
};

function store(snapshot: KalshiMonteCarloContextSnapshot): void {
  contexts.delete(snapshot.opportunityId);
  contexts.set(snapshot.opportunityId, snapshot);
  while (contexts.size > MAX_CONTEXTS) {
    const oldest = contexts.keys().next().value as string | undefined;
    if (!oldest) break;
    contexts.delete(oldest);
  }
}

export function getKalshiMonteCarloContextSnapshot(opportunityId: string): KalshiMonteCarloContextSnapshot | null {
  const snapshot = contexts.get(opportunityId);
  return snapshot ? structuredClone(snapshot) : null;
}

/**
 * Kalshi market-implied probabilities are deliberately not injected into the
 * canonical Monte Carlo probability distribution until terminal outcome/fill
 * calibration proves a defensible mapping. This wrapper still makes Kalshi's
 * measured context visible to the MC learning surface immediately and records
 * whether QuantiComp has completed its structural analysis for the opportunity.
 */
export function ensureKalshiMonteCarloContextWiring(): Cryptara {
  const instance = ensureCryptaraBeamWiring();
  if (installed.has(instance)) return instance;
  installed.add(instance);
  const target = instance as unknown as MonteCarloTarget;
  const originalRun = target.runMonteCarloSimulation.bind(target);

  target.runMonteCarloSimulation = async (
    contextOverride?: CryptaraOpportunityContext,
    signal?: AbortSignal,
  ): Promise<MonteCarloResult> => {
    const context = contextOverride ?? target.latestOpportunityContext;
    const result = await originalRun(contextOverride, signal);
    if (!context) return result;

    const kalshi = getCryptaraKalshiPredictionSnapshot(context.opportunityId);
    const quanti = getKalshiQuantiContext(context.opportunityId, kalshi?.evaluatedAt);
    const snapshot: KalshiMonteCarloContextSnapshot = {
      opportunityId: context.opportunityId,
      simulationId: result.simulationId,
      evaluatedAt: Date.now(),
      kalshiSignalCount: kalshi?.signalCount ?? 0,
      kalshiFreshSignalCount: kalshi?.freshSignalCount ?? 0,
      kalshiQualityScore: kalshi?.qualityScore ?? 0,
      quantiContextAvailable: quanti !== null,
      quantiContext: quanti,
      baseMonteCarloIterations: result.iterations,
      baseScenarioProbabilities: result.scenarios.map(scenario => scenario.probability),
      kalshiProbabilityAdjustmentApplied: false,
      deterministicEconomicsChanged: false,
      monteCarloAuthorityChanged: false,
      executionAuthority: false,
    };
    store(snapshot);

    return {
      ...result,
      learnings: [...new Set([
        ...result.learnings,
        `kalshi_context_signals:${snapshot.kalshiSignalCount}`,
        `kalshi_context_quality:${snapshot.kalshiQualityScore.toFixed(6)}`,
        `kalshi_quanti_context:${snapshot.quantiContextAvailable ? 'available' : 'pending_or_absent'}`,
        'kalshi_probability_adjustment:false_uncalibrated',
        'kalshi_deterministic_economics_changed:false',
      ])],
    };
  };

  log.info('Kalshi context connected to authoritative Monte Carlo learning surface', {
    component: 'KalshiMonteCarloContextWiring',
    kalshiProbabilityAdjustmentApplied: false,
    reason: 'terminal_calibration_required_before_probability_mapping',
    deterministicEconomicsChanged: false,
    monteCarloAuthorityChanged: false,
    executionAuthority: false,
  });
  return instance;
}
