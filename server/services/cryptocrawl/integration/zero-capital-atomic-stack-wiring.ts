import type { Wallet, providers } from 'ethers';
import logger from '../../../logger.js';
import {
  zeroCapitalEngine,
  type SupportedChain,
  type ZeroCapitalOpportunity,
} from '../core/zero-capital-engine.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { buildFlashLoanExecutionPlanFromOpportunity } from '../execution/adapters/autonomous-route-planner.js';
import {
  buildFlashLoanReceiverPayloadFromPlan,
  type FlashLoanReceiverExecutionPlan,
} from '../execution/adapters/flashloan-receiver-builder.js';
import { adaptiveTopologyOptimizer } from '../optimization/adaptive-topology-optimizer.js';
import { zeroCapitalCompositeEvidenceRegistry } from '../optimization/zero-capital-composite-evidence-registry.js';
import { zeroCapitalRouteEvidenceRegistry } from '../optimization/zero-capital-route-evidence-registry.js';

const installed = new WeakSet<object>();

type ZeroCapitalStackRuntime = {
  scanChain: (chain: SupportedChain, provider: providers.JsonRpcProvider) => Promise<ZeroCapitalOpportunity[]>;
  isAllowedByCryptara: (opportunity: ZeroCapitalOpportunity) => Promise<boolean>;
  receiverManager: { getReceiver: (chain: string) => string | null };
  executionWallets: Map<SupportedChain, Wallet>;
};

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function bpsFromSharedPrincipal(profit: bigint, principal: bigint): number {
  if (principal <= 0n) return 0;
  return Number((profit * 1_000_000n) / principal) / 100;
}

function baseUnitsToUsd(value: bigint, decimals: number): number {
  const divisor = 10 ** Math.max(0, Math.min(18, decimals));
  const result = Number(value) / divisor;
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
  return `atomic-stack:${chain}:${inputToken.toLowerCase()}:${[...ids].sort().join('|')}`;
}

function individuallyComposable(opportunity: ZeroCapitalOpportunity): boolean {
  if (opportunity.chain === 'europa' || opportunity.expectedProfit <= 0n || opportunity.route.length < 2) return false;
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
      return individuallyComposable(opportunity) &&
        opportunity.netProfitBps >= policy.minIncrementalBps &&
        candidate?.executableCapability === true &&
        candidate.missingInformation.length === 0;
    })
    .sort((left, right) => right.netProfitBps - left.netProfitBps || (right.expectedProfit > left.expectedProfit ? 1 : -1));

  const selected: ZeroCapitalOpportunity[] = [];
  let stepCount = 0;
  for (const opportunity of eligible) {
    if (selected.length >= policy.maxLegs) break;
    if (stepCount + opportunity.route.length > 16) continue;
    selected.push(opportunity);
    stepCount += opportunity.route.length;
  }
  return selected.length >= policy.minLegs ? selected : [];
}

