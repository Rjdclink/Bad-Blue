import type { Wallet, providers } from 'ethers';
import logger from '../../../logger.js';
import {
  zeroCapitalEngine,
  type SupportedChain,
  type ZeroCapitalOpportunity,
} from '../core/zero-capital-engine.js';
import { expectedExecutionGasPriceWei } from '../discovery/configured-zero-capital-gas-economics.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import { buildFlashLoanExecutionPlanFromOpportunity } from '../execution/adapters/autonomous-route-planner.js';
import {
  buildCompositeFlashLoanReceiverPayload,
  type CompositeFlashLoanExecutionPlan,
} from '../execution/adapters/composite-flashloan-receiver-builder.js';
import {
  calculateMeasuredFlashLoanFee,
  measureBalancerFlashLoanEconomics,
} from '../execution/adapters/flash-loan-provider-economics.js';
import { verifyFlashLoanReceiverCapability } from '../execution/adapters/flash-loan-receiver-capability.js';
import { zeroCapitalCompositeSelectionRegistry, type ZeroCapitalCompositePreparedSelection } from '../execution/zero-capital-composite-selection-registry.js';
import { getProfitLadderDailyProfitBudget } from '../governance/profit-ladder-daily-profit-budget.js';
import { adaptiveTopologyOptimizer } from '../optimization/adaptive-topology-optimizer.js';
import { zeroCapitalCompositeEvidenceRegistry, type ZeroCapitalCompositeEvidence } from '../optimization/zero-capital-composite-evidence-registry.js';
import { zeroCapitalRouteEvidenceRegistry } from '../optimization/zero-capital-route-evidence-registry.js';

const installed = new WeakSet<object>();
const advisoryInFlight = new Set<string>();
const COMPOSITE_ID_PREFIX = 'atomic-stack:';
const BPS_SCALE = 1_000_000n;

type ZeroCapitalStackRuntime = {
  providers: Map<SupportedChain, providers.JsonRpcProvider>;
  executionWallets: Map<SupportedChain, Wallet>;
};

type MeasuredTargetStack = {
  evidence: ZeroCapitalCompositeEvidence;
  selection: ZeroCapitalCompositePreparedSelection;
  opportunity: ZeroCapitalOpportunity;
  members: ZeroCapitalOpportunity[];
  memberCandidates: MeasuredCandidate[];
};

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function atomicSurplusEntryFloorBps(): number {
  return bounded(process.env.ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS, -10, -100, 0);
}

