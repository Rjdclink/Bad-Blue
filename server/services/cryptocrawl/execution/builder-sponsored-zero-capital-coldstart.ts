import { BigNumber, Wallet, ethers, providers } from 'ethers';
import logger from '../../../logger.js';
import { livePriceMesh } from '../bridge/live-price-mesh.js';
import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { isStrictlyPositiveProfitBaseUnits, minimumPositiveProfitBaseUnits } from '../governance/profit-admission-authority.js';
import { buildFlashLoanExecutionPlanFromOpportunity } from './adapters/autonomous-route-planner.js';
import {
  bufferedBuilderGasLimit,
  builderGasSimulationSafetyBps,
  BuilderSequentialSimulationExecutionError,
  maxBuilderGasVectors,
  simulateBuilderSequentialGas,
  sumBuilderGasLimits,
  type BuilderSequentialSimulationCall,
} from './adapters/builder-sequential-gas-simulator.js';
import {
  BuilderSponsoredBundleAdapter,
  type BuilderSponsoredBundleCandidate,
  type BuilderSponsoredBundleResult,
  type BuilderSpecificSignedBundle,
  type SponsoredBuilderName,
} from './adapters/builder-sponsored-bundle.js';
import { buildBuilderRepaymentSwapData, selectBuilderRepaymentRoute } from './adapters/builder-repayment-route.js';
import { buildDualFlashLoanReceiverPayload } from './adapters/dual-flashloan-receiver-builder.js';
import { buildFlashLoanReceiverPayloadFromPlan } from './adapters/flashloan-receiver-builder.js';
import type { FlashLoanProviderSelection } from './adapters/flash-loan-provider-selection-registry.js';
import type { FlashLoanProviderEconomics } from './adapters/flash-loan-provider-economics.js';

const ETHEREUM_USDC = '0xA0b86991c6218B36c1d19D4a2e9Eb0cE3606eB48';
const ETHEREUM_USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const ERC20_INTERFACE = new ethers.utils.Interface([
  'function approve(address spender,uint256 amount) returns (bool)',
]);
const BPS_PRECISION = 1_000_000n;

// Compatibility fallback only when every available RPC lacks sequential-state
// simulation. These values are never preferred admission economics.
const LEGACY_FLASH_GAS_SINGLE = 1_400_000;
const LEGACY_FLASH_GAS_DUAL = 1_800_000;
const LEGACY_APPROVAL_GAS = 100_000;
const LEGACY_CONVERSION_GAS = 300_000;
const LEGACY_PAYMENT_GAS = 21_000;

export interface BuilderSponsoredReceiverBootstrapEvidence {
  owner: string;
  vault: string;
  factory: string;
  deploymentTransactionIndex: number;
  permissionTransactionCount: number;
}

export interface BuilderSponsoredZeroCapitalEvidence {
  opportunityId: string;
  observedAt: number;
  expiresAt: number;
  targetBlock: number;
  inputToken: string;
  inputAssetSymbol: 'USDC' | 'USDT';
  receiver: string;
  providerLabel: string;
  executionTransactionIndex: number;
  receiverBootstrap?: BuilderSponsoredReceiverBootstrapEvidence;
  bootstrapProviderEconomics?: FlashLoanProviderEconomics;
  builderGasCostInInputToken: bigint;
  guaranteedNetProfitInInputToken: bigint;
  admittedNetProfitBps: number;
  guaranteedResidualProfitUsd: number;
  requiredSponsorshipWei: bigint;
  builderPaymentWei: bigint;
  minimumBuilderResidualWei: bigint;
  candidates: BuilderSponsoredBundleCandidate[];
  provenance: string[];
}

export interface BuilderSponsoredZeroCapitalSubmission {
  evidence: BuilderSponsoredZeroCapitalEvidence;
  candidate: BuilderSponsoredBundleCandidate;
  result: BuilderSponsoredBundleResult;
  executionTransactionHash: string;
}

