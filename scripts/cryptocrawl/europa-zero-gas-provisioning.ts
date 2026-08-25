import { BigNumber, Wallet, providers, utils } from 'ethers';
import { EUROPA_NETWORK } from '../../server/services/cryptocrawl/execution/adapters/europa-network.js';
import { EUROPA_SUSHI } from '../../server/services/cryptocrawl/execution/adapters/europa-sushi-registry.js';
import { resolveEuropaExternalGasDifficulty } from '../../server/services/cryptocrawl/execution/adapters/skale-pow-adapter.js';
import { Stage4PowComputeCoordinator, type Stage4ComputeSource } from '../../server/services/cryptocrawl/execution/adapters/stage4-pow-compute-coordinator.js';

export interface EuropaReceiverConfiguration {
  operators: string[];
  targets: string[];
  approvalTokens: string[];
}

export interface EuropaProvisioningTransaction {
  to?: string;
  data: string;
  value?: BigNumber | string | number;
  gasLimit?: BigNumber | string | number;
}

export interface EuropaProvisioningReceipt {
  transactionHash: string;
  nonce: number;
  receipt: providers.TransactionReceipt;
  gasLimit: string;
  gasPriceWei: string;
  computeSource: Stage4ComputeSource;
  zeroMonetaryGasVerified: true;
}

export function getEuropaSushiV3ReceiverConfiguration(): EuropaReceiverConfiguration {
  return {
    operators: [],
    targets: [utils.getAddress(EUROPA_SUSHI.routeProcessor)],
    approvalTokens: [
      utils.getAddress(EUROPA_SUSHI.tokens.usdc),
      utils.getAddress(EUROPA_SUSHI.tokens.skl),
      utils.getAddress(EUROPA_SUSHI.tokens.eth),
    ],
  };
}

function optionalAddress(label: string, value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!utils.isAddress(value)) throw new Error(`${label} must be a valid EVM address`);
  return utils.getAddress(value);
}

function requireHexData(value: string): string {
  const normalized = value.trim();
  if (!utils.isHexString(normalized)) throw new Error('Europa provisioning transaction data must be hex encoded');
  return normalized;
}

export async function sendEuropaZeroGasProvisioningTransaction(input: {
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  workloadId: string;
  transaction: EuropaProvisioningTransaction;
  confirmationTimeoutMs?: number;
}): Promise<EuropaProvisioningReceipt> {
  const network = await input.provider.getNetwork();
  if (network.chainId !== EUROPA_NETWORK.chainId) {
    throw new Error(`Europa provisioning requires chain ID ${EUROPA_NETWORK.chainId}, received ${network.chainId}`);
  }

  const signer = input.wallet.connect(input.provider);
  const sender = utils.getAddress(await signer.getAddress());
  const to = optionalAddress('Europa provisioning transaction target', input.transaction.to);
  const data = requireHexData(input.transaction.data);
  const value = BigNumber.from(input.transaction.value ?? 0);
  const nonce = await input.provider.getTransactionCount(sender, 'pending');
  const estimateRequest = {
    from: sender,
    ...(to ? { to } : {}),
    data,
    value,
  };
  const estimatedGas = await input.provider.estimateGas(estimateRequest);
  const gasLimit = input.transaction.gasLimit === undefined
    ? estimatedGas.mul(125).div(100)
    : BigNumber.from(input.transaction.gasLimit);
  if (estimatedGas.gt(gasLimit)) {
    throw new Error(`Europa provisioning estimate ${estimatedGas.toString()} exceeds bounded gas limit ${gasLimit.toString()}`);
  }
  if (gasLimit.gt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Europa provisioning gas limit exceeds the safe integer range');
  }

  const difficulty = (await resolveEuropaExternalGasDifficulty(input.provider)).difficulty;
  const compute = new Stage4PowComputeCoordinator(input.provider);
  const configuredWorkers = Number(process.env.ZERO_CAPITAL_EUROPA_POW_WORKERS || '');
  const confirmationTimeoutMs = Math.max(10_000, input.confirmationTimeoutMs || Number(process.env.ZERO_CAPITAL_EUROPA_PROVISIONING_TIMEOUT_MS || 120_000));
  const pow = await compute.findProof({
    workloadId: input.workloadId,
    sender,
    nonce,
    payload: {
      ...(to ? { to } : {}),
      data,
      value: value.toString(),
      gasLimit: gasLimit.toNumber(),
    },
    requiredGas: BigInt(estimatedGas.toString()),
    externalGasDifficulty: difficulty,
    maxAttempts: Math.max(1, Number(process.env.ZERO_CAPITAL_EUROPA_POW_MAX_ATTEMPTS || 250_000)),
  }, {
    workerCount: Number.isInteger(configuredWorkers) && configuredWorkers > 0 ? configuredWorkers : undefined,
    timeoutMs: confirmationTimeoutMs,
  });

  const nativeBefore = await input.provider.getBalance(sender);
  const signedTransaction = await signer.signTransaction({
    chainId: EUROPA_NETWORK.chainId,
    nonce,
    ...(to ? { to } : {}),
    data,
    value,
    gasLimit,
    gasPrice: BigNumber.from(pow.solution.gasPriceWei),
  });
  const expectedTransactionHash = utils.keccak256(signedTransaction);
  const submitted = await input.provider.sendTransaction(signedTransaction);
  if (submitted.hash.toLowerCase() !== expectedTransactionHash.toLowerCase()) {
    throw new Error(`Europa provisioning transaction hash mismatch: expected ${expectedTransactionHash}, received ${submitted.hash}`);
  }
  const receipt = await submitted.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error('Europa zero-gas provisioning transaction reverted');

  const nativeAfter = await input.provider.getBalance(sender);
  if (!nativeAfter.eq(nativeBefore)) {
    const delta = nativeBefore.gt(nativeAfter) ? nativeBefore.sub(nativeAfter) : nativeAfter.sub(nativeBefore);
    throw new Error(`Europa provisioning changed native balance by ${delta.toString()} wei; zero-monetary-gas proof failed`);
  }

  return {
    transactionHash: submitted.hash,
    nonce,
    receipt,
    gasLimit: gasLimit.toString(),
    gasPriceWei: pow.solution.gasPriceWei,
    computeSource: pow.source,
    zeroMonetaryGasVerified: true,
  };
}
