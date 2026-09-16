import type { Wallet, providers } from 'ethers';
import logger from '../../../logger.js';
import {
  zeroCapitalEngine,
  type SupportedChain,
  type ZeroCapitalOpportunity,
} from '../core/zero-capital-engine.js';
import { expectedExecutionGasPriceWei } from '../discovery/configured-zero-capital-gas-economics.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import {
  buildCompositeFlashLoanReceiverPayload,
  type CompositeFlashLoanExecutionPlan,
} from '../execution/adapters/composite-flashloan-receiver-builder.js';
import {
  calculateMeasuredFlashLoanFee,
  measureBalancerFlashLoanEconomics,
  peekResidentFlashLoanProviderEvidence,
  type FlashLoanProviderEconomics,
} from '../execution/adapters/flash-loan-provider-economics.js';
import {
  resolveConfiguredFlashLoanReceiver,
  verifyFlashLoanReceiverCapability,
} from '../execution/adapters/flash-loan-receiver-capability.js';
import type {
  OnchainSwapLeg,
  SupportedSwapProtocol,
  UniswapV3FeeTier,
} from '../execution/adapters/onchain-payload-builder.js';
import {
  zeroCapitalCompositeSelectionRegistry,
  type ZeroCapitalCompositePreparedSelection,
} from '../execution/zero-capital-composite-selection-registry.js';
import { adaptiveTopologyOptimizer } from '../optimization/adaptive-topology-optimizer.js';
import {
  zeroCapitalCompositeEvidenceRegistry,
  type ZeroCapitalCompositeEvidence,
} from '../optimization/zero-capital-composite-evidence-registry.js';
import { zeroCapitalRouteEvidenceRegistry } from '../optimization/zero-capital-route-evidence-registry.js';
import { buildBoundedStackVariants, settleBeforeDeadline } from './ape-hypergraph-intelligence.js';
import {
  clearsStrictPositiveOutputThreshold,
  requiredStrictPositiveProfitBaseUnits,
} from './zero-capital-profit-output-floor.js';

const installed = new WeakSet<object>();
const tacticInFlight = new Map<string, Promise<AtomicStackTacticResult>>();
const COMPOSITE_ID_PREFIX = 'atomic-stack:';
const BPS_SCALE = 1_000_000n;
const STRICT_POSITIVE_PROFIT_BASE_UNITS = 1n;

type ZeroCapitalStackRuntime = {
  executionWallets: Map<SupportedChain, Wallet>;
};

type CompositeMemberPlan = {
  loanToken: string;
  loanAmount: string;
  minProfit: string;
  steps: OnchainSwapLeg[];
};

type MeasuredTargetStack = {
  evidence: ZeroCapitalCompositeEvidence;
  selection: ZeroCapitalCompositePreparedSelection;
  opportunity: ZeroCapitalOpportunity;
  members: ZeroCapitalOpportunity[];
  memberCandidates: MeasuredCandidate[];
};

export interface AtomicStackTacticResult {
  attemptedGroups: number;
  measuredVariants: number;
  promoted: number;
  promotedOpportunityIds: string[];
  executionAuthority: false;
}

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function grossProfit(opportunity: ZeroCapitalOpportunity): bigint {
  return opportunity.grossProfit ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
}

function bpsFromSharedPrincipal(profit: bigint, principal: bigint): number {
  if (principal <= 0n) return 0;
  return Number((profit * 10_000n * BPS_SCALE) / principal) / Number(BPS_SCALE);
}

function baseUnitsToUsd(value: bigint, decimals: number, usdPrice: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return 0;
  if (!(Number.isFinite(usdPrice) && usdPrice > 0)) return 0;
  const tokenAmount = Number(value) / (10 ** decimals);
  const result = tokenAmount * usdPrice;
  return Number.isFinite(result) ? result : 0;
}

function ceilMulDiv(value: bigint, numerator: bigint, denominator: bigint): bigint {
  if (value <= 0n || numerator <= 0n || denominator <= 0n) return 0n;
  return (value * numerator + denominator - 1n) / denominator;
}

function positiveDifference(left: bigint, right: bigint): bigint {
  return left > right ? left - right : 0n;
}

function groupId(chain: SupportedChain, inputToken: string, ids: readonly string[]): string {
  return `${COMPOSITE_ID_PREFIX}${chain}:${inputToken.toLowerCase()}:${[...ids].sort().join('|')}`;
}

function deadlineReached(deadlineAt?: number): boolean {
  return deadlineAt !== undefined && Date.now() >= deadlineAt;
}

function emptyTacticResult(): AtomicStackTacticResult {
  return { attemptedGroups: 0, measuredVariants: 0, promoted: 0, promotedOpportunityIds: [], executionAuthority: false };
}

function betterMeasuredStack(candidate: MeasuredTargetStack, current: MeasuredTargetStack | null): boolean {
  if (!current) return true;
  if (candidate.opportunity.expectedProfit !== current.opportunity.expectedProfit) {
    return candidate.opportunity.expectedProfit > current.opportunity.expectedProfit;
  }
  if (candidate.opportunity.netProfitBps !== current.opportunity.netProfitBps) {
    return candidate.opportunity.netProfitBps > current.opportunity.netProfitBps;
  }
  return candidate.opportunity.expiresAt > current.opportunity.expiresAt;
}

function configuredCompositeReceiver(chain: SupportedChain): string | null {
  if (chain === 'europa') return null;
  try {
    return resolveConfiguredFlashLoanReceiver('balancer_composite_v2', chain as any);
  } catch {
    return null;
  }
}

