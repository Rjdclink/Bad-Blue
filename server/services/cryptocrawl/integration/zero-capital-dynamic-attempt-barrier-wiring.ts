import type { Wallet, providers } from 'ethers';
import logger from '../../../logger.js';
import {
  zeroCapitalEngine,
  type SupportedChain,
  type ZeroCapitalOpportunity,
} from '../core/zero-capital-engine.js';
import { buildFlashLoanExecutionPlanFromOpportunity } from '../execution/adapters/autonomous-route-planner.js';
import { buildFlashLoanReceiverPayloadFromPlan } from '../execution/adapters/flashloan-receiver-builder.js';
import { buildDualFlashLoanReceiverPayload } from '../execution/adapters/dual-flashloan-receiver-builder.js';
import { flashLoanProviderSelectionRegistry } from '../execution/adapters/flash-loan-provider-selection-registry.js';
import { dualFlashLoanProviderSelectionRegistry } from '../execution/adapters/dual-flash-loan-provider-selection-registry.js';
import type { FlashLoanProviderKind } from '../execution/adapters/flash-loan-provider-economics.js';

const installed = new WeakSet<object>();

type BarrierProviderKind = FlashLoanProviderKind | 'aave_balancer_dual';

interface FundingDecisionLike {
  mode: 'sponsored' | 'native' | 'unavailable';
  reason: string;
}

type ZeroCapitalBarrierRuntime = {
  executeAndRecord: (opportunity: ZeroCapitalOpportunity) => Promise<void>;
  providers: Map<SupportedChain, providers.JsonRpcProvider>;
  executionWallets: Map<SupportedChain, Wallet>;
  receiverManager: { getReceiver: (chain: string) => string | null };
  getGasFundingDecision: (chain: SupportedChain) => Promise<FundingDecisionLike>;
};

export interface DynamicAttemptBarrierDecision {
  opportunityId: string;
  chain: SupportedChain;
  observedAt: number;
  approved: boolean;
  reason: string;
  fundingMode: FundingDecisionLike['mode'];
  flashLoanProvider: BarrierProviderKind;
  exactCallPassed: boolean;
  exactGasEstimatePassed: boolean;
  estimatedGasUnits: bigint | null;
  expectedNetProfit: bigint;
  failedAttemptExposure: bigint;
  dynamicBarrier: bigint;
  profitToFailureExposureRatio: number | null;
  quoteAgeFraction: number;
  confidence: number;
  expectedSlippageBps: number;
  barrierMultiple: number;
  authority: 'pre_broadcast_defer_only';
  executionAuthority: false;
}

let latest: DynamicAttemptBarrierDecision | null = null;
let deferrals = 0;
let approvals = 0;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ratio(numerator: bigint, denominator: bigint): number | null {
  if (denominator <= 0n) return null;
  const scaled = Number((numerator * 1_000_000n) / denominator) / 1_000_000;
  return Number.isFinite(scaled) ? scaled : null;
}

function multiplyCeil(value: bigint, multiplier: number): bigint {
  if (value <= 0n) return 0n;
  const millionths = BigInt(Math.max(1, Math.ceil(multiplier * 1_000_000)));
  return (value * millionths + 999_999n) / 1_000_000n;
}

function quoteAgeFraction(opportunity: ZeroCapitalOpportunity, now = Date.now()): number {
  const lifetime = Math.max(1, opportunity.expiresAt - opportunity.timestamp);
  return clamp((now - opportunity.timestamp) / lifetime, 0, 2);
}

function dynamicBarrierMultiple(opportunity: ZeroCapitalOpportunity, ageFraction: number): number {
  const base = clamp(Number(process.env.ZERO_CAPITAL_ATTEMPT_BARRIER_BASE_MULTIPLE || 1), 0.25, 5);
  const agePenalty = ageFraction * clamp(Number(process.env.ZERO_CAPITAL_ATTEMPT_BARRIER_AGE_WEIGHT || 1.5), 0, 4);
  const confidencePenalty = (1 - clamp(opportunity.confidence, 0, 1))
    * clamp(Number(process.env.ZERO_CAPITAL_ATTEMPT_BARRIER_CONFIDENCE_WEIGHT || 2), 0, 5);
  const slippagePenalty = Math.min(2, Math.max(0, opportunity.expectedSlippageBps) / 25)
    * clamp(Number(process.env.ZERO_CAPITAL_ATTEMPT_BARRIER_SLIPPAGE_WEIGHT || 0.75), 0, 3);
  const latencyPenalty = Math.min(2, Math.max(0, opportunity.quoteLatencyMs) / 2_000)
    * clamp(Number(process.env.ZERO_CAPITAL_ATTEMPT_BARRIER_LATENCY_WEIGHT || 0.5), 0, 3);
  return clamp(base + agePenalty + confidencePenalty + slippagePenalty + latencyPenalty, 0.25, 10);
}

