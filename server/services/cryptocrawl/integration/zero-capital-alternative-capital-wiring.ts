import { Contract, ethers, type Wallet, type providers } from 'ethers';
import type { GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { resolveOperationalProfitRecipient } from '../core/wallet-identity.js';
import { expectedExecutionGasPriceWei } from '../discovery/configured-zero-capital-gas-economics.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { buildFlashLoanExecutionPlanFromOpportunity } from '../execution/adapters/autonomous-route-planner.js';
import { buildSwapCallFromLeg } from '../execution/adapters/onchain-payload-builder.js';
import { minimumPositiveProfitBaseUnits } from '../governance/profit-admission-authority.js';
import {
  buildAtomicLiabilityCycleTransaction,
  buildVaultAtomicCreditTransaction,
  type GhostWalletPreparedTransaction,
  type GhostWalletStep,
} from '../ghost-wallet/ghost-wallet-builder.js';
import {
  buildGhostWalletRuntimeContext,
  loadGhostWalletSourceConfig,
  measureConfiguredGhostWalletSources,
} from '../ghost-wallet/onchain-capital-sources.js';
import {
  ghostWalletAlternativeZeroCapitalSelectionRegistry,
  type GhostWalletAlternativeZeroCapitalSelection,
  type GhostWalletAlternativeZeroCapitalSource,
} from '../ghost-wallet/zero-capital-alternative-selection-registry.js';
import { zeroCapitalRouteEvidenceRegistry } from '../optimization/zero-capital-route-evidence-registry.js';

const INTERMEDIARY_ABI = ['function profitRecipient() view returns (address)'];
const GHOST_VAULT_ABI = ['function previewAtomicFee(uint256 assets) view returns (uint256)'];
const AAVE_POOL_ABI = [
  'function borrow(address asset,uint256 amount,uint256 interestRateMode,uint16 referralCode,address onBehalfOf)',
  'function repay(address asset,uint256 amount,uint256 interestRateMode,address onBehalfOf) returns (uint256)',
];
const AAVE_POOL_INTERFACE = new ethers.utils.Interface(AAVE_POOL_ABI);
const ZERO = ethers.constants.AddressZero;
const BPS_SCALE = 1_000_000n;

interface AlternativeCandidate {
  source: GhostWalletAlternativeZeroCapitalSource;
  sourceAddress: string;
  sourceFee: bigint;
  prepared: GhostWalletPreparedTransaction;
  expiresAt: number;
  gasUnits: bigint;
  gasCostInInputToken: bigint;
  expectedGasPriceWei: bigint;
  allInCost: bigint;
  netProfit: bigint;
  netProfitBps: number;
  provenance: string[];
}

function bpsFromBaseUnits(value: bigint, notional: bigint): number {
  if (notional <= 0n) return Number.NEGATIVE_INFINITY;
  return Number((value * 10_000n * BPS_SCALE) / notional) / Number(BPS_SCALE);
}

function scaledGasCost(originalCost: bigint, originalGasUnits: bigint, measuredGasUnits: bigint): bigint {
  if (originalCost <= 0n || measuredGasUnits <= 0n) return 0n;
  if (originalGasUnits <= 0n) return originalCost;
  return (originalCost * measuredGasUnits + originalGasUnits - 1n) / originalGasUnits;
}

function grossProfitForFundingReprice(opportunity: ZeroCapitalOpportunity): bigint {
  return opportunity.grossProfit
    ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
}

function stringMetadata(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function alternativeEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GHOST_WALLET_INTERMEDIARIES_JSON:
      process.env.ZERO_CAPITAL_ALTERNATIVE_INTERMEDIARIES_JSON
      || process.env.GHOST_WALLET_INTERMEDIARIES_JSON,
    GHOST_WALLET_AAVE_DELEGATIONS_JSON:
      process.env.ZERO_CAPITAL_AAVE_DELEGATIONS_JSON
      || process.env.GHOST_WALLET_AAVE_DELEGATIONS_JSON,
    GHOST_WALLET_CAPITAL_VAULTS_JSON:
      process.env.ZERO_CAPITAL_CAPITAL_VAULTS_JSON
      || process.env.GHOST_WALLET_CAPITAL_VAULTS_JSON,
    // Euler debt-assumption is liquidation-specific and must not be fabricated as
    // fungible principal for a DEX round trip.
    GHOST_WALLET_EULER_DEBT_ASSUMPTIONS_JSON: '[]',
  };
}

function strictFundingReady(funding: GasFundingDecision): boolean {
  return funding.mode !== 'unavailable'
    && funding.strictZeroInitialCapitalEligible === true
    && funding.operatorMonetaryInputRequired === false
    && (funding.paymentSource === 'provider_sponsored' || funding.paymentSource === 'system_owned_native');
}

