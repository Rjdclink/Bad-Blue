import { BigNumber, Contract, Wallet, ethers, providers } from 'ethers';
import logger from '../../../logger.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { isStrictlyPositiveProfitBaseUnits, minimumPositiveProfitBaseUnits } from '../governance/profit-admission-authority.js';
import { buildFlashLoanExecutionPlanFromOpportunity } from './adapters/autonomous-route-planner.js';
import {
  BuilderSponsoredBundleAdapter,
  type BuilderSponsoredBundleCandidate,
  type BuilderSponsoredBundleResult,
  type BuilderSpecificSignedBundle,
} from './adapters/builder-sponsored-bundle.js';
import { buildDualFlashLoanReceiverPayload } from './adapters/dual-flashloan-receiver-builder.js';
import { buildFlashLoanReceiverPayloadFromPlan } from './adapters/flashloan-receiver-builder.js';
import type { FlashLoanProviderSelection } from './adapters/flash-loan-provider-selection-registry.js';
import type { FlashLoanProviderEconomics } from './adapters/flash-loan-provider-economics.js';

const ETHEREUM_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const ETHEREUM_USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const SUSHISWAP_V2_ROUTER = '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F';

const ERC20_INTERFACE = new ethers.utils.Interface([
  'function approve(address spender,uint256 amount) returns (bool)',
]);
const ROUTER_INTERFACE = new ethers.utils.Interface([
  'function getAmountsIn(uint256 amountOut,address[] path) view returns (uint256[] amounts)',
  'function swapTokensForExactETH(uint256 amountOut,uint256 amountInMax,address[] path,address to,uint256 deadline) returns (uint256[] amounts)',
]);
const ROUTER_VIEW_ABI = ['function getAmountsIn(uint256 amountOut,address[] path) view returns (uint256[] amounts)'];

const FLASH_GAS_SINGLE = 1_400_000;
const FLASH_GAS_DUAL = 1_800_000;
const APPROVAL_GAS = 100_000;
const CONVERSION_GAS = 300_000;
const PAYMENT_GAS = 21_000;

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

function ceilBps(value: bigint, bps: number): bigint {
  return (value * BigInt(10_000 + bps) + 9_999n) / 10_000n;
}

function maxBigNumber(left: BigNumber | null | undefined, right: BigNumber): BigNumber {
  if (!left) return right;
  return left.gte(right) ? left : right;
}