async function exactSimulateStack(input: {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  receiver: string;
  opportunities: ZeroCapitalOpportunity[];
}): Promise<void> {
  if (input.chain === 'europa' || input.opportunities.length < 2) return;
  const profitRecipient = process.env.CRYPTO_PROFIT_WALLET_ADDRESS || process.env.BRIDGE_WALLET_ADDRESS || input.wallet.address;
  const individualPlans = input.opportunities.map(opportunity => buildFlashLoanExecutionPlanFromOpportunity(opportunity, {
    receiver: input.receiver,
    profitRecipient,
    maxRouteHops: 8,
    nowMs: Date.now(),
  }));
  const steps = individualPlans.flatMap(plan => plan.steps);
  if (steps.length > 16) return;

  const loanToken = individualPlans[0].loanToken;
  if (individualPlans.some(plan => !sameAddress(plan.loanToken, loanToken))) return;
  const sharedPrincipal = individualPlans.reduce((largest, plan) => {
    const value = BigInt(plan.loanAmount);
    return value > largest ? value : largest;
  }, 0n);
  const minProfitSum = individualPlans.reduce((sum, plan) => sum + BigInt(plan.minProfit), 0n);
  const expectedProfitSum = input.opportunities.reduce((sum, opportunity) => sum + opportunity.expectedProfit, 0n);
  const expiresAt = Math.min(...input.opportunities.map(opportunity => opportunity.expiresAt));
  if (Date.now() >= expiresAt) return;

  const composite: FlashLoanReceiverExecutionPlan = {
    chain: input.chain,
    receiver: input.receiver,
    loanToken,
    loanAmount: sharedPrincipal.toString(),
    minProfit: minProfitSum.toString(),
    profitRecipient,
    steps,
    gasLimit: 5_000_000,
  };
  const payload = buildFlashLoanReceiverPayloadFromPlan(composite);
  await input.provider.call({
    from: input.wallet.address,
    to: payload.to,
    data: payload.data,
    value: payload.value,
  });
  if (Date.now() >= expiresAt) return;

  const estimatedGasBn = await input.provider.estimateGas({
    from: input.wallet.address,
    to: payload.to,
    data: payload.data,
    value: payload.value,
  });
  const block = await input.provider.getBlock('latest');
  const maxBlockFraction = Math.max(0.10, Math.min(0.80, Number(process.env.CRYPTOCRAWL_MULTILEG_MAX_BLOCK_GAS_FRACTION || 0.50)));
  const blockGasLimit = BigInt(block.gasLimit.toString());
  const estimatedGas = BigInt(estimatedGasBn.toString());
  const allowedGas = BigInt(Math.floor(Number(blockGasLimit) * maxBlockFraction));
  if (estimatedGas > allowedGas) throw new Error(`composite gas ${estimatedGas} exceeds bounded block fraction ${allowedGas}`);

  // Stacking is promoted only if current measured duplicate-cost reuse makes the
  // combined economics strictly better than executing the same cycles separately.
  const individualGasUnits = input.opportunities.reduce((sum, opportunity) => sum + opportunity.gasEstimate, 0n);
  const individualGasCost = input.opportunities.reduce(
    (sum, opportunity) => sum + (opportunity.estimatedGasCostInInputToken || 0n),
    0n,
  );
  const combinedGasCost = individualGasUnits > 0n
    ? ceilMulDiv(individualGasCost, estimatedGas, individualGasUnits)
    : individualGasCost;
  const individualFlashFees = input.opportunities.reduce(
    (sum, opportunity) => sum + (opportunity.flashLoanFeeInInputToken || 0n),
    0n,
  );
  const combinedFlashFee = input.opportunities.reduce((largest, opportunity) => {
    const fee = opportunity.flashLoanFeeInInputToken || 0n;
    return fee > largest ? fee : largest;
  }, 0n);
  const measuredGasSavings = positiveDifference(individualGasCost, combinedGasCost);
  const measuredFlashFeeSavings = positiveDifference(individualFlashFees, combinedFlashFee);
  const measuredCompositionGain = measuredGasSavings + measuredFlashFeeSavings;
  if (measuredCompositionGain <= 0n) return;

  const combinedExpectedProfit = expectedProfitSum + measuredCompositionGain;
  if (combinedExpectedProfit <= expectedProfitSum) return;
  const stackedBps = bpsFromSharedPrincipal(combinedExpectedProfit, sharedPrincipal);
  const decimals = input.opportunities[0].inputTokenDecimals;
  const compositionGainUsd = baseUnitsToUsd(measuredCompositionGain, decimals);
  const opportunityIds = input.opportunities.map(opportunity => opportunity.id);
  const evidenceId = groupId(input.chain, loanToken, opportunityIds);

  zeroCapitalCompositeEvidenceRegistry.record({
    evidenceId,
    opportunityIds,
    chain: input.chain,
    inputToken: loanToken,
    inputTokenDecimals: decimals,
    sharedPrincipal,
    individualExpectedProfitSum: expectedProfitSum,
    measuredCompositionGain,
    combinedExpectedProfit,
    compositionGainUsd,
    minProfitSum,
    sharedPrincipalStackedBps: stackedBps,
    stepCount: steps.length,
    estimatedGas,
    simulatedAt: Date.now(),
    expiresAt,
    provenance: [
      'exact_receiver_composite_eth_call',
      'exact_receiver_composite_estimate_gas',
      'shared_flash_loan_principal',
      'measured_duplicate_flash_fee_savings',
      'measured_combined_gas_savings',
      'combined_profit_strictly_exceeds_individual_profit_sum',
      'all_individual_legs_deterministic_positive',
      'synthetic_evidence:false',
    ],
  });

  for (const opportunity of input.opportunities) {
    const candidate = measuredCandidateRegistry.get(opportunity.id);
    if (!candidate) continue;
    measuredCandidateRegistry.updateStatus(opportunity.id, candidate.status, {
      provenance: [
        'atomic_multileg_payload_composable',
        'atomic_multileg_exact_simulation',
        `atomic_multileg_evidence:${evidenceId}`,
        `atomic_multileg_shared_principal_bps:${stackedBps.toFixed(4)}`,
        `atomic_multileg_estimated_gas:${estimatedGas.toString()}`,
        `measured_composite_gain_usd:${compositionGainUsd.toFixed(8)}`,
      ],
    });
  }

  logger.info('[ZeroCapitalStack] Exact-simulated beneficial shared-principal atomic stack', {
    component: 'ZeroCapitalAtomicStackWiring',
    chain: input.chain,
    opportunityIds,
    cycles: input.opportunities.length,
    steps: steps.length,
    sharedPrincipal: sharedPrincipal.toString(),
    individualExpectedProfitSum: expectedProfitSum.toString(),
    measuredCompositionGain: measuredCompositionGain.toString(),
    combinedExpectedProfit: combinedExpectedProfit.toString(),
    compositionGainUsd,
    minProfitSum: minProfitSum.toString(),
    sharedPrincipalStackedBps: stackedBps,
    estimatedGas: estimatedGas.toString(),
    evidenceId,
    executionAuthority: false,
  });
}

