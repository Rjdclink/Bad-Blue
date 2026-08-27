import logger from '../../../logger.js';
import { canonicalExecutionScheduler } from '../execution/canonical-execution-scheduler.js';
import { autonomousFaucet } from './autonomous-faucet.js';
import {
  competitionThreatContribution,
  evaluateCompetitionEvidence,
  finiteReasoningInput,
  resolveCompetitionEvidence,
} from './competition-evidence-policy.js';

const installed = new WeakSet<object>();

type FaucetReasoning = {
  action: string;
  confidence: number;
} | null;

type FaucetExpectedProfit = {
  status: 'VALID_POSITIVE' | 'VALID_ZERO' | 'VALID_NEGATIVE' | 'INCOMPLETE_DATA';
  grossProfitUsd: number | null;
  netProfitUsd: number | null;
  reason: string;
};

type FaucetValidator = {
  name: string;
  passed: boolean;
  weight: number;
  details: string;
};

type FaucetOpenDecision = {
  shouldOpen: boolean;
  shouldClose: boolean;
  confidence: number;
  reasons: string[];
  validators: FaucetValidator[];
};

type FaucetRuntime = {
  state: {
    executionMode: 'disabled' | 'live';
    lastArbitrageDecision: 'EXECUTE' | 'PENDING' | 'SKIP' | 'ERROR' | 'NONE';
    lastVerifiedArbitrage: unknown | null;
    healthScore: number;
    consecutiveFailures: number;
  };
  marketConditions: {
    volatility: number;
    gasEfficiency: number;
    competitionLevel: number;
    confidence: number;
    technicalSignal: 'bullish' | 'bearish' | 'neutral' | 'unknown';
    technicalDataProvenance: 'live' | 'cached' | 'deterministic-fallback' | 'no-data';
    timestamp: number;
    lastMarketGateError?: string;
  };
  circuitBreaker: {
    isOpen: boolean;
  };
  hasCurrentMarketData: () => boolean;
  performDimensionalReasoning: () => Promise<FaucetReasoning>;
  calculateExpectedProfit: () => Promise<FaucetExpectedProfit>;
  calculateThreatIndicator: () => number;
  makeOpenDecision: () => Promise<FaucetOpenDecision>;
  executeWithStealth: () => Promise<void>;
};

const OPENING_POLICY = Object.freeze({
  minConfidenceToOpen: 0.7,
  minValidatorsToOpen: 4,
  minExpectedProfitToOpen: 0,
  maxGasToOpen: 10,
  maxCompetitionToOpen: 0.7,
});

function finiteOrNull(value: unknown): number | null {
  return finiteReasoningInput(value);
}

function formatMoney(value: number | null): string {
  return value === null ? 'n/a' : `$${value.toFixed(2)}`;
}

/**
 * Compatibility bridge for the legacy faucet state machine.
 *
 * Execution authority is no longer a faucet-local hourly/day/window counter or a
 * coarse process-wide concurrency integer. The canonical execution scheduler owns
 * admission from measured eligible opportunities and obtains distributed resource,
 * venue, nonce, inventory-domain, settlement, and opportunity-idempotency leases.
 *
 * The faucet may continue to expose legacy UI/status fields, but those fields do
 * not authorize or throttle production order submission.
 *
 * The bridge also prevents legacy NaN sentinels from becoming decision evidence.
 * The faucet's executable plan type is CEX_CEX, so on-chain mempool competition is
 * not an applicable opening gate. Missing optional numeric inputs skip advisory
 * Cain reasoning rather than entering the reasoning engine as non-finite values.
 */