function routeSteps(opportunity: ZeroCapitalOpportunity, intermediary: string, profitRecipient: string): GhostWalletStep[] {
  const grossProfit = grossProfitForFundingReprice(opportunity);
  if (grossProfit <= 0n) throw new Error('Alternative-capital route has no positive gross value to reprice');
  // The shared planner's positive-profit check protects execution. During funding
  // repricing, plan from the measured positive gross route value so an expensive
  // incumbent funding source cannot prevent a cheaper Ghost source from being
  // evaluated. Only simulateCandidate may promote a newly positive all-in result.
  const planningOpportunity = { ...opportunity, expectedProfit: grossProfit };
  const plan = buildFlashLoanExecutionPlanFromOpportunity(planningOpportunity, {
    receiver: intermediary,
    provider: 'balancer_v2',
    profitRecipient,
    minProfitBaseUnits: minimumPositiveProfitBaseUnits(),
    nowMs: Date.now(),
  });
  return plan.steps.map(leg => {
    const call = buildSwapCallFromLeg(plan.chain, intermediary, { ...leg, recipient: intermediary });
    return {
      target: call.target,
      value: call.value,
      callData: call.data,
      approvalToken: call.approvalToken,
      approvalAmount: call.approvalAmount,
    };
  });
}

function aavePrepared(input: {
  opportunity: ZeroCapitalOpportunity;
  intermediary: string;
  profitRecipient: string;
  pool: string;
  delegator: string;
  liabilityOracle: string;
  liabilityQueryData: string;
  minProfit: bigint;
}): GhostWalletPreparedTransaction {
  const swaps = routeSteps(input.opportunity, input.intermediary, input.profitRecipient);
  const principal = input.opportunity.flashLoanAmount;
  const steps: GhostWalletStep[] = [
    {
      target: input.pool,
      value: '0',
      callData: AAVE_POOL_INTERFACE.encodeFunctionData('borrow', [
        input.opportunity.inputToken,
        principal.toString(),
        2,
        0,
        input.delegator,
      ]),
      approvalToken: ZERO,
      approvalAmount: '0',
    },
    ...swaps,
    {
      target: input.pool,
      value: '0',
      callData: AAVE_POOL_INTERFACE.encodeFunctionData('repay', [
        input.opportunity.inputToken,
        principal.toString(),
        2,
        input.delegator,
      ]),
      approvalToken: input.opportunity.inputToken,
      approvalAmount: principal.toString(),
    },
  ];
  return buildAtomicLiabilityCycleTransaction({
    intermediary: input.intermediary,
    liabilityOracle: input.liabilityOracle,
    liabilityQueryData: input.liabilityQueryData,
    profitAsset: input.opportunity.inputToken,
    minProfit: input.minProfit,
    profitRecipient: input.profitRecipient,
    steps,
  });
}

async function simulateCandidate(input: {
  opportunity: ZeroCapitalOpportunity;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  funding: GasFundingDecision;
  source: GhostWalletAlternativeZeroCapitalSource;
  sourceAddress: string;
  sourceFee: bigint;
  expiresAt: number;
  provenance: string[];
  build: (minimumProfit: bigint) => GhostWalletPreparedTransaction;
}): Promise<AlternativeCandidate | null> {
  const sponsoredZeroCost = input.funding.mode === 'sponsored'
    && input.funding.sponsorOperatorMonetaryCostProvenZero === true;
  if (!sponsoredZeroCost && ((input.opportunity.estimatedGasCostInInputToken || 0n) <= 0n || input.opportunity.gasEstimate <= 0n)) {
    return null;
  }

  const minimumUnit = minimumPositiveProfitBaseUnits();
  let prepared = input.build(minimumUnit);
  const envelope = { from: input.wallet.address, to: prepared.to, data: prepared.data, value: prepared.value };
  await input.provider.call(envelope);
  const gas = await input.provider.estimateGas(envelope);
  const gasUnits = BigInt(gas.toString());
  const measuredGasCost = scaledGasCost(
    input.opportunity.estimatedGasCostInInputToken || 0n,
    input.opportunity.gasEstimate,
    gasUnits,
  );
  const operatorGasCost = sponsoredZeroCost ? 0n : measuredGasCost;
  const relayFee = input.opportunity.relayFeeInInputToken || 0n;
  const requiredOnchainResidual = operatorGasCost + relayFee + minimumUnit;
  prepared = input.build(requiredOnchainResidual);
  const exactEnvelope = { from: input.wallet.address, to: prepared.to, data: prepared.data, value: prepared.value };
  await input.provider.call(exactEnvelope);
  const [exactGas, feeData] = await Promise.all([
    input.provider.estimateGas(exactEnvelope),
    sponsoredZeroCost ? Promise.resolve(null) : input.provider.getFeeData(),
  ]);
  const exactGasUnits = BigInt(exactGas.toString());
  const expectedGasPrice = feeData ? expectedExecutionGasPriceWei(feeData) : 0n;
  if (!sponsoredZeroCost && expectedGasPrice <= 0n) return null;
  const exactMeasuredGasCost = scaledGasCost(
    input.opportunity.estimatedGasCostInInputToken || 0n,
    input.opportunity.gasEstimate,
    exactGasUnits,
  );
  const exactOperatorGasCost = sponsoredZeroCost ? 0n : exactMeasuredGasCost;
  const grossProfit = grossProfitForFundingReprice(input.opportunity);
  const allInCost = input.sourceFee + exactOperatorGasCost + relayFee;
  const netProfit = grossProfit - allInCost;
  if (netProfit <= 0n) return null;

  return {
    source: input.source,
    sourceAddress: input.sourceAddress,
    sourceFee: input.sourceFee,
    prepared,
    expiresAt: input.expiresAt,
    gasUnits: exactGasUnits,
    gasCostInInputToken: exactOperatorGasCost,
    expectedGasPriceWei: expectedGasPrice,
    allInCost,
    netProfit,
    netProfitBps: bpsFromBaseUnits(netProfit, input.opportunity.flashLoanAmount),
    provenance: [
      ...input.provenance,
      'alternative_capital_exact_eth_call_passed',
      'alternative_capital_exact_gas_estimate_measured',
      'alternative_capital_reprice_independent_of_prior_funding_net',
      sponsoredZeroCost
        ? 'execution_gas_operator_cost:zero_proven_sponsored'
        : 'execution_gas_cost:scaled_from_current_canonical_input_token_quote_with_current_fee_data_bound',
      'strict_positive_all_in_net_after_source_fee_and_execution_cost',
      'canonical_flash_provider_behavior_unchanged',
      'synthetic_evidence:false',
    ],
  };
}