async function evaluateBarrier(
  runtime: ZeroCapitalBarrierRuntime,
  opportunity: ZeroCapitalOpportunity,
): Promise<DynamicAttemptBarrierDecision> {
  const observedAt = Date.now();
  const funding = await runtime.getGasFundingDecision(opportunity.chain);
  const provider = runtime.providers.get(opportunity.chain);
  const wallet = runtime.executionWallets.get(opportunity.chain);
  const dualSelection = dualFlashLoanProviderSelectionRegistry.get(opportunity.id, observedAt);
  const selection = dualSelection ? null : flashLoanProviderSelectionRegistry.get(opportunity.id, observedAt);
  const flashLoanProvider: BarrierProviderKind = dualSelection ? 'aave_balancer_dual' : selection?.provider || 'balancer_v2';
  const receiver = dualSelection
    ? dualSelection.receiver
    : selection?.provider === 'aave_v3'
      ? selection.receiver
      : runtime.receiverManager.getReceiver(opportunity.chain);
  const ageFraction = quoteAgeFraction(opportunity, observedAt);
  const barrierMultiple = dynamicBarrierMultiple(opportunity, ageFraction);

  const base = {
    opportunityId: opportunity.id,
    chain: opportunity.chain,
    observedAt,
    fundingMode: funding.mode,
    flashLoanProvider,
    expectedNetProfit: opportunity.expectedProfit,
    quoteAgeFraction: ageFraction,
    confidence: opportunity.confidence,
    expectedSlippageBps: opportunity.expectedSlippageBps,
    barrierMultiple,
    authority: 'pre_broadcast_defer_only' as const,
    executionAuthority: false as const,
  };

  if (opportunity.expectedProfit <= 0n) {
    return {
      ...base,
      approved: false,
      reason: 'Expected all-in net profit is not positive',
      exactCallPassed: false,
      exactGasEstimatePassed: false,
      estimatedGasUnits: null,
      failedAttemptExposure: 0n,
      dynamicBarrier: 0n,
      profitToFailureExposureRatio: null,
    };
  }
  if (Date.now() >= opportunity.expiresAt) {
    return {
      ...base,
      approved: false,
      reason: 'Opportunity expired before exact pre-broadcast validation',
      exactCallPassed: false,
      exactGasEstimatePassed: false,
      estimatedGasUnits: null,
      failedAttemptExposure: 0n,
      dynamicBarrier: 0n,
      profitToFailureExposureRatio: null,
    };
  }

  if (dualSelection) {
    if (dualSelection.expiresAt <= observedAt) {
      return {
        ...base,
        approved: false,
        reason: 'Dual-provider evidence expired before pre-broadcast validation',
        exactCallPassed: false,
        exactGasEstimatePassed: false,
        estimatedGasUnits: null,
        failedAttemptExposure: 0n,
        dynamicBarrier: 0n,
        profitToFailureExposureRatio: null,
      };
    }
    if (wallet && dualSelection.receiverCapability.owner.toLowerCase() !== wallet.address.toLowerCase()) {
      return {
        ...base,
        approved: false,
        reason: 'Dual-provider receiver owner no longer matches execution wallet',
        exactCallPassed: false,
        exactGasEstimatePassed: false,
        estimatedGasUnits: null,
        failedAttemptExposure: 0n,
        dynamicBarrier: 0n,
        profitToFailureExposureRatio: null,
      };
    }
    if (dualSelection.balancerAmount + dualSelection.aaveAmount !== opportunity.flashLoanAmount) {
      return {
        ...base,
        approved: false,
        reason: 'Dual-provider principal split no longer equals exact opportunity notional',
        exactCallPassed: false,
        exactGasEstimatePassed: false,
        estimatedGasUnits: null,
        failedAttemptExposure: 0n,
        dynamicBarrier: 0n,
        profitToFailureExposureRatio: null,
      };
    }
  } else if (selection?.provider === 'aave_v3') {
    if (selection.expiresAt <= observedAt) {
      return {
        ...base,
        approved: false,
        reason: 'Selected Aave provider evidence expired before pre-broadcast validation',
        exactCallPassed: false,
        exactGasEstimatePassed: false,
        estimatedGasUnits: null,
        failedAttemptExposure: 0n,
        dynamicBarrier: 0n,
        profitToFailureExposureRatio: null,
      };
    }
    if (wallet && selection.receiverCapability.owner.toLowerCase() !== wallet.address.toLowerCase()) {
      return {
        ...base,
        approved: false,
        reason: 'Selected Aave receiver owner no longer matches execution wallet',
        exactCallPassed: false,
        exactGasEstimatePassed: false,
        estimatedGasUnits: null,
        failedAttemptExposure: 0n,
        dynamicBarrier: 0n,
        profitToFailureExposureRatio: null,
      };
    }
  }

  if (funding.mode === 'unavailable' || !provider || !wallet || !receiver) {
    return {
      ...base,
      approved: false,
      reason: funding.mode === 'unavailable' ? funding.reason : 'Provider, wallet, or provider-specific verified receiver unavailable',
      exactCallPassed: false,
      exactGasEstimatePassed: false,
      estimatedGasUnits: null,
      failedAttemptExposure: 0n,
      dynamicBarrier: 0n,
      profitToFailureExposureRatio: null,
    };
  }

  let payload;
  try {
    const plan = buildFlashLoanExecutionPlanFromOpportunity(opportunity, {
      receiver,
      provider: selection?.provider || 'balancer_v2',
      profitRecipient: process.env.CRYPTO_PROFIT_WALLET_ADDRESS || wallet.address,
      nowMs: Date.now(),
    });
    payload = dualSelection
      ? buildDualFlashLoanReceiverPayload({
          chain: plan.chain,
          receiver,
          loanToken: plan.loanToken,
          balancerAmount: dualSelection.balancerAmount.toString(),
          aaveAmount: dualSelection.aaveAmount.toString(),
          minProfit: plan.minProfit,
          profitRecipient: plan.profitRecipient,
          steps: plan.steps,
          gasLimit: Math.max(1_800_000, plan.gasLimit || 0),
        })
      : buildFlashLoanReceiverPayloadFromPlan(plan);
  } catch (error) {
    return {
      ...base,
      approved: false,
      reason: `Exact ${flashLoanProvider} payload rebuild failed: ${error instanceof Error ? error.message : String(error)}`,
      exactCallPassed: false,
      exactGasEstimatePassed: false,
      estimatedGasUnits: null,
      failedAttemptExposure: 0n,
      dynamicBarrier: 0n,
      profitToFailureExposureRatio: null,
    };
  }

  const request = {
    from: wallet.address,
    to: payload.to,
    data: payload.data,
    value: payload.value,
  };
  const [call, gas] = await Promise.allSettled([
    provider.call(request),
    provider.estimateGas(request),
  ]);
  if (call.status !== 'fulfilled') {
    return {
      ...base,
      approved: false,
      reason: `Exact ${flashLoanProvider} eth_call rejected; defer and re-quote: ${call.reason instanceof Error ? call.reason.message : String(call.reason)}`,
      exactCallPassed: false,
      exactGasEstimatePassed: gas.status === 'fulfilled',
      estimatedGasUnits: gas.status === 'fulfilled' ? BigInt(gas.value.toString()) : null,
      failedAttemptExposure: funding.mode === 'native' ? opportunity.estimatedGasCostInInputToken || 0n : 0n,
      dynamicBarrier: 0n,
      profitToFailureExposureRatio: null,
    };
  }
  if (gas.status !== 'fulfilled') {
    return {
      ...base,
      approved: false,
      reason: `Exact ${flashLoanProvider} gas estimation rejected; defer and re-quote: ${gas.reason instanceof Error ? gas.reason.message : String(gas.reason)}`,
      exactCallPassed: true,
      exactGasEstimatePassed: false,
      estimatedGasUnits: null,
      failedAttemptExposure: funding.mode === 'native' ? opportunity.estimatedGasCostInInputToken || 0n : 0n,
      dynamicBarrier: 0n,
      profitToFailureExposureRatio: null,
    };
  }

  const estimatedGasUnits = BigInt(gas.value.toString());
  const failedAttemptExposure = funding.mode === 'native'
    ? opportunity.estimatedGasCostInInputToken || 0n
    : 0n;
  const dynamicBarrier = multiplyCeil(failedAttemptExposure, barrierMultiple);
  const profitToFailureExposureRatio = ratio(opportunity.expectedProfit, failedAttemptExposure);
  const approved = failedAttemptExposure <= 0n || opportunity.expectedProfit > dynamicBarrier;

  return {
    ...base,
    approved,
    reason: approved
      ? funding.mode === 'sponsored'
        ? `Exact ${flashLoanProvider} call and gas estimate passed; sponsored funding removes direct failed-attempt wallet gas exposure`
        : `Exact ${flashLoanProvider} call/gas passed and profit cushion exceeds dynamic failed-attempt barrier (${barrierMultiple.toFixed(3)}x)`
      : `Defer and re-quote: profit cushion does not exceed dynamic failed-attempt barrier (${barrierMultiple.toFixed(3)}x)`,
    exactCallPassed: true,
    exactGasEstimatePassed: true,
    estimatedGasUnits,
    failedAttemptExposure,
    dynamicBarrier,
    profitToFailureExposureRatio,
  };
}

