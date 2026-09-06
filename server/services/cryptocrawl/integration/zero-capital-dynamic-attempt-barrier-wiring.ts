import type { Wallet, providers } from 'ethers';
import logger from '../../../logger.js';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { resolveOperationalProfitRecipient } from '../core/wallet-identity.js';
import { buildFlashLoanExecutionPlanFromOpportunity } from '../execution/adapters/autonomous-route-planner.js';
import { buildFlashLoanReceiverPayloadFromPlan } from '../execution/adapters/flashloan-receiver-builder.js';
import { buildDualFlashLoanReceiverPayload } from '../execution/adapters/dual-flashloan-receiver-builder.js';
import { flashLoanProviderSelectionRegistry } from '../execution/adapters/flash-loan-provider-selection-registry.js';
import type { FlashLoanProviderKind } from '../execution/adapters/flash-loan-provider-economics.js';

type BarrierProviderKind = FlashLoanProviderKind | 'aave_balancer_dual';

interface FundingDecisionLike {
  mode: 'sponsored' | 'native' | 'unavailable';
  reason: string;
}

export interface ZeroCapitalBarrierContext {
  providers: Map<SupportedChain, providers.JsonRpcProvider>;
  executionWallets: Map<SupportedChain, Wallet>;
  receiverManager: { getReceiver: (chain: string) => string | null };
  getGasFundingDecision: (chain: SupportedChain) => Promise<FundingDecisionLike>;
}

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
  authority: 'canonical_pre_broadcast_validation';
  executionAuthority: false;
}