function atomicSurplusTargetBps(): number {
  return bounded(process.env.ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS, 10, 10, 1_000);
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
  const divisor = 10 ** decimals;
  const tokenAmount = Number(value) / divisor;
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

function targetProfitBaseUnits(principal: bigint, targetBps: number): bigint {
  if (principal <= 0n || !Number.isFinite(targetBps) || targetBps <= 0) return 0n;
  const scaledBps = BigInt(Math.max(1, Math.ceil(targetBps * Number(BPS_SCALE))));
  return ceilMulDiv(principal, scaledBps, 10_000n * BPS_SCALE);
}

function groupId(chain: SupportedChain, inputToken: string, ids: readonly string[]): string {
  return `${COMPOSITE_ID_PREFIX}${chain}:${inputToken.toLowerCase()}:${[...ids].sort().join('|')}`;
}

function individuallyComposable(opportunity: ZeroCapitalOpportunity): boolean {
  if (
    opportunity.id.startsWith(COMPOSITE_ID_PREFIX)
    || opportunity.chain === 'europa'
    || opportunity.route.length < 2
    || opportunity.expiresAt <= Date.now()
    || grossProfit(opportunity) <= 0n
    || !Number.isFinite(opportunity.netProfitBps)
    || opportunity.netProfitBps < atomicSurplusEntryFloorBps()
  ) return false;
  const first = opportunity.route[0];
  const last = opportunity.route[opportunity.route.length - 1];
  if (!sameAddress(first.tokenIn, opportunity.inputToken) || !sameAddress(last.tokenOut, opportunity.inputToken)) return false;
  for (let index = 1; index < opportunity.route.length; index++) {
    if (!sameAddress(opportunity.route[index - 1].tokenOut, opportunity.route[index].tokenIn)) return false;
  }
  return true;
}

function chooseStack(opportunities: readonly ZeroCapitalOpportunity[]): ZeroCapitalOpportunity[] {
  const policy = adaptiveTopologyOptimizer.getAssemblyPolicy();
  const eligible = opportunities
    .filter(opportunity => {
      const candidate = measuredCandidateRegistry.get(opportunity.id);
      return individuallyComposable(opportunity)
        && candidate?.topology === 'ZERO_CAPITAL_ATOMIC'
        && candidate.expiresAt > Date.now()
        && candidate.status !== 'blocked'
        && candidate.status !== 'expired'
        && candidate.depth.status !== 'unavailable';
    })
    .sort((left, right) => {
      if (right.expectedProfit !== left.expectedProfit) return right.expectedProfit > left.expectedProfit ? 1 : -1;
      if (right.netProfitBps !== left.netProfitBps) return right.netProfitBps - left.netProfitBps;
      return grossProfit(right) > grossProfit(left) ? 1 : -1;
    });

  const selected: ZeroCapitalOpportunity[] = [];
  let stepCount = 0;
  for (const opportunity of eligible) {
    if (selected.length >= policy.maxLegs) break;
    if (stepCount + opportunity.route.length > 16) continue;
    selected.push(opportunity);
    stepCount += opportunity.route.length;
  }
  return selected.length >= Math.max(2, policy.minLegs) ? selected : [];
}

function stackVariants(stack: readonly ZeroCapitalOpportunity[]): ZeroCapitalOpportunity[][] {
  const maxVariants = Math.trunc(bounded(process.env.ZERO_CAPITAL_COMPOSITE_VARIANTS, 5, 1, 8));
  const variants: ZeroCapitalOpportunity[][] = [];
  for (let count = 2; count <= stack.length; count += 1) variants.push(stack.slice(0, count));
  if (variants.length <= maxVariants) return variants.reverse();
  const picked = new Set<number>([variants.length - 1, 0]);
  for (let index = 1; picked.size < maxVariants && index < variants.length - 1; index += 1) {
    const position = Math.round(index * (variants.length - 1) / Math.max(1, maxVariants - 1));
    picked.add(position);
  }
  return [...picked].sort((a, b) => b - a).map(index => variants[index]);
}

function combinedGasCostFromEstimate(
  opportunities: readonly ZeroCapitalOpportunity[],
  estimatedGas: bigint,
): bigint {
  const individualGasUnits = opportunities.reduce((sum, opportunity) => sum + opportunity.gasEstimate, 0n);
  const individualGasCost = opportunities.reduce(
    (sum, opportunity) => sum + (opportunity.estimatedGasCostInInputToken || 0n),
    0n,
  );
  if (individualGasCost <= 0n) return 0n;
  return individualGasUnits > 0n
    ? ceilMulDiv(individualGasCost, estimatedGas, individualGasUnits)
    : individualGasCost;
}

async function measureTargetStack(input: {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  receiver: string;
  opportunities: ZeroCapitalOpportunity[];
}): Promise<MeasuredTargetStack | null> {
  if (input.chain === 'europa' || input.opportunities.length < 2) return null;
  const memberCandidates = input.opportunities
    .map(opportunity => measuredCandidateRegistry.get(opportunity.id))
    .filter((candidate): candidate is MeasuredCandidate => candidate !== null);
  if (memberCandidates.length !== input.opportunities.length) return null;

  const first = input.opportunities[0];
  const inputTokenUsdPrice = Number(first.inputAssetUsdPrice);
  if (!(Number.isFinite(inputTokenUsdPrice) && inputTokenUsdPrice > 0)) return null;

  const profitRecipient = process.env.CRYPTO_PROFIT_WALLET_ADDRESS || process.env.BRIDGE_WALLET_ADDRESS || input.wallet.address;
  const individualPlans = input.opportunities.map(opportunity => {
    const routeGrossProfit = grossProfit(opportunity);
    if (routeGrossProfit <= 0n) throw new Error(`Composite member ${opportunity.id} has no positive measured route value`);
    return buildFlashLoanExecutionPlanFromOpportunity({ ...opportunity, expectedProfit: routeGrossProfit }, {
      receiver: input.receiver,
      provider: 'balancer_v2',
      profitRecipient,
      minProfitBaseUnits: 1n,
      maxRouteHops: 8,
      nowMs: Date.now(),
    });
  });
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

  const balancer = await measureBalancerFlashLoanEconomics({
    chain: input.chain as any,
    provider: input.provider,
    asset: loanToken,
  }).catch(() => null);
  if (!balancer?.executableEvidenceComplete || balancer.availableLiquidity === null || balancer.availableLiquidity < sharedPrincipal) return null;
  const combinedFlashFee = calculateMeasuredFlashLoanFee(balancer, sharedPrincipal);
  if (combinedFlashFee === null) return null;

  const combinedGrossProfit = input.opportunities.reduce((sum, opportunity) => sum + grossProfit(opportunity), 0n);
  const individualExpectedProfitSum = input.opportunities.reduce((sum, opportunity) => sum + opportunity.expectedProfit, 0n);
  const relayFee = input.opportunities.reduce((sum, opportunity) => sum + (opportunity.relayFeeInInputToken || 0n), 0n);
  const targetNetProfitBps = atomicSurplusTargetBps();
  const targetNetProfitBaseUnits = targetProfitBaseUnits(sharedPrincipal, targetNetProfitBps);
  if (targetNetProfitBaseUnits <= 0n) return null;
  const expiresAt = Math.min(...input.opportunities.map(opportunity => opportunity.expiresAt));
  if (Date.now() >= expiresAt) return null;

  const probePlan: CompositeFlashLoanExecutionPlan = {
    chain: input.chain,
    receiver: input.receiver,
    loanToken,
    loanAmount: sharedPrincipal.toString(),
    minProfit: '1',
    profitRecipient,
    steps,
    cycleEndStepIndexes,
    gasLimit: 5_000_000,
  };
  const probePayload = buildCompositeFlashLoanReceiverPayload(probePlan);
  const probeRequest = { from: input.wallet.address, to: probePayload.to, data: probePayload.data, value: probePayload.value };
  try {
    await input.provider.call(probeRequest);
  } catch {
    return null;
  }
  let estimatedGas = BigInt((await input.provider.estimateGas(probeRequest)).toString());
  if (estimatedGas <= 0n) return null;

  let combinedGasCost = combinedGasCostFromEstimate(input.opportunities, estimatedGas);
  let requiredOnchainResidual = targetNetProfitBaseUnits + combinedGasCost + relayFee;
  let payload = buildCompositeFlashLoanReceiverPayload({ ...probePlan, minProfit: requiredOnchainResidual.toString() });
  for (let pass = 0; pass < 2; pass += 1) {
    const request = { from: input.wallet.address, to: payload.to, data: payload.data, value: payload.value };
    try {
      await input.provider.call(request);
    } catch {
      return null;
    }
    const nextGas = BigInt((await input.provider.estimateGas(request)).toString());
    if (nextGas <= 0n) return null;
    const nextGasCost = combinedGasCostFromEstimate(input.opportunities, nextGas);
    const nextRequiredResidual = targetNetProfitBaseUnits + nextGasCost + relayFee;
    estimatedGas = nextGas;
    combinedGasCost = nextGasCost;
    requiredOnchainResidual = nextRequiredResidual;
    payload = buildCompositeFlashLoanReceiverPayload({ ...probePlan, minProfit: requiredOnchainResidual.toString() });
  }

  const exactRequest = { from: input.wallet.address, to: payload.to, data: payload.data, value: payload.value };
  try {
    await input.provider.call(exactRequest);
  } catch {
    return null;
  }
  const finalGas = BigInt((await input.provider.estimateGas(exactRequest)).toString());
  if (finalGas <= 0n) return null;
  estimatedGas = finalGas;
  combinedGasCost = combinedGasCostFromEstimate(input.opportunities, estimatedGas);
  requiredOnchainResidual = targetNetProfitBaseUnits + combinedGasCost + relayFee;
  payload = buildCompositeFlashLoanReceiverPayload({ ...probePlan, minProfit: requiredOnchainResidual.toString() });
  try {
    await input.provider.call({ from: input.wallet.address, to: payload.to, data: payload.data, value: payload.value });
  } catch {
    return null;
  }

  const block = await input.provider.getBlock('latest');
  const maxBlockFraction = bounded(process.env.CRYPTOCRAWL_MULTILEG_MAX_BLOCK_GAS_FRACTION, 0.50, 0.10, 0.80);
  const blockGasLimit = BigInt(block.gasLimit.toString());
  const allowedGas = blockGasLimit * BigInt(Math.floor(maxBlockFraction * 1_000_000)) / 1_000_000n;
  if (estimatedGas > allowedGas) return null;

  const combinedAllInCost = combinedFlashFee + combinedGasCost + relayFee;
  const combinedExpectedProfit = combinedGrossProfit - combinedAllInCost;
  if (combinedExpectedProfit < targetNetProfitBaseUnits || combinedExpectedProfit <= 0n) return null;
  const measuredCompositionGain = combinedExpectedProfit - individualExpectedProfitSum;
  if (measuredCompositionGain <= 0n) return null;

  const individualGasCost = input.opportunities.reduce(
    (sum, opportunity) => sum + (opportunity.estimatedGasCostInInputToken || 0n),
    0n,
  );
  const individualFlashFees = input.opportunities.reduce(
    (sum, opportunity) => sum + (opportunity.flashLoanFeeInInputToken || 0n),
    0n,
  );
  const measuredGasSavings = positiveDifference(individualGasCost, combinedGasCost);
  const measuredFlashFeeSavings = positiveDifference(individualFlashFees, combinedFlashFee);
  const stackedBps = bpsFromSharedPrincipal(combinedExpectedProfit, sharedPrincipal);
  if (stackedBps + 1e-9 < targetNetProfitBps) return null;

  const decimals = first.inputTokenDecimals;
  const compositionGainUsd = baseUnitsToUsd(measuredCompositionGain, decimals, inputTokenUsdPrice);
  const opportunityIds = input.opportunities.map(opportunity => opportunity.id);
  const evidenceId = groupId(input.chain, loanToken, opportunityIds);
  const measuredAt = Date.now();
  if (measuredAt >= expiresAt) return null;
  const feeData = await input.provider.getFeeData();
  const expectedGasPriceWei = expectedExecutionGasPriceWei(feeData);
  const minProfitSum = individualPlans.reduce((sum, plan) => sum + BigInt(plan.minProfit), 0n);

  const provenance = [
    'verified_balancer_composite_v2_receiver',
    'composite_cycle_checkpoint_capable',
    'exact_target_bound_composite_eth_call_passed',
    'exact_target_bound_composite_gas_estimate',
    'shared_flash_loan_principal',
    'measured_balancer_flash_fee_for_shared_principal',
    'measured_combined_gas_cost',
    'measured_combined_relay_cost',
    `atomic_surplus_entry_floor_bps:${atomicSurplusEntryFloorBps()}`,
    `atomic_surplus_target_floor_bps:${targetNetProfitBps}`,
    `measured_duplicate_flash_fee_savings:${measuredFlashFeeSavings.toString()}`,
    `measured_combined_gas_savings:${measuredGasSavings.toString()}`,
    `input_token_usd_price:${inputTokenUsdPrice}`,
    'combined_all_in_net_clears_target',
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

  const flatRoute = input.opportunities.flatMap(opportunity => opportunity.route.map(step => ({ ...step })));
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
    route: flatRoute,
    confidence: Math.min(...input.opportunities.map(item => item.confidence)),
    timestamp: measuredAt,
    expiresAt,
  };

  return { evidence, selection, opportunity, members: input.opportunities, memberCandidates };
}

function promoteMeasuredStack(measured: MeasuredTargetStack): void {
  const { evidence, selection, opportunity, memberCandidates } = measured;
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
    depth: {
      status: 'measured',
      detail: `Exact ${evidence.opportunityIds.length}-cycle shared-principal composite measured against target-bound payload`,
    },
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
      discoveryFloorBps: atomicSurplusEntryFloorBps(),
      bpsToBreakEven: 0,
    },
    executableCapability: true,
    executionCapabilityReason: `Exact prepared shared-principal composite clears ${evidence.targetNetProfitBps} BPS after measured flash fee, gas and relay costs`,
    missingInformation: [],
    provenance: [
      ...evidence.provenance,
      'atomic_multileg_payload_composable',
      'atomic_multileg_composite_v2',
      `atomic_multileg_evidence:${evidence.evidenceId}`,
      `atomic_multileg_shared_principal_bps:${evidence.sharedPrincipalStackedBps.toFixed(6)}`,
      `atomic_multileg_estimated_gas:${evidence.estimatedGas.toString()}`,
      `measured_composite_gain_usd:${evidence.compositionGainUsd.toFixed(8)}`,
      'canonical_execution_required:zero_capital_composite_prepared',
    ],
  });

  for (const member of memberCandidates) {
    measuredCandidateRegistry.updateStatus(member.opportunityId, member.status, {
      provenance: [
        'atomic_multileg_member_measured',
        `atomic_multileg_evidence:${evidence.evidenceId}`,
        `atomic_multileg_shared_principal_bps:${evidence.sharedPrincipalStackedBps.toFixed(6)}`,
        `measured_composite_gain_usd:${evidence.compositionGainUsd.toFixed(8)}`,
      ],
    });
  }
}