function normalizeProtocol(protocol: string): SupportedSwapProtocol {
  const normalized = protocol.trim().toLowerCase();
  if (normalized === 'uniswapv3' || normalized === 'uniswap_v3' || normalized === 'uniswap-v3') return 'uniswapV3';
  if (normalized === 'sushiswap' || normalized === 'sushi') return 'sushiswap';
  if (normalized === 'sushiswapv3' || normalized === 'sushiswap_v3' || normalized === 'sushiswap-v3' || normalized === 'sushi-v3') return 'sushiswapV3';
  if (normalized === 'pancakeswapv2' || normalized === 'pancakeswap_v2' || normalized === 'pancakeswap-v2' || normalized === 'pancakev2' || normalized === 'pancake-v2') return 'pancakeswapV2';
  if (normalized === 'traderjoev1' || normalized === 'traderjoe_v1' || normalized === 'traderjoe-v1' || normalized === 'joev1' || normalized === 'joe-v1') return 'traderJoeV1';
  if (normalized === 'aaveghogsm' || normalized === 'aave_gho_gsm' || normalized === 'aave-gho-gsm') return 'aaveGhoGsm';
  if (normalized === 'fluiddext1' || normalized === 'fluid_dex_t1' || normalized === 'fluid-dex-t1') return 'fluidDexT1';
  if (normalized === 'skylitepsm' || normalized === 'sky_lite_psm' || normalized === 'sky-lite-psm') return 'skyLitePsm';
  if (normalized === 'skydaiusds' || normalized === 'sky_dai_usds' || normalized === 'sky-dai-usds') return 'skyDaiUsds';
  throw new Error(`Unsupported composite route protocol: ${protocol}`);
}

function mapFeeToTier(fee: number): UniswapV3FeeTier {
  if (!Number.isFinite(fee) || fee < 0 || fee > 0.1) throw new Error('Composite route fee must be a decimal fraction between 0 and 0.1');
  if (fee <= 0.0001) return 100;
  if (fee <= 0.0005) return 500;
  if (fee <= 0.003) return 3000;
  return 10000;
}

function applyHaircut(raw: bigint, bps: number): string {
  const boundedBps = Math.max(100, Math.min(10_000, Math.trunc(bps)));
  return ((raw * BigInt(boundedBps)) / 10_000n).toString();
}

function buildCompositeMemberPlan(
  opportunity: ZeroCapitalOpportunity,
  receiver: string,
): CompositeMemberPlan {
  if (opportunity.route.length < 2 || opportunity.flashLoanAmount <= 0n) throw new Error('Composite member requires a closed measured route and positive principal');
  const minOutputBps = bounded(process.env.ZERO_CAPITAL_ROUTE_MIN_OUTPUT_BPS, 9990, 100, 10_000);
  const deadlineBufferSeconds = Math.trunc(bounded(process.env.ZERO_CAPITAL_SWAP_DEADLINE_SECONDS, 90, 30, 300));
  let expectedInput = opportunity.flashLoanAmount;
  const steps: OnchainSwapLeg[] = opportunity.route.map((step, index) => {
    const amountIn = BigInt(step.amountIn);
    const expectedAmountOut = BigInt(step.expectedAmountOut);
    if (amountIn !== expectedInput || expectedAmountOut <= 0n) throw new Error(`Composite member ${opportunity.id} has discontinuous quote evidence at step ${index}`);
    if (index === 0 && !sameAddress(step.tokenIn, opportunity.inputToken)) throw new Error(`Composite member ${opportunity.id} does not begin in the borrowed token`);
    if (index > 0 && !sameAddress(opportunity.route[index - 1].tokenOut, step.tokenIn)) throw new Error(`Composite member ${opportunity.id} is token-discontinuous at step ${index}`);
    expectedInput = expectedAmountOut;
    const protocol = normalizeProtocol(step.protocol);
    const anchor = protocol === 'aaveGhoGsm' || protocol === 'fluidDexT1' || protocol === 'skyLitePsm' || protocol === 'skyDaiUsds';
    const pool = (step as typeof step & { pool?: string }).pool;
    return {
      protocol,
      chain: opportunity.chain,
      tokenIn: step.tokenIn,
      tokenOut: step.tokenOut,
      amountIn: amountIn.toString(),
      minAmountOut: anchor ? expectedAmountOut.toString() : applyHaircut(expectedAmountOut, minOutputBps),
      ...(pool ? { pool } : {}),
      feeTier: mapFeeToTier(step.fee),
      recipient: receiver,
      deadlineBufferSeconds,
    };
  });
  if (!sameAddress(steps[steps.length - 1].tokenOut, opportunity.inputToken)) throw new Error(`Composite member ${opportunity.id} does not close in the borrowed token`);
  return {
    loanToken: opportunity.inputToken,
    loanAmount: opportunity.flashLoanAmount.toString(),
    minProfit: STRICT_POSITIVE_PROFIT_BASE_UNITS.toString(),
    steps,
  };
}

function individuallyComposable(opportunity: ZeroCapitalOpportunity): boolean {
  if (
    opportunity.id.startsWith(COMPOSITE_ID_PREFIX)
    || opportunity.chain === 'europa'
    || opportunity.route.length < 2
    || !Number.isFinite(opportunity.netProfitBps)
  ) return false;
  const first = opportunity.route[0];
  const last = opportunity.route[opportunity.route.length - 1];
  if (!sameAddress(first.tokenIn, opportunity.inputToken) || !sameAddress(last.tokenOut, opportunity.inputToken)) return false;
  for (let index = 1; index < opportunity.route.length; index += 1) {
    if (!sameAddress(opportunity.route[index - 1].tokenOut, opportunity.route[index].tokenIn)) return false;
  }
  return true;
}

