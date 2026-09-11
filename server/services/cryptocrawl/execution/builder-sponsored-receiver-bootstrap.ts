import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BigNumber, Wallet, ethers, providers } from 'ethers';
import logger from '../../../logger.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import { livePriceMesh } from '../bridge/live-price-mesh.js';
import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { isStrictlyPositiveProfitBaseUnits, minimumPositiveProfitBaseUnits } from '../governance/profit-admission-authority.js';
import { requireZeroCapitalInfrastructureDeploymentAllowed } from '../governance/zero-capital-infrastructure-policy.js';
import { buildFlashLoanExecutionPlanFromOpportunity } from './adapters/autonomous-route-planner.js';
import {
  BuilderSponsoredBundleAdapter,
  type BuilderSpecificSignedBundle,
  type SponsoredBuilderName,
} from './adapters/builder-sponsored-bundle.js';
import { buildBuilderRepaymentSwapData, selectBuilderRepaymentRoute } from './adapters/builder-repayment-route.js';
import {
  calculateMeasuredFlashLoanFee,
  resolveAaveV3Pool,
  resolveMorphoBlue,
  type FlashLoanProviderEconomics,
  type FlashLoanProviderKind,
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
const ETHEREUM_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const ETHEREUM_USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const BPS_PRECISION = 1_000_000n;

const RECEIVER_ADMIN_INTERFACE = new ethers.utils.Interface([
  'function setAllowedTarget(address target,bool allowed)',
  'function setAllowedApprovalToken(address token,bool allowed)',
]);
const ERC20_INTERFACE = new ethers.utils.Interface([
  'function approve(address spender,uint256 amount) returns (bool)',
]);

interface ReceiverArtifact {
  contractName: string;
  abi: unknown[];
  bytecode: string;
}

interface ReceiverDescriptor {
  artifactPath: string;
  contractName: string;
  salt: string;
  infrastructure: () => string | null;
}

interface SequentialSimulationCall {
  from: string;
  to: string;
  data: string;
  value: BigNumber;
}

interface SequentialSimulationResult {
  gasUsed: bigint[];
  provider: string;
}

interface FinalBootstrapSizing {
  requiredSponsorshipWei: bigint;
  builderPaymentWei: bigint;
  repaymentRoute: NonNullable<Awaited<ReturnType<typeof selectBuilderRepaymentRoute>>>;
  builderGasCostInInputToken: bigint;
  minimumReceiverProfit: bigint;
  guaranteedNetProfitInInputToken: bigint;
  plan: ReturnType<typeof buildFlashLoanExecutionPlanFromOpportunity>;
  payload: ReturnType<typeof buildFlashLoanReceiverPayloadFromPlan>;
  gasLimits: BigNumber[];
  gasSimulationProvider: string;
}

const RECEIVER_DESCRIPTORS: Record<FlashLoanProviderKind, ReceiverDescriptor> = {
  balancer_v2: {
    artifactPath: 'artifacts/cryptocrawl/CryptocrawlBalancerFlashLoanReceiver.json',
    contractName: 'CryptocrawlBalancerFlashLoanReceiver',
    salt: ethers.utils.keccak256(ethers.utils.toUtf8Bytes('bad-blue:cryptocrawl-balancer-receiver:v1')),
    infrastructure: () => resolveSponsoredReceiverVault('ethereum'),
  },
  aave_v3: {
    artifactPath: 'artifacts/cryptocrawl/CryptocrawlAaveV3FlashLoanReceiver.json',
    contractName: 'CryptocrawlAaveV3FlashLoanReceiver',
    salt: ethers.utils.keccak256(ethers.utils.toUtf8Bytes('bad-blue:cryptocrawl-aave-v3-receiver:v1')),
    infrastructure: () => resolveAaveV3Pool('ethereum'),
  },
  morpho_blue: {
    artifactPath: 'artifacts/cryptocrawl/CryptocrawlMorphoFlashLoanReceiver.json',
    contractName: 'CryptocrawlMorphoFlashLoanReceiver',
    salt: ethers.utils.keccak256(ethers.utils.toUtf8Bytes('bad-blue:cryptocrawl-morpho-receiver:v1')),
    infrastructure: () => resolveMorphoBlue('ethereum'),
  },
};

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

function preciseBps(value: bigint, notional: bigint): number {
  if (notional <= 0n) return Number.NEGATIVE_INFINITY;
  return Number((value * 10_000n * BPS_PRECISION) / notional) / Number(BPS_PRECISION);
}

function maxBigNumber(left: BigNumber | null | undefined, right: BigNumber): BigNumber {
  if (!left) return right;
  return left.gte(right) ? left : right;
}

function rpcQuantity(value: BigNumber): string {
  return ethers.utils.hexValue(value);
}

function simulationSafetyBps(): bigint {
  return BigInt(boundedInteger(process.env.ZERO_CAPITAL_BUILDER_GAS_SAFETY_BPS, 12_000, 10_000, 20_000));
}

function bufferedGasLimit(gasUsed: bigint): BigNumber {
  if (gasUsed <= 0n) throw new Error('Sequential gas simulation returned zero gas for a bundle transaction');
  const safety = simulationSafetyBps();
  const buffered = (gasUsed * safety + 9_999n) / 10_000n;
  return BigNumber.from(buffered.toString());
}

function sumGasLimits(limits: readonly BigNumber[]): bigint {
  return limits.reduce((sum, value) => sum + BigInt(value.toString()), 0n);
}

function maxGasVectors(vectors: readonly bigint[][]): bigint[] {
  if (vectors.length === 0) throw new Error('No sequential gas simulation results were returned');
  const width = vectors[0].length;
  if (width === 0 || vectors.some(vector => vector.length !== width)) {
    throw new Error('Sequential gas simulation returned inconsistent transaction counts');
  }
  return Array.from({ length: width }, (_, index) => vectors.reduce(
    (maximum, vector) => vector[index] > maximum ? vector[index] : maximum,
    0n,
  ));
}

async function simulateSequentialGasOnProvider(
  provider: providers.JsonRpcProvider,
  calls: readonly SequentialSimulationCall[],
): Promise<bigint[]> {
  const response = await provider.send('eth_simulateV1', [{
    blockStateCalls: [{
      calls: calls.map(call => ({
        from: call.from,
        to: call.to,
        data: call.data,
        value: rpcQuantity(call.value),
      })),
    }],
    validation: false,
    traceTransfers: false,
    returnFullTransactions: false,
  }, 'latest']);
  if (!Array.isArray(response) || response.length === 0 || !Array.isArray(response[0]?.calls)) {
    throw new Error('eth_simulateV1 returned no call-level gas evidence');
  }
  const results = response[0].calls as Array<{ status?: string; gasUsed?: string; error?: { message?: string } }>;
  if (results.length !== calls.length) throw new Error('eth_simulateV1 returned an incomplete call sequence');
  return results.map((result, index) => {
    if (result.status !== '0x1') {
      throw new Error(`Sequential cold-start simulation call ${index} failed: ${result.error?.message || 'EVM failure'}`);
    }
    if (typeof result.gasUsed !== 'string' || !/^0x[0-9a-fA-F]+$/.test(result.gasUsed)) {
      throw new Error(`Sequential cold-start simulation call ${index} omitted gasUsed`);
    }
    return BigInt(result.gasUsed);
  });
}

async function simulateSequentialGas(calls: readonly SequentialSimulationCall[]): Promise<SequentialSimulationResult> {
  const { result, provenance } = await multiProviderRpcManager.execute(
    'ethereum',
    'contract_calls',
    provider => simulateSequentialGasOnProvider(provider, calls),
  );
  return { gasUsed: result, provider: provenance.provider };
}

async function loadReceiverArtifact(providerKind: FlashLoanProviderKind): Promise<ReceiverArtifact> {
  const descriptor = RECEIVER_DESCRIPTORS[providerKind];
  const path = resolve(process.cwd(), descriptor.artifactPath);
  const raw = await readFile(path, 'utf8');
  const artifact = JSON.parse(raw) as Partial<ReceiverArtifact>;
  if (artifact.contractName !== descriptor.contractName) {
    throw new Error(`Unexpected ${providerKind} flash-loan receiver artifact`);
  }
  if (!Array.isArray(artifact.abi) || typeof artifact.bytecode !== 'string' || !ethers.utils.isHexString(artifact.bytecode) || artifact.bytecode === '0x') {
    throw new Error(`${providerKind} flash-loan receiver artifact is incomplete`);
  }
  return artifact as ReceiverArtifact;
}

async function receiverIdentity(
  provider: providers.JsonRpcProvider,
  ownerRaw: string,
  providerKind: FlashLoanProviderKind,
) {
  const network = await provider.getNetwork();
  if (network.chainId !== 1) throw new Error(`Builder receiver bootstrap requires Ethereum mainnet, got chainId=${network.chainId}`);
  const owner = ethers.utils.getAddress(ownerRaw);
  const descriptor = RECEIVER_DESCRIPTORS[providerKind];
  const infrastructureRaw = descriptor.infrastructure();
  if (!infrastructureRaw) throw new Error(`Ethereum ${providerKind} infrastructure is unavailable for receiver bootstrap`);
  const infrastructure = ethers.utils.getAddress(infrastructureRaw);
  const artifact = await loadReceiverArtifact(providerKind);
  const constructorArgs = ethers.utils.defaultAbiCoder.encode(['address', 'address'], [infrastructure, owner]);
  const initCode = ethers.utils.hexConcat([artifact.bytecode, constructorArgs]);
  const receiver = ethers.utils.getCreate2Address(CREATE2_DEPLOYER, descriptor.salt, ethers.utils.keccak256(initCode));
  const factoryCode = await provider.getCode(CREATE2_DEPLOYER);
  if (factoryCode === '0x') throw new Error('Verified Foundry CREATE2 deployer is missing on Ethereum');
  if (ethers.utils.keccak256(factoryCode).toLowerCase() !== CREATE2_DEPLOYER_CODE_HASH.toLowerCase()) {
    throw new Error('Ethereum CREATE2 deployer code hash does not match the reviewed Foundry implementation');
  }
  const currentReceiverCode = await provider.getCode(receiver);
  if (currentReceiverCode !== '0x') return null;
  const deploymentData = ethers.utils.hexConcat([descriptor.salt, initCode]);
  await provider.call({ from: owner, to: CREATE2_DEPLOYER, data: deploymentData, value: 0 });
  return { owner, infrastructure, receiver, deploymentData };
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
  const prices = await livePriceMesh.getLiveSymbolPrices([symbol]);
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

function bootstrapSimulationPrefix(input: {
  owner: string;
  deploymentData: string;
  permissionCalls: Array<{ to: string; data: string; value: BigNumber }>;
  payload: ReturnType<typeof buildFlashLoanReceiverPayloadFromPlan>;
}): SequentialSimulationCall[] {
  return [
    { from: input.owner, to: CREATE2_DEPLOYER, data: input.deploymentData, value: BigNumber.from(0) },
    ...input.permissionCalls.map(call => ({ from: input.owner, to: call.to, data: call.data, value: call.value })),
    { from: input.owner, to: input.payload.to, data: input.payload.data, value: BigNumber.from(input.payload.value) },
  ];
}

/**
 * Provider-aware first-receiver private bundle for Ethereum. Titan/Quasar prepend
 * the ETH needed for the nonce-contiguous EOA bundle; execution-created value
 * reimburses the sponsorship ceiling plus a positive builder residual. Balancer,
 * Aave V3, and Morpho remain alternatives: failure of one provider is local.
 */
export async function prepareBuilderSponsoredProviderReceiverBootstrap(input: {
  opportunity: ZeroCapitalOpportunity;
  providerEvidence: FlashLoanProviderEconomics;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
}): Promise<BuilderSponsoredZeroCapitalEvidence | null> {
  const { opportunity, providerEvidence, provider, wallet } = input;
  if (opportunity.chain !== 'ethereum' || Date.now() >= opportunity.expiresAt) return null;
  if (!sameAddress(opportunity.inputToken, stableAddress(opportunity.inputAssetSymbol)) || opportunity.inputTokenDecimals !== 6) return null;
  if (!providerEvidence.executableEvidenceComplete) return null;
  if (providerEvidence.availableLiquidity === null || providerEvidence.availableLiquidity < opportunity.flashLoanAmount) return null;
  const measuredFlashFee = calculateMeasuredFlashLoanFee(providerEvidence, opportunity.flashLoanAmount);
  if (measuredFlashFee === null) return null;

  requireZeroCapitalInfrastructureDeploymentAllowed({ chain: 'ethereum', operation: 'receiver_deployment' });
  const identity = await receiverIdentity(provider, wallet.address, providerEvidence.provider);
  if (!identity) return null;

  const grossProfit = opportunity.grossProfit ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
  const relayFee = opportunity.relayFeeInInputToken || 0n;
  const preBuilderProfit = grossProfit - measuredFlashFee - relayFee;
  if (preBuilderProfit <= 0n) return null;

  const seedPlan = buildFlashLoanExecutionPlanFromOpportunity({ ...opportunity, expectedProfit: preBuilderProfit }, {
    receiver: identity.receiver,
    provider: providerEvidence.provider,
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
  const minimumBuilderResidualWei = BigInt(process.env.ZERO_CAPITAL_BUILDER_MIN_RESIDUAL_WEI || '10000000000000');
  if (minimumBuilderResidualWei <= 0n) throw new Error('ZERO_CAPITAL_BUILDER_MIN_RESIDUAL_WEI must be positive');
  const minimumRetained = BigInt(process.env.ZERO_CAPITAL_BUILDER_MIN_RETAINED_PROFIT_BASE_UNITS || minimumPositiveProfitBaseUnits().toString());
  if (minimumRetained <= 0n) throw new Error('ZERO_CAPITAL_BUILDER_MIN_RETAINED_PROFIT_BASE_UNITS must be positive');

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

  // Seed sponsorship from the stateful deployment/permission/flash sequence only.
  // This is not admission economics. The exact approval/repayment/payment calls are
  // then added and re-simulated until the measured sponsorship upper bound is stable.
  const seedPayload = buildFlashLoanReceiverPayloadFromPlan(seedPlan);
  const seedSimulation = await simulateSequentialGas(bootstrapSimulationPrefix({
    owner: identity.owner,
    deploymentData: identity.deploymentData,
    permissionCalls,
    payload: seedPayload,
  }));
  let requiredSponsorshipWei = sumGasLimits(seedSimulation.gasUsed.map(bufferedGasLimit))
    * BigInt(fees.maxFeePerGas.toString());
  if (requiredSponsorshipWei <= 0n) return null;

  const conversionSlippageBps = boundedInteger(process.env.ZERO_CAPITAL_BUILDER_CONVERSION_MAX_SLIPPAGE_BPS, 50, 1, 500);
  const convergenceAttempts = boundedInteger(process.env.ZERO_CAPITAL_BUILDER_GAS_CONVERGENCE_ATTEMPTS, 4, 2, 6);
  let finalSizing: FinalBootstrapSizing | null = null;

  for (let attempt = 0; attempt < convergenceAttempts; attempt += 1) {
    const builderPaymentWei = requiredSponsorshipWei + minimumBuilderResidualWei;
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
    const allInCost = measuredFlashFee + relayFee + builderGasCostInInputToken;
    const guaranteedNetProfitInInputToken = grossProfit - allInCost;
    if (!isStrictlyPositiveProfitBaseUnits(guaranteedNetProfitInInputToken)) return null;

    const plan = buildFlashLoanExecutionPlanFromOpportunity({ ...opportunity, expectedProfit: preBuilderProfit }, {
      receiver: identity.receiver,
      provider: providerEvidence.provider,
      profitRecipient: wallet.address,
      minProfitBaseUnits: minimumReceiverProfit,
      nowMs: Date.now(),
    });
    const payload = buildFlashLoanReceiverPayloadFromPlan(plan);
    const amountInMax = BigNumber.from(builderGasCostInInputToken.toString());
    const commonCalls = [
      ...bootstrapSimulationPrefix({
        owner: identity.owner,
        deploymentData: identity.deploymentData,
        permissionCalls,
        payload,
      }),
      {
        from: identity.owner,
        to: opportunity.inputToken,
        data: ERC20_INTERFACE.encodeFunctionData('approve', [repaymentRoute.router, amountInMax]),
        value: BigNumber.from(0),
      },
      {
        from: identity.owner,
        to: repaymentRoute.router,
        data: buildBuilderRepaymentSwapData({
          route: repaymentRoute,
          amountOutWei: builderPaymentWei,
          recipient: wallet.address,
          deadline,
        }),
        value: BigNumber.from(0),
      },
    ];

    const simulatedByBuilder = await Promise.all(builders.map(async builder => {
      const simulation = await simulateSequentialGas([
        ...commonCalls,
        {
          from: identity.owner,
          to: adapter.getBuilderCoinbase(builder),
          data: '0x',
          value: BigNumber.from(builderPaymentWei.toString()),
        },
      ]);
      return simulation;
    }));
    const maximumGasUsed = maxGasVectors(simulatedByBuilder.map(simulation => simulation.gasUsed));
    const gasLimits = maximumGasUsed.map(bufferedGasLimit);
    const measuredSponsorshipWei = sumGasLimits(gasLimits) * BigInt(fees.maxFeePerGas.toString());
    if (measuredSponsorshipWei <= 0n) return null;

    if (measuredSponsorshipWei <= requiredSponsorshipWei) {
      finalSizing = {
        requiredSponsorshipWei,
        builderPaymentWei,
        repaymentRoute,
        builderGasCostInInputToken,
        minimumReceiverProfit,
        guaranteedNetProfitInInputToken,
        plan,
        payload,
        gasLimits,
        gasSimulationProvider: [...new Set(simulatedByBuilder.map(simulation => simulation.provider))].join(','),
      };
      break;
    }
    requiredSponsorshipWei = measuredSponsorshipWei;
  }

  if (!finalSizing) {
    logger.debug('[ZeroCapitalReceiverBootstrap] Dynamic gas sizing did not converge inside bounded attempts', {
      component: 'BuilderSponsoredReceiverBootstrap',
      opportunityId: opportunity.id,
      flashProvider: providerEvidence.provider,
      convergenceAttempts,
      routeLocalFailure: true,
      executionAuthority: false,
    });
    return null;
  }

  const {
    builderPaymentWei,
    repaymentRoute,
    builderGasCostInInputToken,
    guaranteedNetProfitInInputToken,
    payload,
    gasLimits,
    gasSimulationProvider,
  } = finalSizing;
  requiredSponsorshipWei = finalSizing.requiredSponsorshipWei;
  const guaranteedResidualProfitUsd = Number(guaranteedNetProfitInInputToken) / 1_000_000 * await liveStableUsd(opportunity.inputAssetSymbol);
  if (!Number.isFinite(guaranteedResidualProfitUsd) || guaranteedResidualProfitUsd <= 0) return null;

  const common = {
    chainId: 1,
    type: 2,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  } as const;
  let gasIndex = 0;
  const prefixTransactions: providers.TransactionRequest[] = [];
  prefixTransactions.push({
    ...common,
    nonce,
    to: CREATE2_DEPLOYER,
    data: identity.deploymentData,
    value: BigNumber.from(0),
    gasLimit: gasLimits[gasIndex++],
  });
  for (let index = 0; index < permissionCalls.length; index += 1) {
    const call = permissionCalls[index];
    prefixTransactions.push({
      ...common,
      nonce: nonce + 1 + index,
      to: call.to,
      data: call.data,
      value: call.value,
      gasLimit: gasLimits[gasIndex++],
    });
  }
  const executionTransactionIndex = prefixTransactions.length;
  prefixTransactions.push({
    ...common,
    nonce: nonce + prefixTransactions.length,
    to: payload.to,
    data: payload.data,
    value: BigNumber.from(payload.value),
    gasLimit: gasLimits[gasIndex++],
  });
  const amountInMax = BigNumber.from(builderGasCostInInputToken.toString());
  prefixTransactions.push({
    ...common,
    nonce: nonce + prefixTransactions.length,
    to: opportunity.inputToken,
    data: ERC20_INTERFACE.encodeFunctionData('approve', [repaymentRoute.router, amountInMax]),
    value: BigNumber.from(0),
    gasLimit: gasLimits[gasIndex++],
  });
  prefixTransactions.push({
    ...common,
    nonce: nonce + prefixTransactions.length,
    to: repaymentRoute.router,
    data: buildBuilderRepaymentSwapData({
      route: repaymentRoute,
      amountOutWei: builderPaymentWei,
      recipient: wallet.address,
      deadline,
    }),
    value: BigNumber.from(0),
    gasLimit: gasLimits[gasIndex++],
  });
  const paymentGasLimit = gasLimits[gasIndex++];
  if (!paymentGasLimit || gasIndex !== gasLimits.length) throw new Error('Dynamic gas vector does not match cold-start transaction sequence');

  const signedPrefix = await Promise.all(prefixTransactions.map(transaction => wallet.signTransaction(transaction)));
  const bundles: BuilderSpecificSignedBundle[] = [];
  for (const builder of builders) {
    const payment = await wallet.signTransaction({
      ...common,
      nonce: nonce + prefixTransactions.length,
      to: adapter.getBuilderCoinbase(builder),
      value: BigNumber.from(builderPaymentWei.toString()),
      gasLimit: paymentGasLimit,
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

  const admittedNetProfitBps = preciseBps(guaranteedNetProfitInInputToken, opportunity.flashLoanAmount);
  if (!isStrictlyPositiveProfitBaseUnits(guaranteedNetProfitInInputToken)) return null;

  const evidence: BuilderSponsoredZeroCapitalEvidence = {
    opportunityId: opportunity.id,
    observedAt,
    expiresAt,
    targetBlock,
    inputToken: opportunity.inputToken,
    inputAssetSymbol: opportunity.inputAssetSymbol,
    receiver: identity.receiver,
    providerLabel: providerEvidence.provider,
    executionTransactionIndex,
    receiverBootstrap: {
      owner: identity.owner,
      // Legacy field name retained for serialized-evidence compatibility. For
      // Aave/Morpho this contains the provider infrastructure address rather than
      // a Balancer vault; providerLabel and provenance identify the binding.
      vault: identity.infrastructure,
      factory: CREATE2_DEPLOYER,
      deploymentTransactionIndex: 0,
      permissionTransactionCount: permissionCalls.length,
    },
    bootstrapProviderEconomics: {
      ...providerEvidence,
      missingEvidence: [...providerEvidence.missingEvidence],
      provenance: [...providerEvidence.provenance],
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
      'builder_private_bundle:opportunity_specific',
      'builder_native_prefund:titan_or_quasar_sponsored_bundle',
      'operator_native_gas_input_required:false',
      'builder_sponsorship_repaid_from_execution_created_value:true',
      'receiver_bootstrap:create2_deployment_in_same_atomic_bundle',
      'receiver_bootstrap:exact_route_permissions_in_same_atomic_bundle',
      'receiver_bootstrap:predicted_address_matches_reviewed_artifact',
      'receiver_bootstrap:create2_factory_code_hash_verified',
      `receiver_bootstrap:provider_${providerEvidence.provider}`,
      `flash_provider:${providerEvidence.provider}_measured_fee_liquidity`,
      'builder_payment_source:execution_created_value',
      'builder_payment_transport:titan_or_quasar',
      ...repaymentRoute.provenance,
      'builder_gas_measurement:eth_simulateV1_sequential_stateful',
      `builder_gas_measurement_provider:${gasSimulationProvider}`,
      `builder_gas_safety_bps:${simulationSafetyBps().toString()}`,
      'builder_all_in_cost_attribution:measured_buffered_bundle_gas_plus_repayment',
      'fixed_gas_ceiling_admission:false',
      'forced_future_native_reserve_seeding:false',
      'strict_positive_all_in_residual',
      'sub_bps_precision_preserved:true',
      'canonical_execution_authority_unchanged',
      'provider_failure_is_route_local:true',
      'synthetic_evidence:false',
    ],
  };
  builderSponsoredZeroCapitalRegistry.record(evidence);
  logger.info('[ZeroCapitalReceiverBootstrap] Exact provider-aware builder-sponsored zero-native-capital first-receiver candidate prepared', {
    component: 'BuilderSponsoredReceiverBootstrap',
    opportunityId: opportunity.id,
    flashProvider: providerEvidence.provider,
    receiver: identity.receiver,
    providerInfrastructure: identity.infrastructure,
    permissionTransactions: permissionCalls.length,
    executionTransactionIndex,
    builders: candidates.map(candidate => candidate.builder),
    targetBlock,
    builderRepaymentRoute: repaymentRoute.name,
    builderRepaymentRouter: repaymentRoute.router,
    guaranteedResidualProfitUsd,
    requiredSponsorshipWei: requiredSponsorshipWei.toString(),
    builderPaymentWei: builderPaymentWei.toString(),
    conversionOutputWei: builderPaymentWei.toString(),
    gasSimulationProvider,
    gasSafetyBps: simulationSafetyBps().toString(),
    measuredBufferedBundleGasUnits: sumGasLimits(gasLimits).toString(),
    operatorNativeGasInputRequired: false,
    systemOwnedNativeGasRequired: false,
    builderNativePrefundRequired: true,
    builderSponsorshipRepaidFromExecutionCreatedValue: true,
    senderGasReplenishmentIncludedInResidual: false,
    executionAuthority: false,
  });
  return evidence;
}

/** Backward-compatible Balancer entrypoint retained for existing callers/tests. */
export async function prepareBuilderSponsoredReceiverBootstrap(input: {
  opportunity: ZeroCapitalOpportunity;
  balancerEvidence: FlashLoanProviderEconomics;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
}): Promise<BuilderSponsoredZeroCapitalEvidence | null> {
  if (input.balancerEvidence.provider !== 'balancer_v2') return null;
  return prepareBuilderSponsoredProviderReceiverBootstrap({
    opportunity: input.opportunity,
    providerEvidence: input.balancerEvidence,
    provider: input.provider,
    wallet: input.wallet,
  });
}