interface FinalColdStartSizing {
  requiredSponsorshipWei: bigint;
  builderPaymentWei: bigint;
  repaymentRoute: NonNullable<Awaited<ReturnType<typeof selectBuilderRepaymentRoute>>>;
  builderGasCostInInputToken: bigint;
  guaranteedNetProfitInInputToken: bigint;
  payload: ReturnType<typeof buildFlashLoanReceiverPayloadFromPlan>;
  gasLimits: BigNumber[];
  gasSimulationProvider: string;
  dynamicGasMeasurement: boolean;
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  const normalized = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(min, Math.min(max, normalized));
}

function stableAddress(symbol: 'USDC' | 'USDT'): string {
  return symbol === 'USDC' ? ETHEREUM_USDC : ETHEREUM_USDT;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function preciseBps(value: bigint, notional: bigint): number {
  if (notional <= 0n) return Number.NEGATIVE_INFINITY;
  return Number((value * 10_000n * BPS_PRECISION) / notional) / Number(BPS_PRECISION);
}

function maxBigNumber(left: BigNumber | null | undefined, right: BigNumber): BigNumber {
  if (!left) return right;
  return left.gte(right) ? left : right;
}

function cloneCandidate(candidate: BuilderSponsoredBundleCandidate): BuilderSponsoredBundleCandidate {
  return { ...candidate, signedTransactions: [...candidate.signedTransactions], transactionHashes: [...candidate.transactionHashes] };
}

function cloneEvidence(evidence: BuilderSponsoredZeroCapitalEvidence): BuilderSponsoredZeroCapitalEvidence {
  return {
    ...evidence,
    receiverBootstrap: evidence.receiverBootstrap ? { ...evidence.receiverBootstrap } : undefined,
    bootstrapProviderEconomics: evidence.bootstrapProviderEconomics ? {
      ...evidence.bootstrapProviderEconomics,
      missingEvidence: [...evidence.bootstrapProviderEconomics.missingEvidence],
      provenance: [...evidence.bootstrapProviderEconomics.provenance],
    } : undefined,
    candidates: evidence.candidates.map(cloneCandidate),
    provenance: [...evidence.provenance],
  };
}

class BuilderSponsoredZeroCapitalRegistry {
  private readonly entries = new Map<string, BuilderSponsoredZeroCapitalEvidence>();
  private readonly maxEntries = Math.max(32, Math.min(2048, Number(process.env.ZERO_CAPITAL_BUILDER_EVIDENCE_MAX || 512)));

  record(evidence: BuilderSponsoredZeroCapitalEvidence): void {
    if (!evidence.opportunityId || evidence.expiresAt <= evidence.observedAt || evidence.candidates.length === 0) return;
    if (!ethers.utils.isAddress(evidence.receiver) || !Number.isSafeInteger(evidence.executionTransactionIndex) || evidence.executionTransactionIndex < 0) return;
    this.entries.set(evidence.opportunityId, cloneEvidence(evidence));
    this.prune();
  }

  get(opportunityId: string, now = Date.now()): BuilderSponsoredZeroCapitalEvidence | null {
    const evidence = this.entries.get(opportunityId);
    if (!evidence || evidence.expiresAt <= now) {
      if (evidence) this.entries.delete(opportunityId);
      return null;
    }
    return cloneEvidence(evidence);
  }

  remove(opportunityId: string): void {
    this.entries.delete(opportunityId);
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, evidence] of this.entries) if (evidence.expiresAt <= now) this.entries.delete(id);
    if (this.entries.size <= this.maxEntries) return;
    const oldest = [...this.entries.values()].sort((left, right) => left.observedAt - right.observedAt);
    for (let index = 0; index < oldest.length - this.maxEntries; index++) this.entries.delete(oldest[index].opportunityId);
  }
}

export const builderSponsoredZeroCapitalRegistry = new BuilderSponsoredZeroCapitalRegistry();