function chooseStack(opportunities: readonly ZeroCapitalOpportunity[]): ZeroCapitalOpportunity[] {
  const policy = adaptiveTopologyOptimizer.getAssemblyPolicy();
  const maxLegs = Math.max(2, Math.min(8, policy.maxLegs));
  const eligible = opportunities
    .filter(opportunity => {
      const candidate = measuredCandidateRegistry.get(opportunity.id);
      return individuallyComposable(opportunity)
        && candidate?.topology === 'ZERO_CAPITAL_ATOMIC'
        && candidate.status !== 'blocked'
        && candidate.depth.status !== 'unavailable';
    })
    .sort((left, right) => {
      if (right.expectedProfit !== left.expectedProfit) return right.expectedProfit > left.expectedProfit ? 1 : -1;
      if (right.netProfitBps !== left.netProfitBps) return right.netProfitBps - left.netProfitBps;
      return grossProfit(right) > grossProfit(left) ? 1 : -1;
    });
  return eligible.slice(0, Math.max(2, Math.min(8, maxLegs + 2)));
}

function stackVariants(stack: readonly ZeroCapitalOpportunity[]): ZeroCapitalOpportunity[][] {
  const maxVariants = Math.trunc(bounded(process.env.ZERO_CAPITAL_COMPOSITE_VARIANTS, 5, 1, 8));
  const policy = adaptiveTopologyOptimizer.getAssemblyPolicy();
  const maxMembers = Math.max(2, Math.min(8, policy.maxLegs));
  return buildBoundedStackVariants(stack, maxVariants, maxMembers, 16);
}

function combinedGasCostFromEstimate(opportunities: readonly ZeroCapitalOpportunity[], estimatedGas: bigint): bigint {
  const individualGasUnits = opportunities.reduce((sum, opportunity) => sum + opportunity.gasEstimate, 0n);
  const individualGasCost = opportunities.reduce((sum, opportunity) => sum + (opportunity.estimatedGasCostInInputToken || 0n), 0n);
  if (individualGasCost <= 0n) return 0n;
  return individualGasUnits > 0n ? ceilMulDiv(individualGasCost, estimatedGas, individualGasUnits) : individualGasCost;
}