let latest: DynamicAttemptBarrierDecision | null = null;
let deferrals = 0;
let approvals = 0;
let compatibilityNoticeLogged = false;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ratio(numerator: bigint, denominator: bigint): number | null {
  if (denominator <= 0n) return null;
  const value = Number((numerator * 1_000_000n) / denominator) / 1_000_000;
  return Number.isFinite(value) ? value : null;
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

function denied(
  opportunity: ZeroCapitalOpportunity,
  observedAt: number,
  funding: FundingDecisionLike,
  flashLoanProvider: BarrierProviderKind,
  reason: string,
  extra: Partial<Pick<DynamicAttemptBarrierDecision, 'exactCallPassed' | 'exactGasEstimatePassed' | 'estimatedGasUnits' | 'failedAttemptExposure'>> = {},
): DynamicAttemptBarrierDecision {
  const age = quoteAgeFraction(opportunity, observedAt);
  const failedAttemptExposure = extra.failedAttemptExposure ?? 0n;
  return {
    opportunityId: opportunity.id,
    chain: opportunity.chain,
    observedAt,
    approved: false,
    reason,
    fundingMode: funding.mode,
    flashLoanProvider,
    exactCallPassed: extra.exactCallPassed ?? false,
    exactGasEstimatePassed: extra.exactGasEstimatePassed ?? false,
    estimatedGasUnits: extra.estimatedGasUnits ?? null,
    expectedNetProfit: opportunity.expectedProfit,
    failedAttemptExposure,
    dynamicBarrier: 0n,
    profitToFailureExposureRatio: ratio(opportunity.expectedProfit, failedAttemptExposure),
    quoteAgeFraction: age,
    confidence: opportunity.confidence,
    expectedSlippageBps: opportunity.expectedSlippageBps,
    barrierMultiple: dynamicBarrierMultiple(opportunity, age),
    authority: 'canonical_pre_broadcast_validation',
    executionAuthority: false,
  };
}

/**
 * Exact pre-broadcast validation used directly by the canonical ZERO_CAPITAL_ATOMIC
 * executor. It can only reject/defer an already-eligible exact opportunity. It has
 * no scheduler, admission, repricing, or submission authority and mutates no engine
 * methods at runtime.
 */
export async function evaluateZeroCapitalDynamicAttemptBarrier(
  context: ZeroCapitalBarrierContext,
  opportunity: ZeroCapitalOpportunity,
): Promise<DynamicAttemptBarrierDecision> {
  const observedAt = Date.now();
  const funding = await context.getGasFundingDecision(opportunity.chain);
  const provider = context.providers.get(opportunity.chain);
  const wallet = context.executionWallets.get(opportunity.chain);
  const selection = flashLoanProviderSelectionRegistry.get(opportunity.id, observedAt);
  const flashLoanProvider: BarrierProviderKind = selection?.kind === 'dual'
    ? 'aave_balancer_dual'
    : selection?.provider || 'balancer_v2';
  const receiver = selection?.receiver || context.receiverManager.getReceiver(opportunity.chain);

  if (opportunity.expectedProfit <= 0n) {
    const result = denied(opportunity, observedAt, funding, flashLoanProvider, 'Expected all-in net profit is not positive');
    latest = result; deferrals++; return result;
  }
  if (observedAt >= opportunity.expiresAt) {
    const result = denied(opportunity, observedAt, funding, flashLoanProvider, 'Opportunity expired before exact pre-broadcast validation');
    latest = result; deferrals++; return result;
  }
  if (!selection) {
    const result = denied(opportunity, observedAt, funding, flashLoanProvider, 'Canonical flash-loan provider selection is unavailable or expired');
    latest = result; deferrals++; return result;
  }
  if (selection.receiverCapability.owner.toLowerCase() !== wallet?.address.toLowerCase()) {
    const result = denied(opportunity, observedAt, funding, flashLoanProvider, 'Selected provider receiver owner no longer matches execution wallet');
    latest = result; deferrals++; return result;
  }
  if (selection.kind === 'dual' && selection.balancerAmount + selection.aaveAmount !== opportunity.flashLoanAmount) {
    const result = denied(opportunity, observedAt, funding, flashLoanProvider, 'Dual-provider principal split no longer equals exact opportunity notional');
    latest = result; deferrals++; return result;
  }
  if (funding.mode === 'unavailable' || !provider || !wallet || !receiver) {
    const result = denied(
      opportunity,
      observedAt,
      funding,
      flashLoanProvider,
      funding.mode === 'unavailable' ? funding.reason : 'Provider, wallet, or selected verified receiver unavailable',
    );
    latest = result; deferrals++; return result;
  }

  let payload: { to: string; data: string; value: string | number };
  try {
    const plan = buildFlashLoanExecutionPlanFromOpportunity(opportunity, {
      receiver,
      provider: selection.kind === 'single' ? selection.provider : 'balancer_v2',
      profitRecipient: resolveOperationalProfitRecipient(),
      nowMs: observedAt,
    });
    payload = selection.kind === 'dual'
      ? buildDualFlashLoanReceiverPayload({
          chain: plan.chain,
          receiver,
          loanToken: plan.loanToken,
          balancerAmount: selection.balancerAmount.toString(),
          aaveAmount: selection.aaveAmount.toString(),
          minProfit: plan.minProfit,
          profitRecipient: plan.profitRecipient,
          steps: plan.steps,
          gasLimit: Math.max(1_800_000, plan.gasLimit || 0),
        })
      : buildFlashLoanReceiverPayloadFromPlan(plan);
  } catch (error) {
    const result = denied(opportunity, observedAt, funding, flashLoanProvider, `Exact provider payload rebuild failed: ${error instanceof Error ? error.message : String(error)}`);
    latest = result; deferrals++; return result;
  }

  const request = { from: wallet.address, to: payload.to, data: payload.data, value: payload.value };
  const [call, gas] = await Promise.allSettled([provider.call(request), provider.estimateGas(request)]);
  const nativeExposure = funding.mode === 'native' ? opportunity.estimatedGasCostInInputToken || 0n : 0n;
  if (call.status !== 'fulfilled') {
    const result = denied(opportunity, observedAt, funding, flashLoanProvider,
      `Exact provider eth_call rejected; defer and re-quote: ${call.reason instanceof Error ? call.reason.message : String(call.reason)}`,
      { exactGasEstimatePassed: gas.status === 'fulfilled', estimatedGasUnits: gas.status === 'fulfilled' ? BigInt(gas.value.toString()) : null, failedAttemptExposure: nativeExposure });
    latest = result; deferrals++; return result;
  }
  if (gas.status !== 'fulfilled') {
    const result = denied(opportunity, observedAt, funding, flashLoanProvider,
      `Exact provider gas estimation rejected; defer and re-quote: ${gas.reason instanceof Error ? gas.reason.message : String(gas.reason)}`,
      { exactCallPassed: true, failedAttemptExposure: nativeExposure });
    latest = result; deferrals++; return result;
  }

  const age = quoteAgeFraction(opportunity, observedAt);
  const barrierMultiple = dynamicBarrierMultiple(opportunity, age);
  const estimatedGasUnits = BigInt(gas.value.toString());
  const dynamicBarrier = multiplyCeil(nativeExposure, barrierMultiple);
  const approved = nativeExposure <= 0n || opportunity.expectedProfit > dynamicBarrier;
  const result: DynamicAttemptBarrierDecision = {
    opportunityId: opportunity.id,
    chain: opportunity.chain,
    observedAt,
    approved,
    reason: approved
      ? funding.mode === 'sponsored'
        ? `Exact ${flashLoanProvider} call and gas estimate passed with verified sponsored funding lane`
        : `Exact ${flashLoanProvider} call/gas passed and profit exceeds dynamic failed-attempt barrier (${barrierMultiple.toFixed(3)}x)`
      : `Defer and re-quote: profit does not exceed dynamic failed-attempt barrier (${barrierMultiple.toFixed(3)}x)`,
    fundingMode: funding.mode,
    flashLoanProvider,
    exactCallPassed: true,
    exactGasEstimatePassed: true,
    estimatedGasUnits,
    expectedNetProfit: opportunity.expectedProfit,
    failedAttemptExposure: nativeExposure,
    dynamicBarrier,
    profitToFailureExposureRatio: ratio(opportunity.expectedProfit, nativeExposure),
    quoteAgeFraction: age,
    confidence: opportunity.confidence,
    expectedSlippageBps: opportunity.expectedSlippageBps,
    barrierMultiple,
    authority: 'canonical_pre_broadcast_validation',
    executionAuthority: false,
  };
  latest = result;
  if (approved) approvals++; else deferrals++;
  return result;
}

export function getZeroCapitalDynamicAttemptBarrierSnapshot() {
  return { latest: latest ? { ...latest } : null, approvals, deferrals };
}

/** Compatibility only. Canonical startup no longer installs a runtime wrapper. */
export function ensureZeroCapitalDynamicAttemptBarrierWiring(): void {
  if (compatibilityNoticeLogged) return;
  compatibilityNoticeLogged = true;
  logger.info('[ZeroCapitalBarrier] Compatibility installer retained without runtime mutation', {
    component: 'ZeroCapitalDynamicAttemptBarrier',
    validationAuthority: 'canonical_zero_capital_executor_direct_call',
    executeAndRecordMutation: false,
    executionAuthority: false,
  });
}