function updateEligibleCandidate(opportunity: ZeroCapitalOpportunity, selection: AlternativeCandidate): void {
  const candidate = measuredCandidateRegistry.get(opportunity.id);
  if (!candidate) return;
  measuredCandidateRegistry.updateStatus(opportunity.id, 'eligible', {
    economics: {
      ...candidate.economics,
      deterministicNetProfitUsd: Number(selection.netProfit) / (10 ** opportunity.inputTokenDecimals),
      flashLoanFeeBps: bpsFromBaseUnits(selection.sourceFee, opportunity.flashLoanAmount),
      gasCostBps: bpsFromBaseUnits(selection.gasCostInInputToken, opportunity.flashLoanAmount),
      allInCostBps: bpsFromBaseUnits(selection.allInCost, opportunity.flashLoanAmount),
      breakEvenBps: bpsFromBaseUnits(selection.allInCost, opportunity.flashLoanAmount),
      netProfitBps: selection.netProfitBps,
      bpsToBreakEven: 0,
    },
    executableCapability: true,
    executionCapabilityReason: `Measured ${selection.source} replaces unavailable/non-optimal flash principal for this exact route without changing canonical scheduler authority`,
    replaceMissingInformation: true,
    missingInformation: [],
    provenance: selection.provenance,
  });
}