async function measureTargetStack(input: {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  receiver: string;
  opportunities: ZeroCapitalOpportunity[];
  balancer: FlashLoanProviderEconomics;
  deadlineAt?: number;
}): Promise<MeasuredTargetStack | null> {
  if (input.chain === 'europa' || input.opportunities.length < 2 || deadlineReached(input.deadlineAt)) return null;
  const memberCandidates = input.opportunities
    .map(opportunity => measuredCandidateRegistry.get(opportunity.id))
    .filter((candidate): candidate is MeasuredCandidate => candidate !== null);
  if (memberCandidates.length !== input.opportunities.length) return null;

  const now = Date.now();
  if (input.opportunities.some(opportunity => opportunity.expiresAt <= now)) return null;

  const first = input.opportunities[0];
  const inputTokenUsdPrice = Number(first.inputAssetUsdPrice);
  if (!(Number.isFinite(inputTokenUsdPrice) && inputTokenUsdPrice > 0)) return null;
  const targetNetProfitBaseUnits = requiredStrictPositiveProfitBaseUnits(first);
  if (targetNetProfitBaseUnits === null || targetNetProfitBaseUnits < STRICT_POSITIVE_PROFIT_BASE_UNITS) return null;

  const profitRecipient = process.env.CRYPTO_PROFIT_WALLET_ADDRESS || process.env.BRIDGE_WALLET_ADDRESS || input.wallet.address;
  let individualPlans: CompositeMemberPlan[];
  try {
    individualPlans = input.opportunities.map(opportunity => buildCompositeMemberPlan(opportunity, input.receiver));
  } catch {
    return null;
  }
  const steps = individualPlans.flatMap(plan => plan.steps);
  if (steps.length > 16) return null;

  const cycleEndStepIndexes: number[] = [];
  let cumulativeSteps = 0;
  for (const plan of individualPlans) {
    cumulativeSteps += plan.steps.length;
    cycleEndStepIndexes.push(cumulativeSteps - 1);
  }

  const loanToken = individualPlans[0].loanToken;
  if (individualPlans.some(plan => !sameAddress(plan.loanToken, loanToken))) return null;
  const sharedPrincipal = individualPlans.reduce((largest, plan) => {
    const value = BigInt(plan.loanAmount);
    return value > largest ? value : largest;
  }, 0n);
  if (sharedPrincipal <= 0n) return null;

  const balancer = input.balancer;
  if (!balancer.executableEvidenceComplete || balancer.availableLiquidity === null || balancer.availableLiquidity < sharedPrincipal) return null;
  const combinedFlashFee = calculateMeasuredFlashLoanFee(balancer, sharedPrincipal);
  if (combinedFlashFee === null) return null;

  const combinedGrossProfit = input.opportunities.reduce((sum, opportunity) => sum + grossProfit(opportunity), 0n);
  if (combinedGrossProfit <= 0n) return null;
  const individualExpectedProfitSum = input.opportunities.reduce((sum, opportunity) => sum + opportunity.expectedProfit, 0n);
  const relayFee = input.opportunities.reduce((sum, opportunity) => sum + (opportunity.relayFeeInInputToken || 0n), 0n);
  const targetNetProfitBps = bpsFromSharedPrincipal(targetNetProfitBaseUnits, sharedPrincipal);
  const expiresAt = Math.min(...input.opportunities.map(opportunity => opportunity.expiresAt), input.deadlineAt ?? Number.MAX_SAFE_INTEGER);
  if (Date.now() >= expiresAt) return null;

  const probePlan: CompositeFlashLoanExecutionPlan = {
    chain: input.chain,
    receiver: input.receiver,
    loanToken,
    loanAmount: sharedPrincipal.toString(),
    minProfit: targetNetProfitBaseUnits.toString(),
    profitRecipient,
    steps,
    cycleEndStepIndexes,
    gasLimit: 5_000_000,
  };
  const probePayload = buildCompositeFlashLoanReceiverPayload(probePlan);
  const probeRequest = { from: input.wallet.address, to: probePayload.to, data: probePayload.data, value: probePayload.value };

  const [probeCallPassed, probeGas] = await Promise.all([
    settleBeforeDeadline(input.provider.call(probeRequest).then(() => true), expiresAt, false),
    settleBeforeDeadline(input.provider.estimateGas(probeRequest).then(value => BigInt(value.toString())), expiresAt, 0n),
  ]);
  if (!probeCallPassed || probeGas <= 0n || deadlineReached(expiresAt)) return null;

  let estimatedGas = probeGas;
  let combinedGasCost = combinedGasCostFromEstimate(input.opportunities, estimatedGas);
  let requiredOnchainResidual = targetNetProfitBaseUnits + combinedGasCost + relayFee;
  let payload = buildCompositeFlashLoanReceiverPayload({ ...probePlan, minProfit: requiredOnchainResidual.toString() });
  let exactRequest = { from: input.wallet.address, to: payload.to, data: payload.data, value: payload.value };

  const chainContextPromise = settleBeforeDeadline(
    Promise.all([input.provider.getBlock('latest'), input.provider.getFeeData()]),
    expiresAt,
    null,
  );
  const [exactCallPassed, exactGas] = await Promise.all([
    settleBeforeDeadline(input.provider.call(exactRequest).then(() => true), expiresAt, false),
    settleBeforeDeadline(input.provider.estimateGas(exactRequest).then(value => BigInt(value.toString())), expiresAt, 0n),
  ]);
  if (!exactCallPassed || exactGas <= 0n || deadlineReached(expiresAt)) return null;

  estimatedGas = exactGas;
  const exactGasCost = combinedGasCostFromEstimate(input.opportunities, estimatedGas);
  const exactRequiredResidual = targetNetProfitBaseUnits + exactGasCost + relayFee;
  combinedGasCost = exactGasCost;

  if (exactRequiredResidual !== requiredOnchainResidual) {
    requiredOnchainResidual = exactRequiredResidual;
    payload = buildCompositeFlashLoanReceiverPayload({ ...probePlan, minProfit: requiredOnchainResidual.toString() });
    exactRequest = { from: input.wallet.address, to: payload.to, data: payload.data, value: payload.value };
    const finalCallPassed = await settleBeforeDeadline(input.provider.call(exactRequest).then(() => true), expiresAt, false);
    if (!finalCallPassed || deadlineReached(expiresAt)) return null;
  } else {
    requiredOnchainResidual = exactRequiredResidual;
  }

  const chainContext = await chainContextPromise;
  if (!chainContext || deadlineReached(expiresAt)) return null;
  const [block, feeData] = chainContext;
  const maxBlockFraction = bounded(process.env.CRYPTOCRAWL_MULTILEG_MAX_BLOCK_GAS_FRACTION, 0.50, 0.10, 0.80);
  const blockGasLimit = BigInt(block.gasLimit.toString());
  const allowedGas = blockGasLimit * BigInt(Math.floor(maxBlockFraction * 1_000_000)) / 1_000_000n;
  if (estimatedGas > allowedGas) return null;

  const combinedAllInCost = combinedFlashFee + combinedGasCost + relayFee;
  const combinedExpectedProfit = combinedGrossProfit - combinedAllInCost;
  if (combinedExpectedProfit < targetNetProfitBaseUnits || combinedExpectedProfit <= 0n) return null;
  const measuredCompositionGain = combinedExpectedProfit - individualExpectedProfitSum;
  if (measuredCompositionGain <= 0n) return null;

  const individualGasCost = input.opportunities.reduce((sum, opportunity) => sum + (opportunity.estimatedGasCostInInputToken || 0n), 0n);
  const individualFlashFees = input.opportunities.reduce((sum, opportunity) => sum + (opportunity.flashLoanFeeInInputToken || 0n), 0n);
  const measuredGasSavings = positiveDifference(individualGasCost, combinedGasCost);
  const measuredFlashFeeSavings = positiveDifference(individualFlashFees, combinedFlashFee);
  const stackedBps = bpsFromSharedPrincipal(combinedExpectedProfit, sharedPrincipal);

  const decimals = first.inputTokenDecimals;
  const compositionGainUsd = baseUnitsToUsd(measuredCompositionGain, decimals, inputTokenUsdPrice);
  const opportunityIds = input.opportunities.map(opportunity => opportunity.id);
  const evidenceId = groupId(input.chain, loanToken, opportunityIds);
  const measuredAt = Date.now();
  if (measuredAt >= expiresAt) return null;
  const expectedGasPriceWei = expectedExecutionGasPriceWei(feeData);
  const minProfitSum = BigInt(individualPlans.length) * STRICT_POSITIVE_PROFIT_BASE_UNITS;

  const provenance = [
    'verified_balancer_composite_v2_receiver',
    'composite_cycle_checkpoint_capable',
    'individual_cycle_profitability_not_admission_authority',
    'aggregate_terminal_repayment_and_profit_authoritative',
    'exact_strict_positive_composite_eth_call_passed',
    'exact_strict_positive_composite_gas_estimate',
    'deadline_authoritative_rpc_proof',
    'bounded_gas_convergence_without_fixed_retry_loop',
    'shared_flash_loan_principal',
    'resident_flash_provider_evidence_preferred',
    'measured_balancer_flash_fee_for_shared_principal',
    'measured_combined_gas_cost',
    'measured_combined_relay_cost',
    'input_authority:single_atomic_bps_engine_stage1_admitted_candidates',
    `strict_positive_profit_floor_base_units:${STRICT_POSITIVE_PROFIT_BASE_UNITS.toString()}`,
    `strict_positive_output_floor_base_units:${targetNetProfitBaseUnits.toString()}`,
    `measured_duplicate_flash_fee_savings:${measuredFlashFeeSavings.toString()}`,
    `measured_combined_gas_savings:${measuredGasSavings.toString()}`,
    `input_token_usd_price:${inputTokenUsdPrice}`,
    'combined_all_in_net_strict_positive',
    'combined_all_in_net_strictly_above_zero',
    'principal_repayment_enforced_by_composite_receiver',
    'synthetic_evidence:false',
  ];

  const evidence: ZeroCapitalCompositeEvidence = {
    evidenceId,
    opportunityIds,
    chain: input.chain,
    inputToken: loanToken,
    inputTokenDecimals: decimals,
    sharedPrincipal,
    individualExpectedProfitSum,
    measuredCompositionGain,
    combinedExpectedProfit,
    combinedGrossProfit,
    combinedAllInCost,
    flashLoanFeeInInputToken: combinedFlashFee,
    gasCostInInputToken: combinedGasCost,
    relayFeeInInputToken: relayFee,
    targetNetProfitBps,
    targetNetProfitBaseUnits,
    requiredOnchainResidual,
    compositionGainUsd,
    minProfitSum,
    sharedPrincipalStackedBps: stackedBps,
    stepCount: steps.length,
    estimatedGas,
    simulated: true,
    simulatedAt: measuredAt,
    expiresAt,
    provenance,
  };

  const selection: ZeroCapitalCompositePreparedSelection = {
    opportunityId: evidenceId,
    memberOpportunityIds: opportunityIds,
    chain: input.chain,
    asset: loanToken,
    inputTokenDecimals: decimals,
    receiver: input.receiver,
    principal: sharedPrincipal,
    expectedGrossProfit: combinedGrossProfit,
    expectedNetProfit: combinedExpectedProfit,
    targetNetProfitBps,
    targetNetProfitBaseUnits,
    flashLoanFeeInInputToken: combinedFlashFee,
    estimatedGasCostInInputToken: combinedGasCost,
    relayFeeInInputToken: relayFee,
    estimatedGasUnits: estimatedGas,
    expectedGasPriceWei,
    prepared: { to: payload.to, data: payload.data, value: payload.value },
    expiresAt,
    measuredAt,
    provenance,
  };

  const opportunity: ZeroCapitalOpportunity = {
    id: evidenceId,
    type: first.type,
    chain: input.chain,
    inputToken: loanToken,
    outputToken: loanToken,
    inputAssetSymbol: first.inputAssetSymbol,
    inputTokenDecimals: decimals,
    inputAssetUsdPrice: inputTokenUsdPrice,
    flashLoanAmount: sharedPrincipal,
    expectedProfit: combinedExpectedProfit,
    grossProfit: combinedGrossProfit,
    gasEstimate: estimatedGas,
    estimatedExecutionCostInInputToken: combinedAllInCost,
    estimatedGasCostInInputToken: combinedGasCost,
    flashLoanFeeInInputToken: combinedFlashFee,
    relayFeeInInputToken: relayFee,
    expectedSlippageBps: Math.max(...input.opportunities.map(item => item.expectedSlippageBps)),
    quoteLatencyMs: Math.max(...input.opportunities.map(item => item.quoteLatencyMs)),
    netProfitBps: stackedBps,
    route: input.opportunities.flatMap(item => item.route.map(step => ({ ...step }))),
    confidence: Math.min(...input.opportunities.map(item => item.confidence)),
    timestamp: measuredAt,
    expiresAt,
  };
  if (!clearsStrictPositiveOutputThreshold(opportunity, measuredAt)) return null;

  return { evidence, selection, opportunity, members: input.opportunities, memberCandidates };
}