export function getZeroCapitalDynamicAttemptBarrierSnapshot(): {
  latest: DynamicAttemptBarrierDecision | null;
  approvals: number;
  deferrals: number;
} {
  return {
    latest: latest ? { ...latest } : null,
    approvals,
    deferrals,
  };
}

/**
 * Adds a defer-only pre-broadcast barrier in front of the canonical executor.
 * A blocked opportunity is not counted as a failed trade because no transaction
 * was submitted. The normal scan loop will discover/re-quote the route again.
 * This wrapper can only withhold execution; it cannot grant execution authority.
 */
export function ensureZeroCapitalDynamicAttemptBarrierWiring(): void {
  const runtime = zeroCapitalEngine as unknown as ZeroCapitalBarrierRuntime;
  if (installed.has(runtime)) return;
  installed.add(runtime);

  const originalExecuteAndRecord = runtime.executeAndRecord.bind(runtime);
  runtime.executeAndRecord = async (opportunity): Promise<void> => {
    const age = quoteAgeFraction(opportunity);
    const dualSelection = dualFlashLoanProviderSelectionRegistry.get(opportunity.id);
    const selection = dualSelection ? null : flashLoanProviderSelectionRegistry.get(opportunity.id);
    const decision = await evaluateBarrier(runtime, opportunity).catch(error => ({
      opportunityId: opportunity.id,
      chain: opportunity.chain,
      observedAt: Date.now(),
      approved: false,
      reason: `Dynamic attempt barrier failed closed: ${error instanceof Error ? error.message : String(error)}`,
      fundingMode: 'unavailable' as const,
      flashLoanProvider: dualSelection ? 'aave_balancer_dual' as const : selection?.provider || 'balancer_v2' as const,
      exactCallPassed: false,
      exactGasEstimatePassed: false,
      estimatedGasUnits: null,
      expectedNetProfit: opportunity.expectedProfit,
      failedAttemptExposure: 0n,
      dynamicBarrier: 0n,
      profitToFailureExposureRatio: null,
      quoteAgeFraction: age,
      confidence: opportunity.confidence,
      expectedSlippageBps: opportunity.expectedSlippageBps,
      barrierMultiple: dynamicBarrierMultiple(opportunity, age),
      authority: 'pre_broadcast_defer_only' as const,
      executionAuthority: false as const,
    }));
    latest = decision;

    if (!decision.approved) {
      deferrals++;
      logger.info('[ZeroCapitalBarrier] Opportunity deferred before broadcast', {
        component: 'ZeroCapitalDynamicAttemptBarrier',
        ...decision,
        expectedNetProfit: decision.expectedNetProfit.toString(),
        failedAttemptExposure: decision.failedAttemptExposure.toString(),
        dynamicBarrier: decision.dynamicBarrier.toString(),
        estimatedGasUnits: decision.estimatedGasUnits?.toString() ?? null,
        terminalTradeFailure: false,
        transactionSubmitted: false,
        revalidationAuthority: 'next_fresh_scan',
      });
      return;
    }

    approvals++;
    logger.debug('[ZeroCapitalBarrier] Opportunity passed dynamic pre-broadcast barrier', {
      component: 'ZeroCapitalDynamicAttemptBarrier',
      ...decision,
      expectedNetProfit: decision.expectedNetProfit.toString(),
      failedAttemptExposure: decision.failedAttemptExposure.toString(),
      dynamicBarrier: decision.dynamicBarrier.toString(),
      estimatedGasUnits: decision.estimatedGasUnits?.toString() ?? null,
    });
    await originalExecuteAndRecord(opportunity);
  };

  logger.info('[ZeroCapitalBarrier] Dynamic failed-attempt barrier wiring installed', {
    component: 'ZeroCapitalDynamicAttemptBarrier',
    exactEthCallRequired: true,
    exactGasEstimateRequired: true,
    providerSpecificPayloadParity: ['balancer_v2', 'aave_v3', 'aave_balancer_dual'],
    nativeFailedAttemptExposureUsesMeasuredInputTokenGasEstimate: true,
    sponsoredGasExposureZeroOnlyWhenFundingModeIsSponsored: true,
    barrierIsNotAddedToReportedEconomics: true,
    blockedOpportunityTreatment: 'defer_and_requote_not_failed_trade',
    dynamicInputs: ['quote_age', 'confidence', 'expected_slippage', 'quote_latency', 'funding_mode'],
    executionAuthority: false,
  });
}