async function currentFeeCeiling(provider: providers.JsonRpcProvider): Promise<{
  maxFeePerGas: BigNumber;
  maxPriorityFeePerGas: BigNumber;
}> {
  const [feeData, latestBlock] = await Promise.all([provider.getFeeData(), provider.getBlock('latest')]);
  const baseFee = latestBlock.baseFeePerGas;
  if (!baseFee || baseFee.lte(0)) throw new Error('Ethereum base fee is unavailable for builder-sponsored gas proof');
  const configuredPriorityGwei = Number(process.env.ZERO_CAPITAL_BUILDER_PRIORITY_FEE_GWEI || '0.1');
  const priority = ethers.utils.parseUnits(
    String(Number.isFinite(configuredPriorityGwei) ? Math.max(0, Math.min(10, configuredPriorityGwei)) : 0.1),
    'gwei',
  );
  const baseCeiling = baseFee.mul(2).add(priority);
  return {
    maxFeePerGas: maxBigNumber(feeData.maxFeePerGas, baseCeiling),
    maxPriorityFeePerGas: maxBigNumber(feeData.maxPriorityFeePerGas, priority),
  };
}

async function liveStableUsd(symbol: 'USDC' | 'USDT'): Promise<number> {
  const prices = await livePriceMesh.getLiveSymbolPrices([symbol]);
  const value = prices.get(symbol);
  if (!Number.isFinite(value) || Number(value) <= 0) throw new Error(`${symbol}/USD live price unavailable for builder residual economics`);
  return Number(value);
}

function legacyFallbackGasLimits(dual: boolean): BigNumber[] {
  return [
    BigNumber.from(dual ? LEGACY_FLASH_GAS_DUAL : LEGACY_FLASH_GAS_SINGLE),
    BigNumber.from(LEGACY_APPROVAL_GAS),
    BigNumber.from(LEGACY_CONVERSION_GAS),
    BigNumber.from(LEGACY_PAYMENT_GAS),
  ];
}

function buildPayload(
  opportunity: ZeroCapitalOpportunity,
  selection: FlashLoanProviderSelection,
  minimumReceiverProfit: bigint,
  wallet: Wallet,
) {
  const grossProfit = opportunity.grossProfit ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
  const flashFee = opportunity.flashLoanFeeInInputToken || 0n;
  const relayFee = opportunity.relayFeeInInputToken || 0n;
  const planningOpportunity = { ...opportunity, expectedProfit: grossProfit - flashFee - relayFee };
  const plan = buildFlashLoanExecutionPlanFromOpportunity(planningOpportunity, {
    receiver: selection.receiver,
    provider: selection.kind === 'single' ? selection.provider : 'balancer_v2',
    profitRecipient: wallet.address,
    minProfitBaseUnits: minimumReceiverProfit,
    nowMs: Date.now(),
  });
  return selection.kind === 'dual'
    ? buildDualFlashLoanReceiverPayload({
        chain: plan.chain,
        receiver: selection.receiver,
        loanToken: plan.loanToken,
        balancerAmount: selection.balancerAmount.toString(),
        aaveAmount: selection.aaveAmount.toString(),
        minProfit: plan.minProfit,
        profitRecipient: plan.profitRecipient,
        steps: plan.steps,
      })
    : buildFlashLoanReceiverPayloadFromPlan(plan);
}