function inheritedDiscoveryFloor(memberCandidates: readonly MeasuredCandidate[]): number | null {
  const floors = memberCandidates.map(candidate => Number(candidate.economics.discoveryFloorBps)).filter(Number.isFinite);
  return floors.length > 0 ? Math.min(...floors) : null;
}

function promoteMeasuredStack(measured: MeasuredTargetStack): void {
  const { evidence, selection, opportunity, memberCandidates } = measured;
  if (!clearsStrictPositiveOutputThreshold(opportunity)) return;

  zeroCapitalCompositeEvidenceRegistry.record(evidence);
  zeroCapitalCompositeSelectionRegistry.record(selection);
  zeroCapitalRouteEvidenceRegistry.record(opportunity);

  const decimals = opportunity.inputTokenDecimals;
  const inputTokenUsdPrice = Number(opportunity.inputAssetUsdPrice);
  if (!(Number.isFinite(inputTokenUsdPrice) && inputTokenUsdPrice > 0)) return;
  const notionalUsd = baseUnitsToUsd(opportunity.flashLoanAmount, decimals, inputTokenUsdPrice);
  const grossProfitUsd = baseUnitsToUsd(evidence.combinedGrossProfit, decimals, inputTokenUsdPrice);
  const netProfitUsd = baseUnitsToUsd(evidence.combinedExpectedProfit, decimals, inputTokenUsdPrice);
  const gasUsd = baseUnitsToUsd(evidence.gasCostInInputToken, decimals, inputTokenUsdPrice);
  const flashLoanFeeBps = bpsFromSharedPrincipal(evidence.flashLoanFeeInInputToken, evidence.sharedPrincipal);
  const gasCostBps = bpsFromSharedPrincipal(evidence.gasCostInInputToken, evidence.sharedPrincipal);
  const relayCostBps = bpsFromSharedPrincipal(evidence.relayFeeInInputToken, evidence.sharedPrincipal);
  const allInCostBps = bpsFromSharedPrincipal(evidence.combinedAllInCost, evidence.sharedPrincipal);
  const grossProfitBps = bpsFromSharedPrincipal(evidence.combinedGrossProfit, evidence.sharedPrincipal);
  const assets = [...new Set(memberCandidates.flatMap(candidate => candidate.assets))];
  const venues = [...new Set(memberCandidates.flatMap(candidate => candidate.venues))];
  const rawQuotes = memberCandidates.flatMap(candidate => candidate.rawQuotes.map(quote => ({
    ...quote,
    provenance: [...(quote.provenance || []), `atomic_stack_member:${candidate.opportunityId}`],
  })));

  measuredCandidateRegistry.record({
    opportunityId: opportunity.id,
    topology: 'ZERO_CAPITAL_ATOMIC',
    observedAt: opportunity.timestamp,
    expiresAt: opportunity.expiresAt,
    status: 'eligible',
    assets,
    venues,
    chains: [opportunity.chain],
    rawQuotes,
    depth: { status: 'measured', detail: `Exact ${evidence.opportunityIds.length}-cycle shared-principal composite measured against the canonical strict-positive all-in threshold` },
    economics: {
      grossProfitUsd,
      deterministicNetProfitUsd: netProfitUsd,
      feeUsd: 0,
      gasUsd,
      bridgeUsd: 0,
      expectedSlippageBps: opportunity.expectedSlippageBps,
      expectedPriceImpactBps: null,
      notionalUsd,
      grossProfitBps,
      flashLoanFeeBps,
      gasCostBps,
      relayCostBps,
      allInCostBps,
      breakEvenBps: allInCostBps,
      netProfitBps: evidence.sharedPrincipalStackedBps,
      discoveryFloorBps: inheritedDiscoveryFloor(memberCandidates),
      bpsToBreakEven: 0,
    },
    executableCapability: true,
    executionCapabilityReason: 'Single Atomic-BPS engine selected an exact prepared shared-principal composite with strictly positive all-in net profit after measured flash fee, gas and relay costs',
    missingInformation: [],
    provenance: [
      ...evidence.provenance,
      'atomic_multileg_payload_composable',
      'atomic_multileg_composite_v2',
      `atomic_multileg_evidence:${evidence.evidenceId}`,
      `atomic_multileg_shared_principal_bps:${evidence.sharedPrincipalStackedBps.toFixed(6)}`,
      `atomic_multileg_estimated_gas:${evidence.estimatedGas.toString()}`,
      `measured_composite_gain_usd:${evidence.compositionGainUsd.toFixed(8)}`,
      `strict_positive_profit_base_units:${STRICT_POSITIVE_PROFIT_BASE_UNITS.toString()}`,
      'promotion_authority:single_atomic_bps_engine',
      'canonical_execution_required:zero_capital_composite_prepared',
    ],
  });

  for (const member of memberCandidates) {
    measuredCandidateRegistry.updateStatus(member.opportunityId, member.status, {
      provenance: [
        'atomic_multileg_member_measured_by_single_atomic_bps_engine',
        `atomic_multileg_evidence:${evidence.evidenceId}`,
        `atomic_multileg_shared_principal_bps:${evidence.sharedPrincipalStackedBps.toFixed(6)}`,
        `measured_composite_gain_usd:${evidence.compositionGainUsd.toFixed(8)}`,
      ],
    });
  }
}

