import logger from '../../../logger.js';
import { canonicalExecutionScheduler } from '../execution/canonical-execution-scheduler.js';
import { ensureCryptaraCexEvidenceWiring } from '../integration/cryptara-cex-evidence-wiring.js';
import { autonomousFaucet } from './autonomous-faucet.js';
import {
  competitionThreatContribution,
  evaluateCompetitionEvidence,
  finiteReasoningInput,
  resolveCompetitionEvidence,
} from './competition-evidence-policy.js';

const installed = new WeakSet<object>();

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
  calculateExpectedProfit: () => Promise<FaucetExpectedProfit>;
  calculateThreatIndicator: () => number;
  makeOpenDecision: () => Promise<FaucetOpenDecision>;
  executeWithStealth: () => Promise<void>;
};

const OPENING_POLICY = Object.freeze({
  minConfidenceToOpen: 0.7,
  minValidatorsToOpen: 4,
  minExpectedProfitToOpen: 0,
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
 * Scheduler lifecycle is owned by CryptoCoreRuntime. This bridge only delegates
 * the faucet's compatibility dispatch method; it does not start or stop the
 * scheduler itself.
 *
 * The legacy faucet's executable plan is CEX_CEX. On-chain gas, mempool competition,
 * and Cain's legacy mixed-topology reasoning therefore do not authorize or block
 * CEX opening. Missing/non-finite legacy sentinels are never converted to synthetic
 * numeric evidence. Deterministic positive all-in economics remains mandatory.
 */
export function ensureConcurrentExecutionWiring(): void {
  const target = autonomousFaucet as unknown as FaucetRuntime;
  if (installed.has(target)) return;
  installed.add(target);
  ensureCryptaraCexEvidenceWiring();

  // Defense in depth: if legacy Cain diagnostics call this helper elsewhere,
  // topology-inapplicable competition contributes no numeric threat pressure and
  // the returned value is always finite. Cain itself is not consulted by the
  // patched CEX opening decision below.
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

    validators.push({
      name: 'gas_cost',
      passed: true,
      weight: 0.20,
      details: 'Gas cost: N/A for CEX_CEX (no on-chain transaction is submitted by this route)',
    });

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

    const notApplicableNames = new Set(['gas_cost', 'competition']);
    const applicableValidators = validators.filter(validator => !notApplicableNames.has(validator.name));
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
      notApplicable: ['gas_cost', 'competition'],
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
    lifecycleOwner: 'CryptoCoreRuntime',
    legacyBusinessCapsAuthoritative: false,
    coarseGlobalConcurrencyCapAuthoritative: false,
    distributedOpportunityIdempotency: true,
    distributedResourceLeases: true,
    settlementSemantics: 'terminal_realized_only',
    legacyCainCexExecutionAuthority: false,
    competitionEvidenceAuthority: 'topology_aware_no_nan',
    cryptaraCexMempoolPenalty: 'removed_as_not_applicable',
    cexGasApplicability: 'not_applicable',
    cexMempoolCompetitionApplicability: 'not_applicable',
    nonFiniteEvidencePolicy: 'unknown_or_not_applicable_never_synthetic_zero',
    scheduler: canonicalExecutionScheduler.getStats(),
  });
}