export function ensureConcurrentExecutionWiring(): void {
  const target = autonomousFaucet as unknown as FaucetRuntime;
  if (installed.has(target)) return;
  installed.add(target);

  canonicalExecutionScheduler.start();

  const originalReasoning = target.performDimensionalReasoning.bind(target);
  target.performDimensionalReasoning = async (): Promise<FaucetReasoning> => {
    const reasoningInputs = {
      volatility: finiteOrNull(target.marketConditions.volatility),
      gasEfficiency: finiteOrNull(target.marketConditions.gasEfficiency),
      confidence: finiteOrNull(target.marketConditions.confidence),
    };
    const missing = Object.entries(reasoningInputs)
      .filter(([, value]) => value === null)
      .map(([name]) => name);
    if (missing.length > 0) {
      logger.debug('[FAUCET] Cain reasoning skipped because measured numeric inputs are incomplete', {
        component: 'ConcurrentExecutionWiring',
        missing,
        syntheticFallbackUsed: false,
      });
      return null;
    }
    return originalReasoning();
  };

  target.calculateThreatIndicator = (): number => {
    const competition = resolveCompetitionEvidence({
      topology: 'CEX_CEX',
      mempool: null,
    });
    let threat = competitionThreatContribution(competition);
    const failures = finiteOrNull(target.state.consecutiveFailures) ?? 0;
    threat += Math.min(1, Math.max(0, failures) / 5) * 0.3;
    if (target.circuitBreaker.isOpen) threat += 0.4;
    return Math.max(0, Math.min(1, Number.isFinite(threat) ? threat : 0));
  };

  target.makeOpenDecision = async (): Promise<FaucetOpenDecision> => {
    const validators: FaucetValidator[] = [];
    const reasons: string[] = [];

    if (!target.hasCurrentMarketData()) {
      return {
        shouldOpen: false,
        shouldClose: false,
        confidence: 0,
        reasons: ['Current live or cached market data is required before opening'],
        validators: [{
          name: 'market_data_freshness',
          passed: false,
          weight: 1,
          details: `Technical data=${target.marketConditions.technicalDataProvenance}, updatedAt=${target.marketConditions.timestamp}`,
        }],
      };
    }

    if (target.marketConditions.lastMarketGateError) {
      return {
        shouldOpen: false,
        shouldClose: false,
        confidence: 0,
        reasons: [`Cryptara market gate blocked current context: ${target.marketConditions.lastMarketGateError}`],
        validators: [{
          name: 'market_gate',
          passed: false,
          weight: 1,
          details: target.marketConditions.lastMarketGateError,
        }],
      };
    }

    const reasoning = await target.performDimensionalReasoning();
    if (reasoning && (reasoning.action === 'HIBERNATE' || reasoning.action === 'EVADE')) {
      const confidence = finiteOrNull(reasoning.confidence) ?? 0;
      return {
        shouldOpen: false,
        shouldClose: true,
        confidence,
        reasons: [`Cain reasoning action: ${reasoning.action}`],
        validators: [{
          name: 'cain_reasoning',
          passed: false,
          weight: 0.30,
          details: `Dimensional reasoning: ${reasoning.action} (confidence: ${confidence.toFixed(2)})`,
        }],
      };
    }

    const expectedProfit = await target.calculateExpectedProfit();
    const netProfit = finiteOrNull(expectedProfit.netProfitUsd);
    const grossProfit = finiteOrNull(expectedProfit.grossProfitUsd);
    const profitPasses = expectedProfit.status === 'VALID_POSITIVE'
      && netProfit !== null
      && netProfit >= OPENING_POLICY.minExpectedProfitToOpen;
    validators.push({
      name: 'profitability',
      passed: profitPasses,
      weight: 0.25,
      details: `Status: ${expectedProfit.status}; gross=${formatMoney(grossProfit)}; net=${formatMoney(netProfit)}; ${expectedProfit.reason}`,
    });
    if (!profitPasses) reasons.push(`Insufficient expected profit: ${netProfit === null ? expectedProfit.status : formatMoney(netProfit)}`);

    const gas = finiteOrNull(target.marketConditions.gasEfficiency);
    const gasPasses = gas !== null && gas <= OPENING_POLICY.maxGasToOpen;
    validators.push({
      name: 'gas_cost',
      passed: gasPasses,
      weight: 0.20,
      details: gas === null
        ? `Gas cost: unknown (max: $${OPENING_POLICY.maxGasToOpen})`
        : `Gas cost: $${gas.toFixed(2)} (max: $${OPENING_POLICY.maxGasToOpen})`,
    });
    if (!gasPasses) reasons.push(gas === null ? 'Gas-cost evidence unavailable' : `Gas too expensive: $${gas.toFixed(2)}`);

    const competitionEvidence = resolveCompetitionEvidence({
      topology: 'CEX_CEX',
      mempool: null,
    });
    const competition = evaluateCompetitionEvidence(
      competitionEvidence,
      OPENING_POLICY.maxCompetitionToOpen,
    );
    validators.push({
      name: 'competition',
      passed: competition.passed,
      weight: 0.20,
      details: competition.details,
    });
    if (competition.reason) reasons.push(competition.reason);

    const technicalPasses = target.marketConditions.technicalSignal === 'bullish'
      || target.marketConditions.technicalSignal === 'neutral';
    validators.push({
      name: 'technical_signal',
      passed: technicalPasses,
      weight: 0.15,
      details: `Technical signal: ${target.marketConditions.technicalSignal}`,
    });
    if (!technicalPasses) reasons.push('Bearish or unknown market conditions');

    const health = finiteOrNull(target.state.healthScore);
    const healthPasses = health !== null && health >= 70;
    validators.push({
      name: 'system_health',
      passed: healthPasses,
      weight: 0.10,
      details: health === null ? 'Health score: unknown' : `Health score: ${health}/100`,
    });
    if (!healthPasses) reasons.push(health === null ? 'System health evidence unavailable' : `System health degraded: ${health}/100`);

    const circuitPasses = !target.circuitBreaker.isOpen;
    validators.push({
      name: 'circuit_breaker',
      passed: circuitPasses,
      weight: 0.10,
      details: `Circuit breaker: ${target.circuitBreaker.isOpen ? 'OPEN' : 'CLOSED'}`,
    });
    if (!circuitPasses) reasons.push('Circuit breaker is open');

    // Competition is explicitly not applicable to CEX_CEX, so confidence is
    // normalized over the applicable validator weights instead of awarding or
    // removing an artificial 20% score for an unrelated on-chain signal.
    const applicableValidators = validators.filter(validator => validator.name !== 'competition');
    const applicableWeight = applicableValidators.reduce((sum, validator) => sum + validator.weight, 0);
    const passedWeight = applicableValidators.reduce(
      (sum, validator) => sum + (validator.passed ? validator.weight : 0),
      0,
    );
    const confidence = applicableWeight > 0 ? passedWeight / applicableWeight : 0;
    const passedCount = applicableValidators.filter(validator => validator.passed).length;
    const requiredCount = Math.min(OPENING_POLICY.minValidatorsToOpen, applicableValidators.length);

    logger.info('[FAUCET] Opening validators evaluated', {
      component: 'AutonomousFaucet',
      passed: passedCount,
      applicable: applicableValidators.length,
      total: validators.length,
      notApplicable: ['competition'],
      confidence,
      validators: validators.map(validator => ({
        name: validator.name,
        passed: validator.passed,
        details: validator.details,
      })),
    });

    const shouldOpen = profitPasses
      && confidence >= OPENING_POLICY.minConfidenceToOpen
      && passedCount >= requiredCount
      && circuitPasses;

    if (shouldOpen) {
      reasons.push(`All applicable criteria met: ${passedCount}/${applicableValidators.length} validators passed, confidence: ${(confidence * 100).toFixed(1)}%`);
    }

    return {
      shouldOpen,
      shouldClose: false,
      confidence,
      reasons,
      validators,
    };
  };

  target.executeWithStealth = async (): Promise<void> => {
    if (target.state.executionMode !== 'live') {
      target.state.lastArbitrageDecision = 'SKIP';
      return;
    }

    const before = canonicalExecutionScheduler.getStats();
    await canonicalExecutionScheduler.dispatchOnce();
    const after = canonicalExecutionScheduler.getStats();

    target.state.lastArbitrageDecision = after.settled > before.settled
      ? 'EXECUTE'
      : after.pending > before.pending
        ? 'PENDING'
        : after.failed > before.failed
          ? 'ERROR'
          : 'SKIP';
  };

  logger.info('[FAUCET] Canonical execution scheduler wiring installed', {
    component: 'ConcurrentExecutionWiring',
    authority: 'canonical_resource_leased_scheduler',
    legacyBusinessCapsAuthoritative: false,
    coarseGlobalConcurrencyCapAuthoritative: false,
    distributedOpportunityIdempotency: true,
    distributedResourceLeases: true,
    settlementSemantics: 'terminal_realized_only',
    competitionEvidenceAuthority: 'topology_aware_no_nan',
    cexMempoolCompetitionApplicability: 'not_applicable',
    nonFiniteReasoningPolicy: 'skip_optional_reasoning_no_synthetic_fallback',
    scheduler: canonicalExecutionScheduler.getStats(),
  });
}