function candidateCanTriggerStack(candidate: MeasuredCandidate): boolean {
  if (
    candidate.opportunityId.startsWith(COMPOSITE_ID_PREFIX)
    || candidate.topology !== 'ZERO_CAPITAL_ATOMIC'
    || candidate.expiresAt <= Date.now()
    || candidate.status === 'blocked'
    || candidate.status === 'expired'
    || candidate.depth.status === 'unavailable'
  ) return false;
  const netBps = Number(candidate.canonicalBps.netBps ?? candidate.economics.netProfitBps);
  return Number.isFinite(netBps)
    && netBps >= atomicSurplusEntryFloorBps()
    && netBps < atomicSurplusTargetBps();
}

function scheduleStackAdvisory(target: ZeroCapitalStackRuntime, candidate: MeasuredCandidate): void {
  if (!candidateCanTriggerStack(candidate)) return;
  const opportunity = zeroCapitalRouteEvidenceRegistry.getOpportunity(candidate.opportunityId);
  if (!opportunity || opportunity.chain === 'europa') return;
  const key = `${opportunity.chain}:${opportunity.inputToken.toLowerCase()}`;
  if (advisoryInFlight.has(key)) return;
  advisoryInFlight.add(key);

  queueMicrotask(() => {
    void (async () => {
      const provider = target.providers.get(opportunity.chain);
      const wallet = target.executionWallets.get(opportunity.chain);
      if (!provider || !wallet) return;
      const compositeCapability = await verifyFlashLoanReceiverCapability({
        kind: 'balancer_composite_v2',
        chain: opportunity.chain,
        provider,
        expectedOwner: wallet.address,
      }).catch(() => null);
      if (!compositeCapability) return;

      const compatible = zeroCapitalRouteEvidenceRegistry.getCompatibleForAtomicSurplus({
        chain: opportunity.chain,
        inputToken: opportunity.inputToken,
        minNetBps: atomicSurplusEntryFloorBps(),
      });
      const stack = chooseStack(compatible);
      if (stack.length < 2) return;

      // Profit Ladder remains useful telemetry, but it is not an Atomic rescue,
      // borrowing, composition, profitability, or execution veto authority.
      const budget = await getProfitLadderDailyProfitBudget().catch(() => null);
      const variants = stackVariants(stack);
      const measured: MeasuredTargetStack[] = [];
      let outsideRemainingDailyProfitBudget = 0;
      for (const variant of variants) {
        if (variant.some(member => member.expiresAt <= Date.now())) continue;
        const result = await measureTargetStack({
          chain: opportunity.chain,
          provider,
          wallet,
          receiver: compositeCapability.address,
          opportunities: variant,
        }).catch(() => null);
        if (!result) continue;
        zeroCapitalCompositeEvidenceRegistry.record(result.evidence);
        const inputTokenUsdPrice = Number(result.opportunity.inputAssetUsdPrice);
        const expectedNetProfitUsd = baseUnitsToUsd(
          result.evidence.combinedExpectedProfit,
          result.evidence.inputTokenDecimals,
          inputTokenUsdPrice,
        );
        if (
          budget?.remainingProfitUsd !== null
          && budget?.remainingProfitUsd !== undefined
          && expectedNetProfitUsd > budget.remainingProfitUsd + 0.01
        ) outsideRemainingDailyProfitBudget += 1;
        measured.push(result);
      }
      if (measured.length === 0) return;
      measured.sort((left, right) => {
        if (right.evidence.combinedExpectedProfit !== left.evidence.combinedExpectedProfit) {
          return right.evidence.combinedExpectedProfit > left.evidence.combinedExpectedProfit ? 1 : -1;
        }
        return right.evidence.sharedPrincipalStackedBps - left.evidence.sharedPrincipalStackedBps;
      });
      const best = measured[0];
      promoteMeasuredStack(best);

      const bestInputTokenUsdPrice = Number(best.opportunity.inputAssetUsdPrice);
      logger.info('[ZeroCapitalStack] Target-bound shared-principal atomic surplus promoted', {
        component: 'ZeroCapitalAtomicStackWiring',
        receiverKind: 'balancer_composite_v2',
        chain: best.opportunity.chain,
        opportunityId: best.opportunity.id,
        memberOpportunityIds: best.evidence.opportunityIds,
        sharedPrincipal: best.evidence.sharedPrincipal.toString(),
        combinedExpectedProfit: best.evidence.combinedExpectedProfit.toString(),
        combinedExpectedProfitUsd: baseUnitsToUsd(
          best.evidence.combinedExpectedProfit,
          best.evidence.inputTokenDecimals,
          bestInputTokenUsdPrice,
        ),
        targetNetProfitBps: best.evidence.targetNetProfitBps,
        achievedNetProfitBps: best.evidence.sharedPrincipalStackedBps,
        measuredCompositionGain: best.evidence.measuredCompositionGain.toString(),
        estimatedGas: best.evidence.estimatedGas.toString(),
        dailyProfitCapUsd: budget?.dailyProfitCapUsd ?? null,
        dailyRealizedProfitUsd: budget?.realizedProfitUsd ?? null,
        dailyRemainingProfitUsd: budget?.remainingProfitUsd ?? null,
        profitLadderStageAlignedTelemetry: budget?.stageAligned ?? null,
        variantsOutsideRemainingDailyProfitBudget: outsideRemainingDailyProfitBudget,
        borrowingNotionalAuthority: false,
        profitLadderCompositionVetoAuthority: false,
        profitLadderExecutionVetoAuthority: false,
        netDollarOptimizationAboveTarget: true,
        exactTargetSimulationPassed: true,
        executionAuthority: false,
      });
    })()
      .catch(error => {
        logger.debug('[ZeroCapitalStack] Parallel atomic-surplus optimization rejected locally', {
          component: 'ZeroCapitalAtomicStackWiring',
          opportunityId: candidate.opportunityId,
          chain: opportunity.chain,
          error: error instanceof Error ? error.message : String(error),
          individualExecutionAffected: false,
          executionAuthority: false,
        });
      })
      .finally(() => advisoryInFlight.delete(key));
  });
}