async function resolveBalancerCompositeProvider(input: {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  asset: string;
  deadlineAt?: number;
}): Promise<{ evidence: FlashLoanProviderEconomics | null; residentHit: boolean }> {
  const resident = peekResidentFlashLoanProviderEvidence(input.chain as any, input.asset);
  const residentBalancer = resident
    .filter(item => item.provider === 'balancer_v2' && item.executableEvidenceComplete)
    .sort((left, right) => right.observedAt - left.observedAt)[0] ?? null;
  if (residentBalancer) return { evidence: residentBalancer, residentHit: true };
  if (deadlineReached(input.deadlineAt)) return { evidence: null, residentHit: false };

  const measured = await settleBeforeDeadline(
    measureBalancerFlashLoanEconomics({
      chain: input.chain as any,
      provider: input.provider,
      asset: input.asset,
    }),
    input.deadlineAt,
    null,
  );
  return { evidence: measured, residentHit: false };
}

async function runGroup(input: {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  opportunities: ZeroCapitalOpportunity[];
  configuredReceiver: string;
  deadlineAt?: number;
}): Promise<{ measuredVariants: number; promotedOpportunityId: string | null }> {
  const stack = chooseStack(input.opportunities);
  if (stack.length < 2 || deadlineReached(input.deadlineAt)) return { measuredVariants: 0, promotedOpportunityId: null };

  const capabilityPromise = settleBeforeDeadline(
    verifyFlashLoanReceiverCapability({
      kind: 'balancer_composite_v2',
      chain: input.chain,
      provider: input.provider,
      expectedOwner: input.wallet.address,
      address: input.configuredReceiver,
    }),
    input.deadlineAt,
    null,
  );
  const providerPromise = resolveBalancerCompositeProvider({
    chain: input.chain,
    provider: input.provider,
    asset: stack[0].inputToken,
    deadlineAt: input.deadlineAt,
  });
  const [compositeCapability, providerResolution] = await Promise.all([capabilityPromise, providerPromise]);
  const balancer = providerResolution.evidence;
  if (!compositeCapability || !balancer?.executableEvidenceComplete || deadlineReached(input.deadlineAt)) {
    return { measuredVariants: 0, promotedOpportunityId: null };
  }

  const variants = stackVariants(stack).filter(variant => variant.every(member => member.expiresAt > Date.now()));
  if (variants.length === 0) return { measuredVariants: 0, promotedOpportunityId: null };

  const waveWidth = Math.min(2, variants.length);
  let measuredVariants = 0;
  let best: MeasuredTargetStack | null = null;

  for (let offset = 0; offset < variants.length && !deadlineReached(input.deadlineAt); offset += waveWidth) {
    const wave = variants.slice(offset, offset + waveWidth);
    const active = new Map<number, Promise<{ index: number; measured: MeasuredTargetStack | null }>>();
    wave.forEach((variant, index) => {
      const pending = measureTargetStack({
        chain: input.chain,
        provider: input.provider,
        wallet: input.wallet,
        receiver: compositeCapability.address,
        opportunities: variant,
        balancer,
        deadlineAt: input.deadlineAt,
      }).then(measured => ({ index, measured }), () => ({ index, measured: null }));
      active.set(index, pending);
    });

    while (active.size > 0 && !deadlineReached(input.deadlineAt)) {
      const settled = await Promise.race([...active.values()]);
      active.delete(settled.index);
      measuredVariants += 1;
      if (settled.measured && betterMeasuredStack(settled.measured, best)) best = settled.measured;
    }
  }

  if (!best || !clearsStrictPositiveOutputThreshold(best.opportunity)) {
    return { measuredVariants, promotedOpportunityId: null };
  }
  promoteMeasuredStack(best);

  const expectedNetProfitUsd = baseUnitsToUsd(best.evidence.combinedExpectedProfit, best.evidence.inputTokenDecimals, Number(best.opportunity.inputAssetUsdPrice));
  logger.info('[ZeroCapitalStack] Single Atomic-BPS engine promoted best strict-positive shared-principal composition', {
    component: 'ZeroCapitalAtomicStackWiring',
    chain: best.opportunity.chain,
    opportunityId: best.opportunity.id,
    memberOpportunityIds: best.evidence.opportunityIds,
    combinedExpectedProfit: best.evidence.combinedExpectedProfit.toString(),
    combinedExpectedProfitUsd: expectedNetProfitUsd,
    minimumProfitBaseUnits: STRICT_POSITIVE_PROFIT_BASE_UNITS.toString(),
    achievedNetProfitBps: best.evidence.sharedPrincipalStackedBps,
    measuredCompositionGain: best.evidence.measuredCompositionGain.toString(),
    measuredVariantsBeforePromotion: measuredVariants,
    completionOrderVariantMeasurement: true,
    fullVariantBatchBarrier: false,
    firstPositiveStopsVariantSearch: false,
    bestMeasuredProfitableVariantSelected: true,
    providerEconomicsMeasuredOncePerGroup: true,
    providerEconomicsResidentHit: providerResolution.residentHit,
    providerEconomicsResidentMeshPreferred: true,
    receiverCapabilityMeasuredOncePerGroup: true,
    aggregateEconomicsAuthority: true,
    individualChildPositiveGrossRequired: false,
    adaptiveMinLegsVetoAuthority: false,
    nonPrefixBoundedVariantSearch: true,
    staleOwnershipSeparatedFromFreshExecutionAuthority: true,
    fixedCompositeRpcConvergenceLoopRemoved: true,
    deadlineAuthoritativeRpcProof: true,
    promotionAuthority: 'single_atomic_bps_engine',
    executionAuthority: false,
  });
  return { measuredVariants, promotedOpportunityId: best.opportunity.id };
}