export async function repriceZeroCapitalAlternativeCapital(input: {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  opportunities: ZeroCapitalOpportunity[];
  executionWallets: Map<SupportedChain, Wallet>;
  getGasFundingDecision: (chain: SupportedChain) => Promise<GasFundingDecision>;
}): Promise<ZeroCapitalOpportunity[]> {
  if (input.chain === 'europa' || input.opportunities.length === 0) return [];
  const wallet = input.executionWallets.get(input.chain);
  if (!wallet) return [];
  const funding = await input.getGasFundingDecision(input.chain);
  if (!strictFundingReady(funding)) return [];

  const config = loadGhostWalletSourceConfig(alternativeEnvironment());
  const intermediaryConfig = config.intermediaries.find(entry => entry.chain === input.chain);
  if (!intermediaryConfig) return [];
  const intermediary = intermediaryConfig.address;
  const code = await input.provider.getCode(intermediary);
  if (code === '0x') return [];

  const profitRecipient = resolveOperationalProfitRecipient();
  const intermediaryContract = new Contract(intermediary, INTERMEDIARY_ABI, input.provider);
  const boundProfitRecipient = ethers.utils.getAddress(String(await intermediaryContract.profitRecipient()));
  if (boundProfitRecipient.toLowerCase() !== profitRecipient.toLowerCase()) return [];

  const context = buildGhostWalletRuntimeContext({
    providers: new Map([[input.chain, input.provider]]),
    config,
  });
  const measurement = await measureConfiguredGhostWalletSources({ context, config });
  const selected: ZeroCapitalOpportunity[] = [];

  for (const opportunity of input.opportunities) {
    ghostWalletAlternativeZeroCapitalSelectionRegistry.remove(opportunity.id);
    const grossProfit = grossProfitForFundingReprice(opportunity);
    if (opportunity.chain !== input.chain || opportunity.expiresAt <= Date.now() || grossProfit <= 0n) continue;
    const quotes = measurement.quotes
      .filter(quote => quote.chain === input.chain)
      .filter(quote => quote.asset.toLowerCase() === opportunity.inputToken.toLowerCase())
      .filter(quote => quote.availablePrincipal >= opportunity.flashLoanAmount)
      .filter(quote => quote.expiresAt > Date.now());
    const alternatives: AlternativeCandidate[] = [];

    for (const quote of quotes) {
      try {
        if (quote.primitive === 'permissionless_vault_capital') {
          const vault = new Contract(quote.sourceAddress, GHOST_VAULT_ABI, input.provider);
          const sourceFee = BigInt((await vault.previewAtomicFee(opportunity.flashLoanAmount.toString())).toString());
          const candidate = await simulateCandidate({
            opportunity,
            provider: input.provider,
            wallet,
            funding,
            source: 'permissionless_vault_capital',
            sourceAddress: quote.sourceAddress,
            sourceFee,
            expiresAt: Math.min(opportunity.expiresAt, quote.expiresAt),
            provenance: [...quote.provenance, 'alternative_source:permissionless_vault_atomic_capital'],
            build: minimumProfit => buildVaultAtomicCreditTransaction({
              intermediary,
              vault: quote.sourceAddress,
              principal: opportunity.flashLoanAmount,
              sourceFee,
              minProfit: minimumProfit,
              profitRecipient,
              steps: routeSteps(opportunity, intermediary, profitRecipient),
            }),
          });
          if (candidate) alternatives.push(candidate);
          continue;
        }

        if (quote.primitive === 'aave_credit_delegation') {
          const pool = stringMetadata(quote.metadata?.pool);
          const delegator = stringMetadata(quote.metadata?.delegator);
          const liabilityOracle = stringMetadata(quote.metadata?.liabilityOracle);
          const liabilityQueryData = stringMetadata(quote.metadata?.liabilityQueryData);
          if (!pool || !delegator || !liabilityOracle || !liabilityQueryData) continue;
          const candidate = await simulateCandidate({
            opportunity,
            provider: input.provider,
            wallet,
            funding,
            source: 'aave_credit_delegation',
            sourceAddress: pool,
            sourceFee: 0n,
            expiresAt: Math.min(opportunity.expiresAt, quote.expiresAt),
            provenance: [...quote.provenance, 'alternative_source:aave_credit_delegation'],
            build: minimumProfit => aavePrepared({
              opportunity,
              intermediary,
              profitRecipient,
              pool,
              delegator,
              liabilityOracle,
              liabilityQueryData,
              minProfit: minimumProfit,
            }),
          });
          if (candidate) alternatives.push(candidate);
        }
      } catch {
        // Each source fails closed independently; another measured source may still qualify.
      }
    }

    alternatives.sort((left, right) => {
      if (left.netProfit !== right.netProfit) return left.netProfit > right.netProfit ? -1 : 1;
      if (left.expiresAt !== right.expiresAt) return right.expiresAt - left.expiresAt;
      return left.source.localeCompare(right.source);
    });
    const best = alternatives[0];
    if (!best) continue;

    opportunity.flashLoanFeeInInputToken = best.sourceFee;
    opportunity.estimatedGasCostInInputToken = best.gasCostInInputToken;
    opportunity.estimatedExecutionCostInInputToken = best.allInCost;
    opportunity.expectedProfit = best.netProfit;
    opportunity.netProfitBps = best.netProfitBps;
    opportunity.gasEstimate = best.gasUnits;
    zeroCapitalRouteEvidenceRegistry.record(opportunity);

    const registrySelection: GhostWalletAlternativeZeroCapitalSelection = {
      opportunityId: opportunity.id,
      chain: opportunity.chain,
      asset: opportunity.inputToken,
      intermediary,
      source: best.source,
      sourceAddress: best.sourceAddress,
      principal: opportunity.flashLoanAmount,
      sourceFee: best.sourceFee,
      prepared: best.prepared,
      selectedAt: Date.now(),
      expiresAt: best.expiresAt,
      expectedNetProfit: best.netProfit,
      expectedNetProfitBps: best.netProfitBps,
      estimatedGasUnits: best.gasUnits,
      estimatedGasCostInInputToken: best.gasCostInInputToken,
      expectedGasPriceWei: best.expectedGasPriceWei,
      provenance: best.provenance,
    };
    ghostWalletAlternativeZeroCapitalSelectionRegistry.record(registrySelection);
    updateEligibleCandidate(opportunity, best);
    selected.push(opportunity);
  }

  return selected;
}