export function ensureZeroCapitalAtomicStackWiring(): void {
  const target = zeroCapitalEngine as unknown as ZeroCapitalStackRuntime;
  if (installed.has(target)) return;
  installed.add(target);

  measuredCandidateRegistry.onUpdate(candidate => scheduleStackAdvisory(target, candidate));
  for (const candidate of measuredCandidateRegistry.getRecent(512)) scheduleStackAdvisory(target, candidate);

  logger.info('[ZeroCapitalStack] Shared-principal atomic surplus wiring installed', {
    component: 'ZeroCapitalAtomicStackWiring',
    receiverKind: 'balancer_composite_v2',
    verifiedCompositeReceiverRequired: true,
    atomicSurplusEntryFloorBps: atomicSurplusEntryFloorBps(),
    atomicSurplusTargetFloorBps: atomicSurplusTargetBps(),
    maxAtomicSteps: 16,
    adaptiveLegCount: true,
    nearMissMeasurementAllowed: true,
    ordinarySingleRouteAdmissionWeakened: false,
    exactTargetBoundCompositeCallRequired: true,
    exactCompositeGasEstimateRequired: true,
    measuredBalancerFlashFeeRequired: true,
    measuredCompositionBenefitRequired: true,
    dailyProfitBudgetAuthority: 'profit_ladder_daily_realized_profit_telemetry_only',
    profitLadderStageAlignmentAuthority: false,
    profitLadderCompositionVetoAuthority: false,
    profitLadderExecutionVetoAuthority: false,
    borrowingNotionalAuthority: false,
    netDollarOptimizationAboveTarget: true,
    tokenPriceBoundUsdAccounting: true,
    syntheticEconomics: false,
    scanMethodMutation: false,
    executionMethodMutation: false,
    individualOpportunityCriticalPathBlocked: false,
    executionAuthority: false,
  });
}