export async function runZeroCapitalAtomicStackTactic(input: {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  opportunities: readonly ZeroCapitalOpportunity[];
  deadlineAt?: number;
}): Promise<AtomicStackTacticResult> {
  if (input.chain === 'europa' || input.opportunities.length < 2 || deadlineReached(input.deadlineAt)) return emptyTacticResult();

  // Zero-I/O capability gate: an absent configured receiver makes this entire tactic
  // impossible, so return before grouping, provider measurement or any RPC work.
  const receiver = configuredCompositeReceiver(input.chain);
  if (!receiver) return emptyTacticResult();

  const target = zeroCapitalEngine as unknown as ZeroCapitalStackRuntime;
  const wallet = target.executionWallets.get(input.chain);
  if (!wallet) return emptyTacticResult();

  const groups = new Map<string, ZeroCapitalOpportunity[]>();
  for (const opportunity of input.opportunities) {
    if (opportunity.chain !== input.chain || !individuallyComposable(opportunity)) continue;
    const key = opportunity.inputToken.toLowerCase();
    const group = groups.get(key) || [];
    group.push(opportunity);
    groups.set(key, group);
  }

  const tasks = [...groups.entries()].filter(([, group]) => group.length >= 2).map(([token, opportunities]) => {
    const key = `${input.chain}:${token}`;
    const existing = tacticInFlight.get(key);
    if (existing) return existing;
    let task: Promise<AtomicStackTacticResult>;
    task = runGroup({
      chain: input.chain,
      provider: input.provider,
      wallet,
      opportunities,
      configuredReceiver: receiver,
      deadlineAt: input.deadlineAt,
    })
      .then(result => ({
        attemptedGroups: 1,
        measuredVariants: result.measuredVariants,
        promoted: result.promotedOpportunityId ? 1 : 0,
        promotedOpportunityIds: result.promotedOpportunityId ? [result.promotedOpportunityId] : [],
        executionAuthority: false as const,
      }))
      .catch(error => {
        logger.debug('[ZeroCapitalStack] Engine-owned composite tactic rejected locally', {
          component: 'ZeroCapitalAtomicStackWiring',
          chain: input.chain,
          inputToken: token,
          error: error instanceof Error ? error.message : String(error),
          individualExecutionAffected: false,
          promotionAuthority: 'single_atomic_bps_engine',
          executionAuthority: false,
        });
        return { attemptedGroups: 1, measuredVariants: 0, promoted: 0, promotedOpportunityIds: [], executionAuthority: false as const };
      })
      .finally(() => {
        if (tacticInFlight.get(key) === task) tacticInFlight.delete(key);
      });
    tacticInFlight.set(key, task);
    return task;
  });

  const active = new Map<number, Promise<{ index: number; result: AtomicStackTacticResult }>>();
  tasks.forEach((task, index) => active.set(index, task.then(result => ({ index, result }))));
  const aggregate = emptyTacticResult();

  while (active.size > 0 && !deadlineReached(input.deadlineAt)) {
    const settled = await Promise.race([...active.values()]);
    active.delete(settled.index);
    aggregate.attemptedGroups += settled.result.attemptedGroups;
    aggregate.measuredVariants += settled.result.measuredVariants;
    aggregate.promoted += settled.result.promoted;
    aggregate.promotedOpportunityIds.push(...settled.result.promotedOpportunityIds);
    // A profitable group cannot cancel sibling groups. Each compatible group owns its
    // own bounded search and can still produce a better aggregate result before expiry.
  }
  return aggregate;
}