function cloneCandidate(candidate: BuilderSponsoredBundleCandidate): BuilderSponsoredBundleCandidate {
  return {
    ...candidate,
    signedTransactions: [...candidate.signedTransactions],
    transactionHashes: [...candidate.transactionHashes],
  };
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
  const [feeData, latestBlock] = await Promise.all([
    provider.getFeeData(),
    provider.getBlock('latest'),
  ]);
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

function gasUpperBoundWei(maxFeePerGas: BigNumber, dual: boolean): bigint {
  const gasUnits = BigInt((dual ? FLASH_GAS_DUAL : FLASH_GAS_SINGLE) + APPROVAL_GAS + CONVERSION_GAS + PAYMENT_GAS);
  return gasUnits * BigInt(maxFeePerGas.toString());
}

async function liveStableUsd(symbol: 'USDC' | 'USDT'): Promise<number> {
  const prices = await coinGeckoPriceClient.getLiveSymbolPrices([symbol]);
  const value = prices.get(symbol);
  if (!Number.isFinite(value) || Number(value) <= 0) throw new Error(`${symbol}/USD live price unavailable for builder residual economics`);
  return Number(value);
}

/**
 * Prepare an opportunity-specific Ethereum builder sponsorship proof. This is not
 * a chain-wide gas-ready flag. The signed bundle itself must create the ETH used
 * to repay the builder, and the stablecoin route must remain positive after the
 * maximum stablecoin input required for that repayment.
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
  if (network.chainId !== 1) return null;
  if (selection.expiresAt <= Date.now()) return null;
  if (selection.receiverCapability.owner.toLowerCase() !== wallet.address.toLowerCase()) return null;
  if (!sameAddress(opportunity.inputToken, stableAddress(opportunity.inputAssetSymbol))) return null;
  if (opportunity.inputTokenDecimals !== 6) return null;

  const adapter = new BuilderSponsoredBundleAdapter(provider);
  const builders = adapter.listBuilders();
  if (builders.length === 0) return null;

  const fees = await currentFeeCeiling(provider);
  const requiredSponsorshipWei = gasUpperBoundWei(fees.maxFeePerGas, selection.kind === 'dual');
  const minimumBuilderResidualWei = BigInt(
    process.env.ZERO_CAPITAL_BUILDER_MIN_RESIDUAL_WEI || '10000000000000',
  );
  if (minimumBuilderResidualWei <= 0n) throw new Error('ZERO_CAPITAL_BUILDER_MIN_RESIDUAL_WEI must be positive');
  const builderPaymentWei = requiredSponsorshipWei + minimumBuilderResidualWei;

  const router = new Contract(SUSHISWAP_V2_ROUTER, ROUTER_VIEW_ABI, provider);
  const amounts = await router.getAmountsIn(
    BigNumber.from(builderPaymentWei.toString()),
    [opportunity.inputToken, WETH],
  ) as BigNumber[];
  if (!Array.isArray(amounts) || amounts.length !== 2 || !amounts[0] || amounts[0].lte(0)) return null;
  const conversionSlippageBps = boundedInteger(process.env.ZERO_CAPITAL_BUILDER_CONVERSION_MAX_SLIPPAGE_BPS, 50, 1, 500);
  const builderGasCostInInputToken = ceilBps(BigInt(amounts[0].toString()), conversionSlippageBps);

  const flashFee = opportunity.flashLoanFeeInInputToken || 0n;
  const relayFee = opportunity.relayFeeInInputToken || 0n;
  const grossProfit = opportunity.grossProfit ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
  const preBuilderProfit = grossProfit - flashFee - relayFee;
  const minimumRetained = BigInt(process.env.ZERO_CAPITAL_BUILDER_MIN_RETAINED_PROFIT_BASE_UNITS || minimumPositiveProfitBaseUnits().toString());
  const minimumReceiverProfit = builderGasCostInInputToken + minimumRetained;
  if (minimumRetained <= 0n || preBuilderProfit < minimumReceiverProfit) return null;

  const allInCost = flashFee + relayFee + builderGasCostInInputToken;
  const guaranteedNetProfitInInputToken = grossProfit - allInCost;
  if (guaranteedNetProfitInInputToken <= 0n) return null;
  const stableUsd = await liveStableUsd(opportunity.inputAssetSymbol);
  const guaranteedResidualProfitUsd = Number(guaranteedNetProfitInInputToken) / 1_000_000 * stableUsd;
  if (!Number.isFinite(guaranteedResidualProfitUsd) || guaranteedResidualProfitUsd <= 0) return null;

  const planningOpportunity = {
    ...opportunity,
    expectedProfit: preBuilderProfit,
  };
  const plan = buildFlashLoanExecutionPlanFromOpportunity(planningOpportunity, {
    receiver: selection.receiver,
    provider: selection.kind === 'single' ? selection.provider : 'balancer_v2',
    profitRecipient: wallet.address,
    minProfitBaseUnits: minimumReceiverProfit,
    nowMs: Date.now(),
  });
  const payload = selection.kind === 'dual'
    ? buildDualFlashLoanReceiverPayload({
        chain: plan.chain,
        receiver: selection.receiver,
        loanToken: plan.loanToken,
        balancerAmount: selection.balancerAmount.toString(),
        aaveAmount: selection.aaveAmount.toString(),
        minProfit: plan.minProfit,
        profitRecipient: plan.profitRecipient,
        steps: plan.steps,
        gasLimit: FLASH_GAS_DUAL,
      })
    : buildFlashLoanReceiverPayloadFromPlan({ ...plan, gasLimit: FLASH_GAS_SINGLE });

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
      gasLimit: BigNumber.from(selection.kind === 'dual' ? FLASH_GAS_DUAL : FLASH_GAS_SINGLE),
    },
    {
      ...common,
      nonce: nonce + 1,
      to: opportunity.inputToken,
      data: ERC20_INTERFACE.encodeFunctionData('approve', [SUSHISWAP_V2_ROUTER, amountInMax]),
      value: BigNumber.from(0),
      gasLimit: BigNumber.from(APPROVAL_GAS),
    },
    {
      ...common,
      nonce: nonce + 2,
      to: SUSHISWAP_V2_ROUTER,
      data: ROUTER_INTERFACE.encodeFunctionData('swapTokensForExactETH', [
        BigNumber.from(builderPaymentWei.toString()),
        amountInMax,
        [opportunity.inputToken, WETH],
        wallet.address,
        deadline,
      ]),
      value: BigNumber.from(0),
      gasLimit: BigNumber.from(CONVERSION_GAS),
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
      gasLimit: BigNumber.from(PAYMENT_GAS),
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

  const admittedNetProfitBps = opportunity.flashLoanAmount > 0n
    ? Number((guaranteedNetProfitInInputToken * 10_000n) / opportunity.flashLoanAmount)
    : Number.NEGATIVE_INFINITY;
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
      'builder_sponsorship:opportunity_specific',
      'builder_payment_source:execution_created_value',
      'builder_payment_transport:titan_or_quasar',
      'builder_repayment_conversion:sushiswap_v2_exact_eth',
      'builder_repayment_quote:getAmountsIn',
      'builder_gas_cost_attribution:stablecoin_input_max',
      'gas_fee_ceiling:eip1559_base_fee_x2_plus_priority',
      'generic_gas_authority_not_overridden',
      'operator_native_gas_input:false',
      'strict_positive_all_in_residual',
      'synthetic_evidence:false',
    ],
  };
  builderSponsoredZeroCapitalRegistry.record(evidence);
  logger.info('[ZeroCapitalBuilderColdStart] Exact builder-funded cold-start candidate prepared', {
    component: 'BuilderSponsoredZeroCapitalColdStart',
    opportunityId: opportunity.id,
    builders: candidates.map(candidate => candidate.builder),
    targetBlock,
    builderGasCostInInputToken: builderGasCostInInputToken.toString(),
    guaranteedNetProfitInInputToken: guaranteedNetProfitInInputToken.toString(),
    guaranteedResidualProfitUsd,
    requiredSponsorshipWei: requiredSponsorshipWei.toString(),
    builderPaymentWei: builderPaymentWei.toString(),
    operatorNativeGasInputRequired: false,
    chainWideFundingAuthorityChanged: false,
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
    if (!executionTransactionHash) {
      return null;
    }
    if (result.status === 'confirmed') {
      return { evidence, candidate, result, executionTransactionHash };
    }
    if (result.status === 'ambiguous') {
      return { evidence, candidate, result, executionTransactionHash };
    }
  }
  return null;
}
