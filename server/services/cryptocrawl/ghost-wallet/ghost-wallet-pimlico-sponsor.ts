import { BigNumber, Contract, Wallet, ethers, type providers } from 'ethers';
import type { GhostWalletChain } from './ghost-wallet-provider-mesh.js';

const ENTRY_POINT_V08 = '0x4337084d9e255ff0702461cf8895ce9e3b5ff108';
const SIMPLE_7702_ACCOUNT = '0xe6Cae83BdE06E4c305530e199D7217f42808555B';
const EIP7702_MARKER = '0x7702';
const EIP7702_DELEGATION_PREFIX = '0xef0100';
const RPC_TIMEOUT_MS = 12_000;
const STUB_SIGNATURE = '0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c';
const SIMPLE_7702_INTERFACE = new ethers.utils.Interface([
  'function execute(address target,uint256 value,bytes data)',
]);
const ENTRY_POINT_ABI = ['function getNonce(address sender,uint192 key) view returns (uint256)'];
const PACKED_USER_OPERATION_TYPES = {
  PackedUserOperation: [
    { name: 'sender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'initCode', type: 'bytes' },
    { name: 'callData', type: 'bytes' },
    { name: 'accountGasLimits', type: 'bytes32' },
    { name: 'preVerificationGas', type: 'uint256' },
    { name: 'gasFees', type: 'bytes32' },
    { name: 'paymasterAndData', type: 'bytes' },
  ],
};

const PIMLICO_7702_CHAIN_IDS: Partial<Record<GhostWalletChain, number>> = {
  ethereum: 1,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  bsc: 56,
  // Pimlico supports Avalanche ERC-4337, but its current production capability
  // matrix does not advertise EIP-7702 there. Keep that incompatibility local.
};

type RpcUserOperation = Record<string, unknown> & {
  sender: string;
  nonce: string;
  factory: string;
  factoryData: string;
  callData: string;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  paymaster: string;
  paymasterVerificationGasLimit: string;
  paymasterPostOpGasLimit: string;
  paymasterData: string;
  signature: string;
  eip7702Auth?: Record<string, string>;
};

export interface GhostWalletPimlicoPreparedSubmission {
  chain: GhostWalletChain;
  chainId: number;
  userOperationHash: string;
  userOperation: RpcUserOperation;
  entryPoint: string;
  implementation: string;
  authorizationIncluded: boolean;
  estimatedGasUnits: bigint;
  billableGasUnitsWithSurcharge: bigint;
  maxFeePerGasWei: bigint;
  maxPriorityFeePerGasWei: bigint;
  surchargeBps: number;
}

export interface GhostWalletPimlicoReceipt {
  userOperationHash: string;
  transactionHash: string;
  success: boolean;
  actualGasCostWei: bigint | null;
  actualGasUsed: bigint | null;
}

function apiKey(): string {
  return process.env.GHOST_WALLET_PIMLICO_API_KEY?.trim() || '';
}

function endpoint(chainId: number): string {
  const key = apiKey();
  if (!key) throw new Error('GHOST_WALLET_PIMLICO_API_KEY_UNAVAILABLE');
  return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${encodeURIComponent(key)}`;
}

function quantity(value: ethers.BigNumberish): string {
  return ethers.utils.hexValue(BigNumber.from(value));
}

function positiveQuantity(value: unknown, label: string): bigint {
  const raw = String(value ?? '').trim();
  if (!/^0x[0-9a-fA-F]+$/.test(raw)) throw new Error(`${label}_INVALID`);
  const parsed = BigInt(raw);
  if (parsed <= 0n) throw new Error(`${label}_INVALID`);
  return parsed;
}

function optionalQuantity(value: unknown): bigint | null {
  const raw = String(value ?? '').trim();
  if (!/^0x[0-9a-fA-F]+$/.test(raw)) return null;
  return BigInt(raw);
}

function padUint128(value: ethers.BigNumberish, label: string): string {
  const number = BigNumber.from(value);
  if (number.lt(0) || number.gte(BigNumber.from(2).pow(128))) throw new Error(`${label}_UINT128_OVERFLOW`);
  return ethers.utils.hexZeroPad(number.toHexString(), 16);
}

function rlpInteger(value: ethers.BigNumberish): string {
  const number = BigNumber.from(value);
  if (number.isZero()) return '0x';
  return ethers.utils.hexStripZeros(number.toHexString());
}

function surchargeBps(): number {
  const parsed = Number(process.env.GHOST_WALLET_PIMLICO_SURCHARGE_BPS || '1000');
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 5_000 ? parsed : 1_000;
}

async function rpc<T>(chainId: number, method: string, params: unknown[]): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetch(endpoint(chainId), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: any = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { /* normalized below */ }
    if (!response.ok) throw new Error(`GHOST_WALLET_PIMLICO_HTTP_${response.status}`);
    if (parsed?.error) {
      const code = Number.isFinite(Number(parsed.error.code)) ? Number(parsed.error.code) : 'UNKNOWN';
      const message = String(parsed.error.message || 'rpc_error').replace(/apikey=[^&\s]+/gi, 'apikey=REDACTED').slice(0, 400);
      throw new Error(`GHOST_WALLET_PIMLICO_RPC_${code}:${message}`);
    }
    if (!Object.prototype.hasOwnProperty.call(parsed, 'result')) throw new Error('GHOST_WALLET_PIMLICO_RPC_RESULT_MISSING');
    return parsed.result as T;
  } finally {
    clearTimeout(timer);
  }
}

function delegationTarget(code: string): string | null {
  const normalized = String(code || '').toLowerCase();
  if (!normalized.startsWith(EIP7702_DELEGATION_PREFIX) || normalized.length !== 48) return null;
  const candidate = `0x${normalized.slice(EIP7702_DELEGATION_PREFIX.length)}`;
  return ethers.utils.isAddress(candidate) ? ethers.utils.getAddress(candidate) : null;
}

function signAuthorization(wallet: Wallet, chainId: number, nonce: ethers.BigNumberish): Record<string, string> {
  const payload = ethers.utils.RLP.encode([
    rlpInteger(chainId),
    SIMPLE_7702_ACCOUNT,
    rlpInteger(nonce),
  ]);
  const digest = ethers.utils.keccak256(ethers.utils.hexConcat(['0x05', payload]));
  const signature = wallet._signingKey().signDigest(digest);
  const parity = signature.recoveryParam === 1 ? '0x01' : '0x00';
  return {
    chainId: quantity(chainId),
    address: SIMPLE_7702_ACCOUNT,
    nonce: quantity(nonce),
    yParity: parity,
    r: ethers.utils.hexZeroPad(signature.r, 32),
    s: ethers.utils.hexZeroPad(signature.s, 32),
  };
}

function packedPaymasterAndData(userOperation: RpcUserOperation): string {
  if (!ethers.utils.isAddress(userOperation.paymaster)) return '0x';
  return ethers.utils.hexConcat([
    userOperation.paymaster,
    padUint128(userOperation.paymasterVerificationGasLimit, 'GHOST_WALLET_PIMLICO_PAYMASTER_VERIFICATION_GAS'),
    padUint128(userOperation.paymasterPostOpGasLimit, 'GHOST_WALLET_PIMLICO_PAYMASTER_POSTOP_GAS'),
    userOperation.paymasterData || '0x',
  ]);
}

function userOperationTypedData(userOperation: RpcUserOperation, chainId: number) {
  return {
    domain: {
      name: 'ERC4337',
      version: '1',
      chainId,
      verifyingContract: ENTRY_POINT_V08,
    },
    types: PACKED_USER_OPERATION_TYPES,
    message: {
      sender: userOperation.sender,
      nonce: BigNumber.from(userOperation.nonce),
      // ERC-4337 v0.8 hashes the actual delegation target, not the 0x7702 marker.
      initCode: ethers.utils.hexConcat([SIMPLE_7702_ACCOUNT, userOperation.factoryData || '0x']),
      callData: userOperation.callData,
      accountGasLimits: ethers.utils.hexConcat([
        padUint128(userOperation.verificationGasLimit, 'GHOST_WALLET_PIMLICO_VERIFICATION_GAS'),
        padUint128(userOperation.callGasLimit, 'GHOST_WALLET_PIMLICO_CALL_GAS'),
      ]),
      preVerificationGas: BigNumber.from(userOperation.preVerificationGas),
      gasFees: ethers.utils.hexConcat([
        padUint128(userOperation.maxPriorityFeePerGas, 'GHOST_WALLET_PIMLICO_PRIORITY_FEE'),
        padUint128(userOperation.maxFeePerGas, 'GHOST_WALLET_PIMLICO_MAX_FEE'),
      ]),
      paymasterAndData: packedPaymasterAndData(userOperation),
    },
  };
}

function userOperationHash(userOperation: RpcUserOperation, chainId: number): string {
  const typed = userOperationTypedData(userOperation, chainId);
  return ethers.utils._TypedDataEncoder.hash(typed.domain, typed.types, typed.message);
}

async function signUserOperation(wallet: Wallet, userOperation: RpcUserOperation, chainId: number): Promise<string> {
  const typed = userOperationTypedData(userOperation, chainId);
  return wallet._signTypedData(typed.domain, typed.types, typed.message);
}

function parseGasPrice(result: any): { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } {
  const tier = result?.fast || result?.standard || result?.slow;
  if (!tier) throw new Error('GHOST_WALLET_PIMLICO_GAS_PRICE_UNAVAILABLE');
  return {
    maxFeePerGas: positiveQuantity(tier.maxFeePerGas, 'GHOST_WALLET_PIMLICO_MAX_FEE'),
    maxPriorityFeePerGas: positiveQuantity(tier.maxPriorityFeePerGas, 'GHOST_WALLET_PIMLICO_PRIORITY_FEE'),
  };
}

function mergeSponsoredOperation(base: Record<string, unknown>, sponsored: any): RpcUserOperation {
  const paymaster = String(sponsored?.paymaster || '').trim();
  const paymasterData = String(sponsored?.paymasterData || '0x').trim();
  if (!ethers.utils.isAddress(paymaster)) throw new Error('GHOST_WALLET_PIMLICO_PAYMASTER_INVALID');
  if (!ethers.utils.isHexString(paymasterData)) throw new Error('GHOST_WALLET_PIMLICO_PAYMASTER_DATA_INVALID');
  const merged: RpcUserOperation = {
    ...(base as RpcUserOperation),
    callGasLimit: quantity(positiveQuantity(sponsored.callGasLimit, 'GHOST_WALLET_PIMLICO_CALL_GAS')),
    verificationGasLimit: quantity(positiveQuantity(sponsored.verificationGasLimit, 'GHOST_WALLET_PIMLICO_VERIFICATION_GAS')),
    preVerificationGas: quantity(positiveQuantity(sponsored.preVerificationGas, 'GHOST_WALLET_PIMLICO_PREVERIFICATION_GAS')),
    paymaster: ethers.utils.getAddress(paymaster),
    paymasterVerificationGasLimit: quantity(positiveQuantity(sponsored.paymasterVerificationGasLimit, 'GHOST_WALLET_PIMLICO_PAYMASTER_VERIFICATION_GAS')),
    paymasterPostOpGasLimit: quantity(positiveQuantity(sponsored.paymasterPostOpGasLimit, 'GHOST_WALLET_PIMLICO_PAYMASTER_POSTOP_GAS')),
    paymasterData,
    signature: STUB_SIGNATURE,
  };
  return merged;
}

export function isGhostWalletPimlicoConfigured(): boolean {
  return apiKey().length > 0;
}

export function isGhostWalletPimlicoEip7702Supported(chain: GhostWalletChain): boolean {
  return Boolean(PIMLICO_7702_CHAIN_IDS[chain]);
}

export function getGhostWalletPimlicoSupportedChains(): GhostWalletChain[] {
  return Object.keys(PIMLICO_7702_CHAIN_IDS) as GhostWalletChain[];
}

export async function prepareGhostWalletPimlicoSponsoredTransaction(input: {
  chain: GhostWalletChain;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  transaction: { to: string; data: string; value: string };
}): Promise<GhostWalletPimlicoPreparedSubmission> {
  const expectedChainId = PIMLICO_7702_CHAIN_IDS[input.chain];
  if (!expectedChainId) throw new Error(`GHOST_WALLET_PIMLICO_EIP7702_UNSUPPORTED:${input.chain}`);
  if (!isGhostWalletPimlicoConfigured()) throw new Error('GHOST_WALLET_PIMLICO_API_KEY_UNAVAILABLE');
  if (!ethers.utils.isAddress(input.transaction.to) || !ethers.utils.isHexString(input.transaction.data)) {
    throw new Error('GHOST_WALLET_PIMLICO_TRANSACTION_INVALID');
  }

  const network = await input.provider.getNetwork();
  if (network.chainId !== expectedChainId) throw new Error('GHOST_WALLET_PIMLICO_CHAIN_ID_MISMATCH');
  const [entryPointCode, implementationCode, senderCode, authorizationNonce] = await Promise.all([
    input.provider.getCode(ENTRY_POINT_V08),
    input.provider.getCode(SIMPLE_7702_ACCOUNT),
    input.provider.getCode(input.wallet.address),
    input.provider.getTransactionCount(input.wallet.address, 'pending'),
  ]);
  if (entryPointCode === '0x') throw new Error('GHOST_WALLET_PIMLICO_ENTRYPOINT_NOT_DEPLOYED');
  if (implementationCode === '0x') throw new Error('GHOST_WALLET_PIMLICO_7702_IMPLEMENTATION_NOT_DEPLOYED');

  let authorization: Record<string, string> | undefined;
  if (senderCode === '0x') {
    authorization = signAuthorization(input.wallet, network.chainId, authorizationNonce);
  } else {
    const delegate = delegationTarget(senderCode);
    if (!delegate || delegate.toLowerCase() !== SIMPLE_7702_ACCOUNT.toLowerCase()) {
      throw new Error('GHOST_WALLET_PIMLICO_EIP7702_DELEGATION_CONFLICT');
    }
  }

  const entryPoint = new Contract(ENTRY_POINT_V08, ENTRY_POINT_ABI, input.provider);
  const [nonceRaw, gasPriceRaw] = await Promise.all([
    entryPoint.getNonce(input.wallet.address, 0),
    rpc<any>(network.chainId, 'pimlico_getUserOperationGasPrice', []),
  ]);
  const gasPrice = parseGasPrice(gasPriceRaw);
  const callData = SIMPLE_7702_INTERFACE.encodeFunctionData('execute', [
    input.transaction.to,
    BigNumber.from(input.transaction.value || '0'),
    input.transaction.data,
  ]);
  const base: Record<string, unknown> = {
    sender: input.wallet.address,
    nonce: quantity(nonceRaw),
    factory: EIP7702_MARKER,
    factoryData: '0x',
    callData,
    maxFeePerGas: quantity(gasPrice.maxFeePerGas),
    maxPriorityFeePerGas: quantity(gasPrice.maxPriorityFeePerGas),
    signature: STUB_SIGNATURE,
    ...(authorization ? { eip7702Auth: authorization } : {}),
  };
  const policyId = process.env.GHOST_WALLET_PIMLICO_SPONSORSHIP_POLICY_ID?.trim();
  const sponsorParams: unknown[] = [base, ENTRY_POINT_V08];
  if (policyId) sponsorParams.push({ sponsorshipPolicyId: policyId });
  const sponsored = await rpc<any>(network.chainId, 'pm_sponsorUserOperation', sponsorParams);
  const userOperation = mergeSponsoredOperation(base, sponsored);
  userOperation.signature = await signUserOperation(input.wallet, userOperation, network.chainId);
  const hash = userOperationHash(userOperation, network.chainId);

  const estimatedGasUnits = [
    userOperation.callGasLimit,
    userOperation.verificationGasLimit,
    userOperation.preVerificationGas,
    userOperation.paymasterVerificationGasLimit,
    userOperation.paymasterPostOpGasLimit,
  ].reduce((sum, value) => sum + BigInt(value), 0n);
  const bps = surchargeBps();
  const billableGasUnitsWithSurcharge = (estimatedGasUnits * BigInt(10_000 + bps) + 9_999n) / 10_000n;

  return {
    chain: input.chain,
    chainId: network.chainId,
    userOperationHash: hash,
    userOperation,
    entryPoint: ENTRY_POINT_V08,
    implementation: SIMPLE_7702_ACCOUNT,
    authorizationIncluded: Boolean(authorization),
    estimatedGasUnits,
    billableGasUnitsWithSurcharge,
    maxFeePerGasWei: gasPrice.maxFeePerGas,
    maxPriorityFeePerGasWei: gasPrice.maxPriorityFeePerGas,
    surchargeBps: bps,
  };
}

export async function submitGhostWalletPimlicoSponsoredTransaction(
  prepared: Pick<GhostWalletPimlicoPreparedSubmission, 'chainId' | 'userOperationHash' | 'userOperation'>,
): Promise<string> {
  const returned = String(await rpc<string>(prepared.chainId, 'eth_sendUserOperation', [prepared.userOperation, ENTRY_POINT_V08]));
  if (!/^0x[a-fA-F0-9]{64}$/.test(returned)) throw new Error('GHOST_WALLET_PIMLICO_USER_OPERATION_HASH_INVALID');
  if (returned.toLowerCase() !== prepared.userOperationHash.toLowerCase()) {
    throw new Error('GHOST_WALLET_PIMLICO_USER_OPERATION_HASH_MISMATCH');
  }
  return returned;
}

export async function getGhostWalletPimlicoReceipt(chain: GhostWalletChain, userOperationHashValue: string): Promise<GhostWalletPimlicoReceipt | null> {
  const chainId = PIMLICO_7702_CHAIN_IDS[chain];
  if (!chainId) throw new Error(`GHOST_WALLET_PIMLICO_EIP7702_UNSUPPORTED:${chain}`);
  const result = await rpc<any>(chainId, 'eth_getUserOperationReceipt', [userOperationHashValue]);
  if (!result) return null;
  const transactionHash = String(result?.receipt?.transactionHash || '');
  if (!/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) throw new Error('GHOST_WALLET_PIMLICO_RECEIPT_TRANSACTION_HASH_INVALID');
  return {
    userOperationHash: String(result.userOpHash || userOperationHashValue),
    transactionHash,
    success: result.success === true || String(result?.receipt?.status || '').toLowerCase() === '0x1',
    actualGasCostWei: optionalQuantity(result.actualGasCost),
    actualGasUsed: optionalQuantity(result.actualGasUsed),
  };
}

export async function ensureGhostWalletPimlicoSubmission(input: {
  chain: GhostWalletChain;
  userOperationHash: string;
  userOperation: RpcUserOperation;
}): Promise<void> {
  const chainId = PIMLICO_7702_CHAIN_IDS[input.chain];
  if (!chainId) throw new Error(`GHOST_WALLET_PIMLICO_EIP7702_UNSUPPORTED:${input.chain}`);
  const receipt = await getGhostWalletPimlicoReceipt(input.chain, input.userOperationHash);
  if (receipt) return;
  const pending = await rpc<any>(chainId, 'eth_getUserOperationByHash', [input.userOperationHash]);
  if (pending) return;
  await submitGhostWalletPimlicoSponsoredTransaction({
    chainId,
    userOperationHash: input.userOperationHash,
    userOperation: input.userOperation,
  });
}

export const GHOST_WALLET_PIMLICO_POLICY = {
  purpose: 'first_transaction_native_gas_bootstrap_only',
  zeroCapitalDependency: false,
  operatorNativePrefundRequired: false,
  preservesControllerEoaAddress: true,
  entryPointVersion: '0.8',
  eip7702Implementation: SIMPLE_7702_ACCOUNT,
  supportedChains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc'] as const,
  unsupportedChainsFailLocally: ['avalanche'] as const,
  nativeGasPathPreferredWhenFunded: true,
  retainedProfitGasReserveRemainsTerminalAuthority: true,
  sponsorshipPolicyOptional: true,
  mainnetBillingSurchargeBpsDefault: 1_000,
  apiKeyEnvironmentVariable: 'GHOST_WALLET_PIMLICO_API_KEY',
  policyEnvironmentVariable: 'GHOST_WALLET_PIMLICO_SPONSORSHIP_POLICY_ID',
  authorizationYParityIsSingleByte: true,
  rawRpcAvoidsViemYParityFormattingRegression: true,
} as const;