async function finalSizing(input: {
  opportunity: ZeroCapitalOpportunity;
  selection: FlashLoanProviderSelection;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  adapter: BuilderSponsoredBundleAdapter;
  builders: SponsoredBuilderName[];
  maxFeePerGas: BigNumber;
  minimumBuilderResidualWei: bigint;
  deadline: number;
}): Promise<FinalColdStartSizing | null> {
  const { opportunity, selection, provider, wallet, adapter, builders } = input;
  const flashFee = opportunity.flashLoanFeeInInputToken || 0n;
  const relayFee = opportunity.relayFeeInInputToken || 0n;
  const grossProfit = opportunity.grossProfit ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
  const preBuilderProfit = grossProfit - flashFee - relayFee;
  if (preBuilderProfit <= 0n) return null;
  const minimumRetained = minimumPositiveProfitBaseUnits();
  const conversionSlippageBps = boundedInteger(process.env.ZERO_CAPITAL_BUILDER_CONVERSION_MAX_SLIPPAGE_BPS, 50, 1, 500);
  const convergenceAttempts = boundedInteger(process.env.ZERO_CAPITAL_BUILDER_GAS_CONVERGENCE_ATTEMPTS, 4, 2, 6);

  let requiredSponsorshipWei = 1n;
  let capabilityFailure: unknown = null;

  for (let attempt = 0; attempt < convergenceAttempts; attempt += 1) {
    const builderPaymentWei = requiredSponsorshipWei + input.minimumBuilderResidualWei;
    const repaymentRoute = await selectBuilderRepaymentRoute({
      provider,
      inputToken: opportunity.inputToken,
      amountOutWei: builderPaymentWei,
      slippageBps: conversionSlippageBps,
    });
    if (!repaymentRoute) return null;
    const builderGasCostInInputToken = repaymentRoute.maxInput;
    const minimumReceiverProfit = builderGasCostInInputToken + minimumRetained;
    if (preBuilderProfit < minimumReceiverProfit) return null;
    const guaranteedNetProfitInInputToken = grossProfit - flashFee - relayFee - builderGasCostInInputToken;
    if (!isStrictlyPositiveProfitBaseUnits(guaranteedNetProfitInInputToken)) return null;

    const payload = buildPayload(opportunity, selection, minimumReceiverProfit, wallet);
    const amountInMax = BigNumber.from(builderGasCostInInputToken.toString());
    const prefixCalls: BuilderSequentialSimulationCall[] = [
      { from: wallet.address, to: payload.to, data: payload.data, value: BigNumber.from(payload.value) },
      {
        from: wallet.address,
        to: opportunity.inputToken,
        data: ERC20_INTERFACE.encodeFunctionData('approve', [repaymentRoute.router, amountInMax]),
        value: BigNumber.from(0),
      },
      {
        from: wallet.address,
        to: repaymentRoute.router,
        data: buildBuilderRepaymentSwapData({
          route: repaymentRoute,
          amountOutWei: builderPaymentWei,
          recipient: wallet.address,
          deadline: input.deadline,
        }),
        value: BigNumber.from(0),
      },
    ];

    try {
      const simulations = await Promise.all(builders.map(builder => simulateBuilderSequentialGas([
        ...prefixCalls,
        {
          from: wallet.address,
          to: adapter.getBuilderCoinbase(builder),
          data: '0x',
          value: BigNumber.from(builderPaymentWei.toString()),
        },
      ])));
      const maximumGasUsed = maxBuilderGasVectors(simulations.map(simulation => simulation.gasUsed));
      const gasLimits = maximumGasUsed.map(bufferedBuilderGasLimit);
      const measuredSponsorshipWei = sumBuilderGasLimits(gasLimits) * BigInt(input.maxFeePerGas.toString());
      if (measuredSponsorshipWei <= 0n) return null;
      if (measuredSponsorshipWei <= requiredSponsorshipWei) {
        return {
          requiredSponsorshipWei,
          builderPaymentWei,
          repaymentRoute,
          builderGasCostInInputToken,
          guaranteedNetProfitInInputToken,
          payload,
          gasLimits,
          gasSimulationProvider: [...new Set(simulations.map(simulation => simulation.provider))].join(','),
          dynamicGasMeasurement: true,
        };
      }
      requiredSponsorshipWei = measuredSponsorshipWei;
    } catch (error) {
      if (error instanceof BuilderSequentialSimulationExecutionError) {
        // Exact evolving-state simulation proved this route invalid. Do not let a
        // fixed fallback manufacture different economics from the same state.
        return null;
      }
      capabilityFailure = error;
      break;
    }
  }

  if (!capabilityFailure) {
    logger.debug('[ZeroCapitalBuilderColdStart] Dynamic gas sizing did not converge inside bounded attempts', {
      component: 'BuilderSponsoredZeroCapitalColdStart',
      opportunityId: opportunity.id,
      convergenceAttempts,
      routeLocalFailure: true,
      executionAuthority: false,
    });
    return null;
  }

  // Preserve the pre-existing builder capability if the available RPC mesh cannot
  // perform eth_simulateV1. This fallback is intentionally conservative and is
  // never selected when stateful simulation returns an actual EVM failure.
  const gasLimits = legacyFallbackGasLimits(selection.kind === 'dual');
  requiredSponsorshipWei = sumBuilderGasLimits(gasLimits) * BigInt(input.maxFeePerGas.toString());
  const builderPaymentWei = requiredSponsorshipWei + input.minimumBuilderResidualWei;
  const repaymentRoute = await selectBuilderRepaymentRoute({
    provider,
    inputToken: opportunity.inputToken,
    amountOutWei: builderPaymentWei,
    slippageBps: conversionSlippageBps,
  });
  if (!repaymentRoute) return null;
  const builderGasCostInInputToken = repaymentRoute.maxInput;
  const minimumReceiverProfit = builderGasCostInInputToken + minimumRetained;
  if (preBuilderProfit < minimumReceiverProfit) return null;
  const guaranteedNetProfitInInputToken = grossProfit - flashFee - relayFee - builderGasCostInInputToken;
  if (!isStrictlyPositiveProfitBaseUnits(guaranteedNetProfitInInputToken)) return null;
  const payload = buildPayload(opportunity, selection, minimumReceiverProfit, wallet);

  logger.debug('[ZeroCapitalBuilderColdStart] Stateful gas simulation unavailable; conservative legacy gas vector preserved as capability fallback', {
    component: 'BuilderSponsoredZeroCapitalColdStart',
    opportunityId: opportunity.id,
    error: capabilityFailure instanceof Error ? capabilityFailure.message : String(capabilityFailure),
    fixedGasPreferred: false,
    fallbackOnly: true,
    capabilityNarrowed: false,
    executionAuthority: false,
  });

  return {
    requiredSponsorshipWei,
    builderPaymentWei,
    repaymentRoute,
    builderGasCostInInputToken,
    guaranteedNetProfitInInputToken,
    payload,
    gasLimits,
    gasSimulationProvider: 'legacy_conservative_capability_fallback',
    dynamicGasMeasurement: false,
  };
}

