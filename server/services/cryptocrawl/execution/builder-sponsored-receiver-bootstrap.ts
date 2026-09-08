import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BigNumber, Contract, Wallet, ethers, providers } from 'ethers';
import logger from '../../../logger.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { isStrictlyPositiveProfitBaseUnits, minimumPositiveProfitBaseUnits } from '../governance/profit-admission-authority.js';
import { requireZeroCapitalInfrastructureDeploymentAllowed } from '../governance/zero-capital-infrastructure-policy.js';
import { buildFlashLoanExecutionPlanFromOpportunity } from './adapters/autonomous-route-planner.js';
import {
  BuilderSponsoredBundleAdapter,
  type BuilderSpecificSignedBundle,
} from './adapters/builder-sponsored-bundle.js';
import {
  calculateMeasuredFlashLoanFee,
  type FlashLoanProviderEconomics,
} from './adapters/flash-loan-provider-economics.js';
import { buildFlashLoanReceiverPayloadFromPlan } from './adapters/flashloan-receiver-builder.js';
import { buildSwapCallFromLeg } from './adapters/onchain-payload-builder.js';
import { resolveSponsoredReceiverVault } from './adapters/sponsored-receiver-manager.js';
import {
  builderSponsoredZeroCapitalRegistry,
  type BuilderSponsoredZeroCapitalEvidence,
} from './builder-sponsored-zero-capital-coldstart.js';

const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const CREATE2_DEPLOYER_CODE_HASH = '0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989';
const RECEIVER_SALT = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('bad-blue:cryptocrawl-balancer-receiver:v1'));
const ETHEREUM_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const ETHEREUM_USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const SUSHISWAP_V2_ROUTER = '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F';

const DEPLOYMENT_GAS = 1_500_000;
const PERMISSION_GAS = 100_000;
const FLASH_GAS = 1_400_000;
const APPROVAL_GAS = 100_000;
const CONVERSION_GAS = 300_000;
const PAYMENT_GAS = 21_000;

const RECEIVER_ADMIN_INTERFACE = new ethers.utils.Interface([
  'function setAllowedTarget(address target,bool allowed)',
  'function setAllowedApprovalToken(address token,bool allowed)',
]);
const ERC20_INTERFACE = new ethers.utils.Interface([
  'function approve(address spender,uint256 amount) returns (bool)',
]);
const ROUTER_INTERFACE = new ethers.utils.Interface([
  'function getAmountsIn(uint256 amountOut,address[] path) view returns (uint256[] amounts)',
  'function swapTokensForExactETH(uint256 amountOut,uint256 amountInMax,address[] path,address to,uint256 deadline) returns (uint256[] amounts)',
]);
const ROUTER_VIEW_ABI = ['function getAmountsIn(uint256 amountOut,address[] path) view returns (uint256[] amounts)'];

