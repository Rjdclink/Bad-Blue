import { randomUUID } from 'node:crypto';
import { quantiComp } from '../../quantiComp/index.js';
import {
  runProfitabilityMonteCarlo,
  type MonteCarloProfitabilityInput,
  type MonteCarloProfitabilityResult,
} from '../execution/adapters/monte-carlo-profitability.js';

export interface GhostWalletAdvisoryInput {
  decisionId: string;
  deterministicNetProfitUsd: number;
  notionalUsd: number;
  estimatedExecutionCostUsd: number;
  expectedSlippageBps: number;
  quoteLatencyMs: number;
  confidence: number;
  deadlineAt?: number;
  samples?: number;
  measuredProfitResidualsUsd?: number[];
  measuredCostMultipliers?: number[];
  measuredSlippageResidualsBps?: number[];
  measuredLatenciesMs?: number[];
}

export interface GhostWalletAdvisoryResult {
  deterministicPositive: boolean;
  heavyComputeUsed: boolean;
  executionAuthority: false;
  writeAuthority: false;
  profitLadderAuthority: false;
  recommendation: 'continue_exact_validation' | 'reject_deterministic' | 'skip_latency' | 'skip_unnecessary_uncertainty';
  monteCarlo: MonteCarloProfitabilityResult | null;
  quantiExecutionId: string | null;
  reason: string;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function materiallyUncertain(input: GhostWalletAdvisoryInput): boolean {
  return finiteNonNegative(input.expectedSlippageBps) > 0
    || finiteNonNegative(input.quoteLatencyMs) > 150
    || Math.max(0, Math.min(1, input.confidence)) < 0.995
    || (input.measuredProfitResidualsUsd?.length || 0) > 0
    || (input.measuredCostMultipliers?.length || 0) > 0
    || (input.measuredSlippageResidualsBps?.length || 0) > 0
    || (input.measuredLatenciesMs?.length || 0) > 0;
}

/**
 * Optional read-only risk evidence for Ghost Wallet decisions. Deterministic
 * positive economics always comes first. QuantiComp is used only for material
 * uncertainty and never gains settlement, write, payout or Profit Ladder authority.
 */
export async function assessGhostWalletWithQuantiMonteCarlo(
  input: GhostWalletAdvisoryInput,
): Promise<GhostWalletAdvisoryResult> {
  if (!(Number.isFinite(input.deterministicNetProfitUsd) && input.deterministicNetProfitUsd > 0)) {
    return {
      deterministicPositive: false,
      heavyComputeUsed: false,
      executionAuthority: false,
      writeAuthority: false,
      profitLadderAuthority: false,
      recommendation: 'reject_deterministic',
      monteCarlo: null,
      quantiExecutionId: null,
      reason: 'deterministic_all_in_net_must_be_positive_before_advisory_compute',
    };
  }

  const now = Date.now();
  if (input.deadlineAt !== undefined && input.deadlineAt - now <= 250) {
    return {
      deterministicPositive: true,
      heavyComputeUsed: false,
      executionAuthority: false,
      writeAuthority: false,
      profitLadderAuthority: false,
      recommendation: 'skip_latency',
      monteCarlo: null,
      quantiExecutionId: null,
      reason: 'deadline_too_near_for_advisory_compute_exact_validation_remains_authoritative',
    };
  }

  if (!materiallyUncertain(input)) {
    return {
      deterministicPositive: true,
      heavyComputeUsed: false,
      executionAuthority: false,
      writeAuthority: false,
      profitLadderAuthority: false,
      recommendation: 'skip_unnecessary_uncertainty',
      monteCarlo: null,
      quantiExecutionId: null,
      reason: 'atomic_or_high_confidence_path_does_not_benefit_from_extra_compute',
    };
  }

  const mcInput: MonteCarloProfitabilityInput = {
    seed: `ghost-wallet:${input.decisionId}`,
    notionalUsd: finiteNonNegative(input.notionalUsd),
    expectedNetProfitUsd: input.deterministicNetProfitUsd,
    estimatedExecutionCostUsd: finiteNonNegative(input.estimatedExecutionCostUsd),
    expectedSlippageBps: finiteNonNegative(input.expectedSlippageBps),
    quoteLatencyMs: finiteNonNegative(input.quoteLatencyMs),
    confidence: Math.max(0, Math.min(1, input.confidence)),
    samples: input.samples,
    topology: 'ZERO_CAPITAL',
    executionHorizonMs: input.deadlineAt === undefined ? undefined : Math.max(1, input.deadlineAt - now),
    measuredProfitResidualsUsd: input.measuredProfitResidualsUsd,
    measuredCostMultipliers: input.measuredCostMultipliers,
    measuredSlippageResidualsBps: input.measuredSlippageResidualsBps,
    measuredLatenciesMs: input.measuredLatenciesMs,
  };

  const workloadId = `ghost-wallet-advisory:${input.decisionId}:${randomUUID()}`;
  const execution = await quantiComp.submit({
    id: workloadId,
    kind: 'ghost_wallet_monte_carlo_advisory',
    lane: 'ultra_hot',
    priority: 900_000,
    input: mcInput,
    features: {
      notionalUsd: mcInput.notionalUsd,
      deterministicNetProfitUsd: mcInput.expectedNetProfitUsd,
      expectedSlippageBps: mcInput.expectedSlippageBps,
      quoteLatencyMs: mcInput.quoteLatencyMs,
    },
    resourceHints: {
      cpuWeight: 2,
      ioWeight: 0,
      expectedDurationMs: Math.min(500, Math.max(25, (input.deadlineAt ?? (now + 500)) - now)),
      preferredBackend: 'worker_thread',
    },
    policy: {
      timeoutMs: Math.min(1_000, Math.max(50, (input.deadlineAt ?? (now + 1_000)) - now - 25)),
      deadlineAt: input.deadlineAt,
      deterministic: true,
      sideEffectFree: true,
      backendEligible: true,
      allowDeduplication: true,
      dedupeKey: `ghost-wallet-advisory:${input.decisionId}`,
      strictValidation: true,
    },
    execute: value => runProfitabilityMonteCarlo(value),
    validate: result => Boolean(
      result
      && Number.isFinite(result.profitableProbability)
      && result.profitableProbability >= 0
      && result.profitableProbability <= 1
      && Number.isFinite(result.valueAtRisk99Usd)
      && result.valueAtRisk99Usd >= 0
    ),
  });

  return {
    deterministicPositive: true,
    heavyComputeUsed: true,
    executionAuthority: false,
    writeAuthority: false,
    profitLadderAuthority: false,
    recommendation: 'continue_exact_validation',
    monteCarlo: execution.result,
    quantiExecutionId: execution.executionId,
    reason: 'quanticomp_monte_carlo_advisory_only_exact_transaction_simulation_and_atomic_settlement_remain_authoritative',
  };
}
