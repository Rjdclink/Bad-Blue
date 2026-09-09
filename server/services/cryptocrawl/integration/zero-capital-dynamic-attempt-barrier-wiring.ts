import { BigNumber, type Wallet, type providers } from 'ethers';
import logger from '../../../logger.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
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
  sponsorOperatorMonetaryCostProvenZero?: boolean;
  providerBillingLiability?: boolean;
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
  measuredFeePerGasWei: bigint | null;
  measuredGasCostInInputToken: bigint | null;
  preBroadcastNetProfit: bigint | null;
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

const NATIVE_SYMBOL: Partial<Record<SupportedChain, 'ETH' | 'POL' | 'BNB' | 'AVAX'>> = {
  ethereum: 'ETH',
  polygon: 'POL',
  arbitrum: 'ETH',
  optimism: 'ETH',
  bsc: 'BNB',
  avalanche: 'AVAX',
};
const PRICE_SCALE = 100_000_000n;
const ONE_NATIVE = 1_000_000_000_000_000_000n;

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

function scaledUsdPrice(value: number | undefined): bigint | null {
  if (!Number.isFinite(value) || Number(value) <= 0) return null;
  const scaled = Math.round(Number(value) * Number(PRICE_SCALE));
  return Number.isSafeInteger(scaled) && scaled > 0 ? BigInt(scaled) : null;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Gas conversion denominator must be positive');
  return (numerator + denominator - 1n) / denominator;
}

/**
 * EIP-1559 constrains the next-block base-fee increase. Use the current block plus
 * the maximum one-block increase and current priority-fee suggestion, bounded by
 * maxFeePerGas. Legacy/non-1559 chains use the provider's current gasPrice.
 * This is a current pre-broadcast cost bound, not a hard-coded gas constant.
 */
async function currentFeePerGasWei(provider: providers.JsonRpcProvider): Promise<bigint | null> {
  const [feeData, block] = await Promise.all([
    provider.getFeeData().catch(() => null),
    provider.getBlock('latest').catch(() => null),
  ]);
  if (!feeData) return null;
  const maxFee = feeData.maxFeePerGas ? BigInt(feeData.maxFeePerGas.toString()) : null;
  const priority = feeData.maxPriorityFeePerGas ? BigInt(feeData.maxPriorityFeePerGas.toString()) : 0n;
  const base = block?.baseFeePerGas ? BigInt(block.baseFeePerGas.toString()) : null;
  if (base !== null && base > 0n) {
    // Base-fee maximum change denominator is 8, so ceil(base/8) is the safe
    // next-block increase bound before adding the suggested priority fee.
    const nextBaseBound = base + ceilDiv(base, 8n);
    const expected = nextBaseBound + priority;
    return maxFee !== null && maxFee > 0n ? (expected < maxFee ? expected : maxFee) : expected;
  }
  const gasPrice = feeData.gasPrice ? BigInt(feeData.gasPrice.toString()) : null;
  if (gasPrice !== null && gasPrice > 0n) return gasPrice;
  if (maxFee !== null && maxFee > 0n) return maxFee;
  return null;
}

async function measuredGasEconomics(input: {
  provider: providers.JsonRpcProvider;
  opportunity: ZeroCapitalOpportunity;
  funding: FundingDecisionLike;
  estimatedGasUnits: bigint;
}): Promise<{ feePerGasWei: bigint; gasCostInputBaseUnits: bigint } | null> {
  const { opportunity, funding } = input;
  if (funding.mode === 'sponsored' && funding.sponsorOperatorMonetaryCostProvenZero === true) {
    return { feePerGasWei: 0n, gasCostInputBaseUnits: 0n };
  }

  // Native system-owned gas and provider sponsorship that is billed back to the
  // operator both remain real all-in economic costs.
  const hasEconomicGasLiability = funding.mode === 'native'
    || (funding.mode === 'sponsored' && funding.providerBillingLiability !== false);
  if (!hasEconomicGasLiability) return { feePerGasWei: 0n, gasCostInputBaseUnits: 0n };

  const nativeSymbol = NATIVE_SYMBOL[opportunity.chain];
  if (!nativeSymbol) return null;
  const feePerGasWei = await currentFeePerGasWei(input.provider);
  if (feePerGasWei === null || feePerGasWei <= 0n || input.estimatedGasUnits <= 0n) return null;

  let inputPrice = scaledUsdPrice(opportunity.inputAssetUsdPrice);
  let nativePrice: bigint | null = null;
  try {
    const prices = await coinGeckoPriceClient.getLiveSymbolPrices([opportunity.inputAssetSymbol, nativeSymbol]);
    inputPrice = inputPrice ?? scaledUsdPrice(prices.get(opportunity.inputAssetSymbol));
    nativePrice = scaledUsdPrice(prices.get(nativeSymbol));
  } catch {
    return null;
  }
  if (inputPrice === null || nativePrice === null) return null;

  const nativeFeeWei = input.estimatedGasUnits * feePerGasWei;
  const inputScale = 10n ** BigInt(Math.max(0, Math.min(36, opportunity.inputTokenDecimals)));
  const gasCostInputBaseUnits = ceilDiv(
    nativeFeeWei * nativePrice * inputScale,
    ONE_NATIVE * inputPrice,
  );
  return { feePerGasWei, gasCostInputBaseUnits };
}