interface ReceiverArtifact {
  contractName: string;
  abi: unknown[];
  bytecode: string;
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  const value = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(min, Math.min(max, value));
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

async function loadReceiverArtifact(): Promise<ReceiverArtifact> {
  const path = resolve(process.cwd(), 'artifacts/cryptocrawl/CryptocrawlBalancerFlashLoanReceiver.json');
  const raw = await readFile(path, 'utf8');
  const artifact = JSON.parse(raw) as Partial<ReceiverArtifact>;
  if (artifact.contractName !== 'CryptocrawlBalancerFlashLoanReceiver') {
    throw new Error('Unexpected flash-loan receiver artifact');
  }
  if (!Array.isArray(artifact.abi) || typeof artifact.bytecode !== 'string' || !ethers.utils.isHexString(artifact.bytecode)) {
    throw new Error('Flash-loan receiver artifact is incomplete');
  }
  return artifact as ReceiverArtifact;
}

async function receiverIdentity(provider: providers.JsonRpcProvider, ownerRaw: string) {
  const network = await provider.getNetwork();
  if (network.chainId !== 1) throw new Error(`Builder receiver bootstrap requires Ethereum mainnet, got chainId=${network.chainId}`);
  const owner = ethers.utils.getAddress(ownerRaw);
  const vault = resolveSponsoredReceiverVault('ethereum');
  if (!vault) throw new Error('Ethereum Balancer vault is unavailable for receiver bootstrap');
  const artifact = await loadReceiverArtifact();
  const constructorArgs = ethers.utils.defaultAbiCoder.encode(['address', 'address'], [vault, owner]);
  const initCode = ethers.utils.hexConcat([artifact.bytecode, constructorArgs]);
  const receiver = ethers.utils.getCreate2Address(CREATE2_DEPLOYER, RECEIVER_SALT, ethers.utils.keccak256(initCode));
  const factoryCode = await provider.getCode(CREATE2_DEPLOYER);
  if (factoryCode === '0x') throw new Error('Verified Foundry CREATE2 deployer is missing on Ethereum');
  if (ethers.utils.keccak256(factoryCode).toLowerCase() !== CREATE2_DEPLOYER_CODE_HASH.toLowerCase()) {
    throw new Error('Ethereum CREATE2 deployer code hash does not match the reviewed Foundry implementation');
  }
  const currentReceiverCode = await provider.getCode(receiver);
  if (currentReceiverCode !== '0x') return null;
  const deploymentData = ethers.utils.hexConcat([RECEIVER_SALT, initCode]);
  await provider.call({ from: owner, to: CREATE2_DEPLOYER, data: deploymentData, value: 0 });
  return { owner, vault, receiver, deploymentData };
}

async function currentFeeCeiling(provider: providers.JsonRpcProvider): Promise<{
  maxFeePerGas: BigNumber;
  maxPriorityFeePerGas: BigNumber;
}> {
  const [feeData, latestBlock] = await Promise.all([provider.getFeeData(), provider.getBlock('latest')]);
  const baseFee = latestBlock.baseFeePerGas;
  if (!baseFee || baseFee.lte(0)) throw new Error('Ethereum base fee is unavailable for receiver-bootstrap sponsorship proof');
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
  const prices = await coinGeckoPriceClient.getLiveSymbolPrices([symbol]);
  const value = prices.get(symbol);
  if (!Number.isFinite(value) || Number(value) <= 0) throw new Error(`${symbol}/USD live price unavailable for receiver-bootstrap economics`);
  return Number(value);
}

function permissionCallsForPlan(receiver: string, plan: ReturnType<typeof buildFlashLoanExecutionPlanFromOpportunity>) {
  const targets = new Set<string>();
  const approvalTokens = new Set<string>();
  for (const step of plan.steps) {
    const built = buildSwapCallFromLeg(plan.chain, receiver, step);
    targets.add(ethers.utils.getAddress(built.target));
    approvalTokens.add(ethers.utils.getAddress(built.approvalToken));
  }
  return [
    ...[...targets].map(target => ({
      to: receiver,
      data: RECEIVER_ADMIN_INTERFACE.encodeFunctionData('setAllowedTarget', [target, true]),
      value: BigNumber.from(0),
    })),
    ...[...approvalTokens].map(token => ({
      to: receiver,
      data: RECEIVER_ADMIN_INTERFACE.encodeFunctionData('setAllowedApprovalToken', [token, true]),
      value: BigNumber.from(0),
    })),
  ];
}

/**
 * First-receiver cold start for Ethereum. The receiver deployment, its exact route
 * permissions, the profitable flash execution, stablecoin-to-ETH reimbursement,
 * and terminal builder payment are one nonce-contiguous private bundle. This
 * prepares evidence only; canonical scheduling/execution remains the sole submitter.
 */
export async function prepareBuilderSponsoredReceiverBootstrap(input: {
  opportunity: ZeroCapitalOpportunity;
  balancerEvidence: FlashLoanProviderEconomics;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
}): Promise<BuilderSponsoredZeroCapitalEvidence | null> {
  const { opportunity, balancerEvidence, provider, wallet } = input;
  if (opportunity.chain !== 'ethereum' || Date.now() >= opportunity.expiresAt) return null;
  if (!sameAddress(opportunity.inputToken, stableAddress(opportunity.inputAssetSymbol)) || opportunity.inputTokenDecimals !== 6) return null;
  if (balancerEvidence.provider !== 'balancer_v2' || !balancerEvidence.executableEvidenceComplete) return null;
  if (balancerEvidence.availableLiquidity === null || balancerEvidence.availableLiquidity < opportunity.flashLoanAmount) return null;
  const measuredFlashFee = calculateMeasuredFlashLoanFee(balancerEvidence, opportunity.flashLoanAmount);
  if (measuredFlashFee === null) return null;

  requireZeroCapitalInfrastructureDeploymentAllowed({ chain: 'ethereum', operation: 'receiver_deployment' });
  const identity = await receiverIdentity(provider, wallet.address);
  if (!identity) return null;

  const grossProfit = opportunity.grossProfit ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
  const relayFee = opportunity.relayFeeInInputToken || 0n;
  const preBuilderProfit = grossProfit - measuredFlashFee - relayFee;
  if (preBuilderProfit <= 0n) return null;

  const seedPlan = buildFlashLoanExecutionPlanFromOpportunity({ ...opportunity, expectedProfit: preBuilderProfit }, {
    receiver: identity.receiver,
    provider: 'balancer_v2',
    profitRecipient: wallet.address,
    minProfitBaseUnits: minimumPositiveProfitBaseUnits(),
    nowMs: Date.now(),
  });
  const permissionCalls = permissionCallsForPlan(identity.receiver, seedPlan);
  if (permissionCalls.length === 0) return null;

  const adapter = new BuilderSponsoredBundleAdapter(provider);
  const builders = adapter.listBuilders();
  if (builders.length === 0) return null;
  const fees = await currentFeeCeiling(provider);
  const totalGasUnits = DEPLOYMENT_GAS
    + (permissionCalls.length * PERMISSION_GAS)
    + FLASH_GAS + APPROVAL_GAS + CONVERSION_GAS + PAYMENT_GAS;
  const requiredSponsorshipWei = BigInt(totalGasUnits) * BigInt(fees.maxFeePerGas.toString());
  const minimumBuilderResidualWei = BigInt(process.env.ZERO_CAPITAL_BUILDER_MIN_RESIDUAL_WEI || '10000000000000');
  if (minimumBuilderResidualWei <= 0n) throw new Error('ZERO_CAPITAL_BUILDER_MIN_RESIDUAL_WEI must be positive');
  const builderPaymentWei = requiredSponsorshipWei + minimumBuilderResidualWei;

  const router = new Contract(SUSHISWAP_V2_ROUTER, ROUTER_VIEW_ABI, provider);
  const amounts = await router.getAmountsIn(BigNumber.from(builderPaymentWei.toString()), [opportunity.inputToken, WETH]) as BigNumber[];
  if (!Array.isArray(amounts) || amounts.length !== 2 || !amounts[0] || amounts[0].lte(0)) return null;
  const conversionSlippageBps = boundedInteger(process.env.ZERO_CAPITAL_BUILDER_CONVERSION_MAX_SLIPPAGE_BPS, 50, 1, 500);
  const builderGasCostInInputToken = ceilBps(BigInt(amounts[0].toString()), conversionSlippageBps);
  const minimumRetained = BigInt(process.env.ZERO_CAPITAL_BUILDER_MIN_RETAINED_PROFIT_BASE_UNITS || minimumPositiveProfitBaseUnits().toString());
  const minimumReceiverProfit = builderGasCostInInputToken + minimumRetained;
  if (minimumRetained <= 0n || preBuilderProfit < minimumReceiverProfit) return null;

  const allInCost = measuredFlashFee + relayFee + builderGasCostInInputToken;
  const guaranteedNetProfitInInputToken = grossProfit - allInCost;
  if (guaranteedNetProfitInInputToken <= 0n) return null;
  const stableUsd = await liveStableUsd(opportunity.inputAssetSymbol);
  const guaranteedResidualProfitUsd = Number(guaranteedNetProfitInInputToken) / 1_000_000 * stableUsd;
  if (!Number.isFinite(guaranteedResidualProfitUsd) || guaranteedResidualProfitUsd <= 0) return null;

  const plan = buildFlashLoanExecutionPlanFromOpportunity({ ...opportunity, expectedProfit: preBuilderProfit }, {
    receiver: identity.receiver,
    provider: 'balancer_v2',
    profitRecipient: wallet.address,
    minProfitBaseUnits: minimumReceiverProfit,
    nowMs: Date.now(),
  });
  const payload = buildFlashLoanReceiverPayloadFromPlan({ ...plan, gasLimit: FLASH_GAS });
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
  const prefixTransactions: providers.TransactionRequest[] = [];
  prefixTransactions.push({
    ...common,
    nonce,
    to: CREATE2_DEPLOYER,
    data: identity.deploymentData,
    value: BigNumber.from(0),
    gasLimit: BigNumber.from(DEPLOYMENT_GAS),
  });
  for (let index = 0; index < permissionCalls.length; index += 1) {
    const call = permissionCalls[index];
    prefixTransactions.push({
      ...common,
      nonce: nonce + 1 + index,
      to: call.to,
      data: call.data,
      value: call.value,
      gasLimit: BigNumber.from(PERMISSION_GAS),
    });
  }
  const executionTransactionIndex = prefixTransactions.length;
  prefixTransactions.push({
    ...common,
    nonce: nonce + prefixTransactions.length,
    to: payload.to,
    data: payload.data,
    value: BigNumber.from(payload.value),
    gasLimit: BigNumber.from(FLASH_GAS),
  });
  const amountInMax = BigNumber.from(builderGasCostInInputToken.toString());
  prefixTransactions.push({
    ...common,
    nonce: nonce + prefixTransactions.length,
    to: opportunity.inputToken,
    data: ERC20_INTERFACE.encodeFunctionData('approve', [SUSHISWAP_V2_ROUTER, amountInMax]),
    value: BigNumber.from(0),
    gasLimit: BigNumber.from(APPROVAL_GAS),
  });
  prefixTransactions.push({
    ...common,
    nonce: nonce + prefixTransactions.length,
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
  });

  const signedPrefix = await Promise.all(prefixTransactions.map(transaction => wallet.signTransaction(transaction)));
  const bundles: BuilderSpecificSignedBundle[] = [];
  for (const builder of builders) {
    const payment = await wallet.signTransaction({
      ...common,
      nonce: nonce + prefixTransactions.length,
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
  if (candidates.some(candidate => !candidate.transactionHashes[executionTransactionIndex])) return null;

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
    receiver: identity.receiver,
    providerLabel: 'balancer_v2',
    executionTransactionIndex,
    receiverBootstrap: {
      owner: identity.owner,
      vault: identity.vault,
      factory: CREATE2_DEPLOYER,
      deploymentTransactionIndex: 0,
      permissionTransactionCount: permissionCalls.length,
    },
    bootstrapProviderEconomics: {
      ...balancerEvidence,
      missingEvidence: [...balancerEvidence.missingEvidence],
      provenance: [...balancerEvidence.provenance],
    },
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
      'receiver_bootstrap:create2_deployment_in_same_atomic_bundle',
      'receiver_bootstrap:exact_route_permissions_in_same_atomic_bundle',
      'receiver_bootstrap:predicted_address_matches_reviewed_artifact',
      'receiver_bootstrap:create2_factory_code_hash_verified',
      'flash_provider:balancer_v2_measured_fee_liquidity',
      'builder_payment_source:execution_created_value',
      'builder_payment_transport:titan_or_quasar',
      'builder_repayment_conversion:sushiswap_v2_exact_eth',
      'builder_gas_cost_attribution:deployment_permissions_execution_repayment_upper_bound',
      'operator_native_gas_input:false',
      'strict_positive_all_in_residual',
      'canonical_execution_authority_unchanged',
      'synthetic_evidence:false',
    ],
  };
  builderSponsoredZeroCapitalRegistry.record(evidence);
  logger.info('[ZeroCapitalReceiverBootstrap] Exact builder-funded first-receiver candidate prepared', {
    component: 'BuilderSponsoredReceiverBootstrap',
    opportunityId: opportunity.id,
    receiver: identity.receiver,
    permissionTransactions: permissionCalls.length,
    executionTransactionIndex,
    builders: candidates.map(candidate => candidate.builder),
    targetBlock,
    guaranteedResidualProfitUsd,
    operatorNativeGasInputRequired: false,
    executionAuthority: false,
  });
  return evidence;
}