export function ensureZeroCapitalAtomicStackWiring(): void {
  const target = zeroCapitalEngine as unknown as ZeroCapitalStackRuntime;
  if (installed.has(target)) return;
  installed.add(target);
  logger.info('[ZeroCapitalStack] Composite capability registered as single-engine tactic', {
    component: 'ZeroCapitalAtomicStackWiring',
    receiverKind: 'balancer_composite_v2',
    profitabilityFinishLine: 'strict_positive_all_in_base_units',
    minimumProfitBaseUnits: STRICT_POSITIVE_PROFIT_BASE_UNITS.toString(),
    strictPositiveNecessaryButNotSufficientForPromotion: true,
    strictPositiveStopsOptimization: false,
    firstPromotionStopsVariantSearch: false,
    firstPromotionStopsSiblingGroups: false,
    stageOneThresholdAuthority: false,
    stageOneEnvironmentThresholdRead: false,
    independentMeasuredCandidateListener: false,
    independentPromotionAuthority: false,
    promotionAuthority: 'single_atomic_bps_engine',
    parallelVariantMeasurement: true,
    completionOrderVariantMeasurement: true,
    completionOrderGroupMeasurement: true,
    fullVariantBatchBarrier: false,
    fullGroupBatchBarrier: false,
    exactStrictPositiveCompositeCallRequired: true,
    exactCompositeGasEstimateRequired: true,
    measuredBalancerFlashFeeRequired: true,
    residentProviderEvidencePreferred: true,
    balancerProviderMeasurementSharedAcrossVariants: true,
    compositeProviderCompatibility: 'balancer_v2_only_until_matching_aave_or_morpho_composite_receiver_abi_is_proven',
    providerAlternativesNarrowingPreventedByFalseCapabilityClaims: true,
    missingCompositeReceiverFailsBeforeRpc: true,
    nonPrefixBoundedVariantSearch: true,
    staleOwnershipSeparatedFromFreshExecutionAuthority: true,
    deadlineAuthoritativeRpcProof: true,
    fixedCompositeRpcConvergenceLoopRemoved: true,
    measuredCompositionBenefitRequired: true,
    individualChildPositiveGrossRequired: false,
    aggregateTerminalEconomicsAuthority: true,
    adaptiveMinLegsVetoAuthority: false,
    borrowingNotionalAuthority: false,
    syntheticEconomics: false,
    executionAuthority: false,
  });
}