function reconstructedGrossProfit(opportunity: ZeroCapitalOpportunity): bigint {
  if (opportunity.grossProfit !== undefined) return opportunity.grossProfit;
  return opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken;
}

function preBroadcastNetProfit(opportunity: ZeroCapitalOpportunity, gasCostInputBaseUnits: bigint): bigint {
  const flash = opportunity.flashLoanFeeInInputToken ?? 0n;
  const relay = opportunity.relayFeeInInputToken ?? 0n;
  return reconstructedGrossProfit(opportunity) - flash - relay - gasCostInputBaseUnits;
}

/**
 * Advisory risk telemetry only. This multiple may rank or explain opportunities,
 * but it cannot impose a second profit floor after canonical strictly-positive
 * all-in economics have admitted a trade.
 */
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
  extra: Partial<Pick<DynamicAttemptBarrierDecision,
    'exactCallPassed' | 'exactGasEstimatePassed' | 'estimatedGasUnits' | 'measuredFeePerGasWei'
    | 'measuredGasCostInInputToken' | 'preBroadcastNetProfit' | 'failedAttemptExposure'>> = {},
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
    measuredFeePerGasWei: extra.measuredFeePerGasWei ?? null,
    measuredGasCostInInputToken: extra.measuredGasCostInInputToken ?? null,
    preBroadcastNetProfit: extra.preBroadcastNetProfit ?? null,
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
 * Minimum-sufficient pre-broadcast validation used directly by the canonical
 * ZERO_CAPITAL_ATOMIC executor. Hard rejection is limited to facts required to
 * execute the selected atomic route: positive canonical economics, freshness,
 * exact provider/receiver identity and sizing, an available funding lane, exact
 * payload construction, current gas units, and current all-in gas economics.
 * eth_call simulation plus the historical dynamic-attempt multiple are advisory.
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
  if (!wallet || selection.receiverCapability.owner.toLowerCase() !== wallet.address.toLowerCase()) {
    const result = denied(opportunity, observedAt, funding, flashLoanProvider, 'Selected provider receiver owner no longer matches execution wallet');
    latest = result; deferrals++; return result;
  }
  if (selection.kind === 'dual' && selection.balancerAmount + selection.aaveAmount !== opportunity.flashLoanAmount) {
    const result = denied(opportunity, observedAt, funding, flashLoanProvider, 'Dual-provider principal split no longer equals exact opportunity notional');
    latest = result; deferrals++; return result;
  }
  if (funding.mode === 'unavailable' || !provider || !receiver) {
    const result = denied(
      opportunity,
      observedAt,
      funding,
      flashLoanProvider,
      funding.mode === 'unavailable' ? funding.reason : 'Provider or selected verified receiver unavailable',
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

  // eth_call is useful validation telemetry, but it is not a consensus execution
  // prerequisite and cannot veto an otherwise executable, positive atomic trade.
  const exactCallPassed = call.status === 'fulfilled';
  if (!exactCallPassed) {
    logger.debug('[ZeroCapitalBarrier] Exact eth_call simulation advisory failed without vetoing execution', {
      component: 'ZeroCapitalDynamicAttemptBarrier',
      opportunityId: opportunity.id,
      chain: opportunity.chain,
      flashLoanProvider,
      error: call.reason instanceof Error ? call.reason.message : String(call.reason),
      simulationVetoAuthority: false,
    });
  }

  if (gas.status !== 'fulfilled') {
    const result = denied(opportunity, observedAt, funding, flashLoanProvider,
      `Exact provider gas estimation rejected; defer and re-quote: ${gas.reason instanceof Error ? gas.reason.message : String(gas.reason)}`,
      { exactCallPassed });
    latest = result; deferrals++; return result;
  }

  const estimatedGasUnits = BigInt(gas.value.toString());
  const gasEconomics = await measuredGasEconomics({ provider, opportunity, funding, estimatedGasUnits });
  if (!gasEconomics) {
    const result = denied(opportunity, observedAt, funding, flashLoanProvider,
      'Fresh pre-broadcast gas economics could not be resolved from current fee data and live provider-mesh prices',
      { exactCallPassed, exactGasEstimatePassed: true, estimatedGasUnits });
    latest = result; deferrals++; return result;
  }

  const exactNetProfit = preBroadcastNetProfit(opportunity, gasEconomics.gasCostInputBaseUnits);
  if (exactNetProfit <= 0n) {
    const result = denied(opportunity, observedAt, funding, flashLoanProvider,
      'Fresh exact gas repricing removed the strictly-positive all-in net profit; defer and re-quote',
      {
        exactCallPassed,
        exactGasEstimatePassed: true,
        estimatedGasUnits,
        measuredFeePerGasWei: gasEconomics.feePerGasWei,
        measuredGasCostInInputToken: gasEconomics.gasCostInputBaseUnits,
        preBroadcastNetProfit: exactNetProfit,
        failedAttemptExposure: gasEconomics.gasCostInputBaseUnits,
      });
    latest = result; deferrals++; return result;
  }

  const age = quoteAgeFraction(opportunity, observedAt);
  if (Date.now() >= opportunity.expiresAt) {
    const result = denied(opportunity, Date.now(), funding, flashLoanProvider,
      'Opportunity expired while resolving exact pre-broadcast gas economics',
      {
        exactCallPassed,
        exactGasEstimatePassed: true,
        estimatedGasUnits,
        measuredFeePerGasWei: gasEconomics.feePerGasWei,
        measuredGasCostInInputToken: gasEconomics.gasCostInputBaseUnits,
        preBroadcastNetProfit: exactNetProfit,
        failedAttemptExposure: gasEconomics.gasCostInputBaseUnits,
      });
    latest = result; deferrals++; return result;
  }

  const barrierMultiple = dynamicBarrierMultiple(opportunity, age);
  const failedAttemptExposure = gasEconomics.gasCostInputBaseUnits;
  const dynamicBarrier = multiplyCeil(failedAttemptExposure, barrierMultiple);
  const clearsHistoricalBarrier = failedAttemptExposure <= 0n || exactNetProfit > dynamicBarrier;

  // The exact gas-cost repricing above is a hard all-in economics gate. The
  // historical dynamic multiple remains advisory and cannot create a second
  // minimum-profit threshold once strict positive economics are proven.
  const result: DynamicAttemptBarrierDecision = {
    opportunityId: opportunity.id,
    chain: opportunity.chain,
    observedAt,
    approved: true,
    reason: funding.mode === 'sponsored' && funding.sponsorOperatorMonetaryCostProvenZero === true
      ? `Required ${flashLoanProvider} payload/gas/funding facts are current and sponsorship cost is proven zero; dynamic-attempt risk is advisory`
      : clearsHistoricalBarrier
        ? `Required ${flashLoanProvider} payload/gas/funding facts and exact gas economics are current; advisory failed-attempt multiple is also cleared (${barrierMultiple.toFixed(3)}x)`
        : `Required ${flashLoanProvider} payload/gas/funding facts and exact gas economics are current; advisory failed-attempt multiple is not cleared (${barrierMultiple.toFixed(3)}x) but has no veto authority`,
    fundingMode: funding.mode,
    flashLoanProvider,
    exactCallPassed,
    exactGasEstimatePassed: true,
    estimatedGasUnits,
    measuredFeePerGasWei: gasEconomics.feePerGasWei,
    measuredGasCostInInputToken: gasEconomics.gasCostInputBaseUnits,
    preBroadcastNetProfit: exactNetProfit,
    expectedNetProfit: opportunity.expectedProfit,
    failedAttemptExposure,
    dynamicBarrier,
    profitToFailureExposureRatio: ratio(exactNetProfit, failedAttemptExposure),
    quoteAgeFraction: age,
    confidence: opportunity.confidence,
    expectedSlippageBps: opportunity.expectedSlippageBps,
    barrierMultiple,
    authority: 'canonical_pre_broadcast_validation',
    executionAuthority: false,
  };
  latest = result;
  approvals++;
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
    exactGasEconomicsRequiredBeforeBroadcast: true,
    executeAndRecordMutation: false,
    executionAuthority: false,
  });
}