/**
 * Prepare an opportunity-specific Ethereum private-builder cold start. Normal
 * admission measures the entire execution -> approval -> repayment conversion ->
 * builder-payment sequence against evolving state, then converges sponsorship and
 * repayment sizing. Titan/Quasar remain transport alternatives and this function
 * never owns execution authority.
 */
export async function prepareBuilderSponsoredZeroCapitalColdStart(input: {
  opportunity: ZeroCapitalOpportunity;
  selection: FlashLoanProviderSelection;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
}): Promise<BuilderSponsoredZeroCapitalEvidence | null> {
  const { opportunity, selection, provider, wallet } = input;
  if (opportunity.chain !== 'ethereum' || Date.now() >= opportunity.expiresAt) return null;
  const network = await provider.getNetwork();
  if (network.chainId !== 1 || selection.expiresAt <= Date.now()) return null;
  if (selection.receiverCapability.owner.toLowerCase() !== wallet.address.toLowerCase()) return null;
  if (!sameAddress(opportunity.inputToken, stableAddress(opportunity.inputAssetSymbol)) || opportunity.inputTokenDecimals !== 6) return null;

  const adapter = new BuilderSponsoredBundleAdapter(provider);
  const builders = adapter.listBuilders();
  if (builders.length === 0) return null;
  const fees = await currentFeeCeiling(provider);
  const minimumBuilderResidualWei = BigInt(process.env.ZERO_CAPITAL_BUILDER_MIN_RESIDUAL_WEI || '10000000000000');
  if (minimumBuilderResidualWei <= 0n) throw new Error('ZERO_CAPITAL_BUILDER_MIN_RESIDUAL_WEI must be positive');

  const [nonce, currentBlock] = await Promise.all([
    provider.getTransactionCount(wallet.address, 'pending'),
    provider.getBlockNumber(),
  ]);
  const targetBlock = currentBlock + 1;
  const ttlMs = boundedInteger(process.env.ZERO_CAPITAL_BUILDER_EVIDENCE_TTL_MS, 30_000, 1_000, 120_000);
  const observedAt = Date.now();
  const expiresAt = Math.min(opportunity.expiresAt, observedAt + ttlMs);
  if (expiresAt <= observedAt) return null;
  const deadline = Math.floor(expiresAt / 1000) + 30;

  const sizing = await finalSizing({
    opportunity,
    selection,
    provider,
    wallet,
    adapter,
    builders,
    maxFeePerGas: fees.maxFeePerGas,
    minimumBuilderResidualWei,
    deadline,
  });
  if (!sizing) return null;

  const {
    requiredSponsorshipWei,
    builderPaymentWei,
    repaymentRoute,
    builderGasCostInInputToken,
    guaranteedNetProfitInInputToken,
    payload,
    gasLimits,
    gasSimulationProvider,
    dynamicGasMeasurement,
  } = sizing;
  if (gasLimits.length !== 4) return null;

  const guaranteedResidualProfitUsd = Number(guaranteedNetProfitInInputToken) / 1_000_000 * await liveStableUsd(opportunity.inputAssetSymbol);
  if (!Number.isFinite(guaranteedResidualProfitUsd) || guaranteedResidualProfitUsd <= 0) return null;

  const common = {
    chainId: 1,
    type: 2,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  } as const;
  const amountInMax = BigNumber.from(builderGasCostInInputToken.toString());
  const baseTransactions = [
    {
      ...common,
      nonce,
      to: payload.to,
      data: payload.data,
      value: BigNumber.from(payload.value),
      gasLimit: gasLimits[0],
    },
    {
      ...common,
      nonce: nonce + 1,
      to: opportunity.inputToken,
      data: ERC20_INTERFACE.encodeFunctionData('approve', [repaymentRoute.router, amountInMax]),
      value: BigNumber.from(0),
      gasLimit: gasLimits[1],
    },
    {
      ...common,
      nonce: nonce + 2,
      to: repaymentRoute.router,
      data: buildBuilderRepaymentSwapData({
        route: repaymentRoute,
        amountOutWei: builderPaymentWei,
        recipient: wallet.address,
        deadline,
      }),
      value: BigNumber.from(0),
      gasLimit: gasLimits[2],
    },
  ];
  const signedPrefix = await Promise.all(baseTransactions.map(transaction => wallet.signTransaction(transaction)));
  const bundles: BuilderSpecificSignedBundle[] = [];
  for (const builder of builders) {
    const payment = await wallet.signTransaction({
      ...common,
      nonce: nonce + 3,
      to: adapter.getBuilderCoinbase(builder),
      value: BigNumber.from(builderPaymentWei.toString()),
      gasLimit: gasLimits[3],
    });
    bundles.push({ builder, signedTransactions: [...signedPrefix, payment] });
  }

  const candidates = await adapter.prepareCandidates({
    bundles,
    expectedPaymentSender: wallet.address,
    targetBlock,
    expiresAt,
    economics: {
      source: 'execution_created_value',
      requiredSponsorshipWei,
      minimumBuilderResidualWei,
      guaranteedResidualProfitUsd,
      observedAt,
      expiresAt,
    },
  });
  if (candidates.length === 0) return null;

  const admittedNetProfitBps = preciseBps(guaranteedNetProfitInInputToken, opportunity.flashLoanAmount);
  if (!isStrictlyPositiveProfitBaseUnits(guaranteedNetProfitInInputToken)) return null;

  const evidence: BuilderSponsoredZeroCapitalEvidence = {
    opportunityId: opportunity.id,
    observedAt,
    expiresAt,
    targetBlock,
    inputToken: opportunity.inputToken,
    inputAssetSymbol: opportunity.inputAssetSymbol,
    receiver: selection.receiver,
    providerLabel: selection.provider,
    executionTransactionIndex: 0,
    builderGasCostInInputToken,
    guaranteedNetProfitInInputToken,
    admittedNetProfitBps,
    guaranteedResidualProfitUsd,
    requiredSponsorshipWei,
    builderPaymentWei,
    minimumBuilderResidualWei,
    candidates,
    provenance: [
      'builder_private_bundle:opportunity_specific',
      'builder_native_prefund:titan_or_quasar_sponsored_bundle',
      'operator_native_gas_input_required:false',
      'builder_sponsorship_repaid_from_execution_created_value:true',
      'builder_payment_source:execution_created_value',
      'builder_payment_transport:titan_or_quasar',
      ...repaymentRoute.provenance,
      'builder_all_in_cost_attribution:stablecoin_input_max',
      'minimum_residual:canonical_strict_positive_base_units',
      dynamicGasMeasurement
        ? 'builder_gas_measurement:eth_simulateV1_sequential_stateful'
        : 'builder_gas_measurement:legacy_conservative_capability_fallback',
      `builder_gas_measurement_provider:${gasSimulationProvider}`,
      `builder_gas_safety_bps:${builderGasSimulationSafetyBps().toString()}`,
      dynamicGasMeasurement ? 'fixed_gas_ceiling_admission:false' : 'fixed_gas_ceiling_admission:fallback_only',
      'forced_future_native_reserve_seeding:false',
      'gas_fee_ceiling:eip1559_base_fee_x2_plus_priority',
      'strict_positive_all_in_residual',
      'sub_bps_precision_preserved:true',
      'synthetic_evidence:false',
    ],
  };
  builderSponsoredZeroCapitalRegistry.record(evidence);
  logger.info('[ZeroCapitalBuilderColdStart] Builder-sponsored zero-native-capital candidate prepared', {
    component: 'BuilderSponsoredZeroCapitalColdStart',
    opportunityId: opportunity.id,
    builders: candidates.map(candidate => candidate.builder),
    targetBlock,
    builderRepaymentRoute: repaymentRoute.name,
    builderRepaymentRouter: repaymentRoute.router,
    builderGasCostInInputToken: builderGasCostInInputToken.toString(),
    guaranteedNetProfitInInputToken: guaranteedNetProfitInInputToken.toString(),
    guaranteedResidualProfitUsd,
    requiredSponsorshipWei: requiredSponsorshipWei.toString(),
    builderPaymentWei: builderPaymentWei.toString(),
    gasSimulationProvider,
    dynamicGasMeasurement,
    measuredBufferedBundleGasUnits: sumBuilderGasLimits(gasLimits).toString(),
    operatorNativeGasInputRequired: false,
    systemOwnedNativeGasRequired: false,
    builderSponsorshipRepaidFromExecutionCreatedValue: true,
    executionAuthority: false,
  });
  return cloneEvidence(evidence);
}

/** Canonical executor calls this; the adapter itself never owns retry authority. */
export async function submitPreparedBuilderSponsoredZeroCapital(input: {
  opportunityId: string;
  provider: providers.JsonRpcProvider;
}): Promise<BuilderSponsoredZeroCapitalSubmission | null> {
  const evidence = builderSponsoredZeroCapitalRegistry.get(input.opportunityId);
  if (!evidence) return null;
  const adapter = new BuilderSponsoredBundleAdapter(input.provider);

  for (const candidate of evidence.candidates) {
    const result = await adapter.submitCandidate(candidate);
    const executionTransactionHash = candidate.transactionHashes[evidence.executionTransactionIndex];
    if (!executionTransactionHash) return null;
    if (result.status === 'confirmed' || result.status === 'ambiguous') {
      return { evidence, candidate, result, executionTransactionHash };
    }
  }
  return null;
}