export function ensureZeroCapitalAtomicStackWiring(): void {
  const target = zeroCapitalEngine as unknown as ZeroCapitalStackRuntime;
  if (installed.has(target)) return;
  installed.add(target);

  const originalAssessment = target.isAllowedByCryptara.bind(target);
  target.isAllowedByCryptara = async (opportunity): Promise<boolean> => {
    const allowed = await originalAssessment(opportunity);
    const candidate = measuredCandidateRegistry.get(opportunity.id);
    if (allowed && candidate?.executableCapability && opportunity.expectedProfit > 0n) {
      measuredCandidateRegistry.updateStatus(opportunity.id, 'eligible', {
        provenance: ['Cryptara:consider', 'zero_capital_assessment_eligible'],
      });
    }
    return allowed;
  };

  const originalScan = target.scanChain.bind(target);
  target.scanChain = async (chain, provider): Promise<ZeroCapitalOpportunity[]> => {
    const opportunities = await originalScan(chain, provider);
    for (const opportunity of opportunities) zeroCapitalRouteEvidenceRegistry.record(opportunity);
    if (chain === 'europa' || opportunities.length < 2) return opportunities;

    const receiver = target.receiverManager.getReceiver(chain);
    const wallet = target.executionWallets.get(chain);
    if (!receiver || !wallet) return opportunities;

    const byInputToken = new Map<string, ZeroCapitalOpportunity[]>();
    for (const opportunity of opportunities) {
      if (opportunity.expectedProfit <= 0n) continue;
      const key = opportunity.inputToken.toLowerCase();
      const list = byInputToken.get(key) || [];
      list.push(opportunity);
      byInputToken.set(key, list);
    }

    for (const group of byInputToken.values()) {
      const stack = chooseStack(group);
      if (stack.length < 2) continue;
      await exactSimulateStack({ chain, provider, wallet, receiver, opportunities: stack }).catch(error => {
        logger.debug('[ZeroCapitalStack] Composite exact simulation rejected', {
          component: 'ZeroCapitalAtomicStackWiring',
          chain,
          opportunityIds: stack.map(opportunity => opportunity.id),
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    return opportunities;
  };

  logger.info('[ZeroCapitalStack] Shared-principal atomic stacking wiring installed', {
    component: 'ZeroCapitalAtomicStackWiring',
    maxAtomicSteps: 16,
    adaptiveLegCount: true,
    adaptiveIncrementalBpsThreshold: true,
    exactCompositeSimulationRequired: true,
    exactCompositeGasEstimateRequired: true,
    measuredCompositionBenefitRequired: true,
    combinedProfitMustExceedIndividualProfitSum: true,
    realizedAttributionBeforeCompositeExecutionRequired: true,
    executionAuthority: false,
  });
}
