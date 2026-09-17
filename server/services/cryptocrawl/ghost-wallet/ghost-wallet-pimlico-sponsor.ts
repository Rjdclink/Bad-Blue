import { BigNumber, Contract, Wallet, ethers, type providers } from 'ethers';
import type { GhostWalletChain } from './ghost-wallet-provider-mesh.js';

const ENTRY_POINT_V08 = '0x4337084d9e255ff0702461cf8895ce9e3b5ff108';
const SIMPLE_7702_ACCOUNT = '0xe6Cae83BdE06E4c305530e199D7217f42808555B';
const EIP7702_MARKER = '0x7702';
const EIP7702_DELEGATION_PREFIX = '0xef0100';
const RPC_TIMEOUT_MS = 12_000;
const STATIC_CAPABILITY_TTL_MS = 5 * 60_000;
const GAS_PRICE_CACHE_MS = 750;
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
  // Pimlico supports ERC-4337 on Avalanche, but its current capability matrix
  // does not advertise EIP-7702 there. Keep that incompatibility route-local.
};

type PimlicoGasTier = 'slow' | 'standard' | 'fast';
export type GhostWalletPimlicoSubmissionMode = 'boosted' | 'standard';

export type GhostWalletPimlicoRpcUserOperation = Record<string, unknown> & {
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
  paymaster?: string;
  paymasterVerificationGasLimit?: string;
  paymasterPostOpGasLimit?: string;
  paymasterData?: string;
  signature: string;
  eip7702Auth?: Record<string, string>;
};

export interface GhostWalletPimlicoPreparedSubmission {
  chain: GhostWalletChain;
  chainId: number;
  submissionMode: GhostWalletPimlicoSubmissionMode;
  userOperationHash: string;
  userOperation: GhostWalletPimlicoRpcUserOperation;
  entryPoint: string;
  implementation: string;
  authorizationIncluded: boolean;
  estimatedGasUnits: bigint;
  billableGasUnitsWithSurcharge: bigint;
  billingFeePerGasWei: bigint;
  maxFeePerGasWei: bigint;
  maxPriorityFeePerGasWei: bigint;
  surchargeBps: number;
  gasTier: PimlicoGasTier;
}

export interface GhostWalletPimlicoReceipt {
  userOperationHash: string;
  transactionHash: string;
  success: boolean;
  actualGasCostWei: bigint | null;
  actualGasUsed: bigint | null;
}

export interface GhostWalletPimlicoProbeResult {
  chain: GhostWalletChain;
  chainId: number;
  entryPointSupported: boolean;
  gasPriceAvailable: boolean;
  boostedConfigured: boolean;
}

interface GasPriceQuote {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  tier: PimlicoGasTier;
}

const staticCapabilityCache = new Map<number, { expiresAt: number; promise: Promise<void> }>();
const gasPriceCache = new Map<number, { expiresAt: number; value: any }>();

function apiKey(): string {
  return process.env.GHOST_WALLET_PIMLICO_API_KEY?.trim() || '';
}

function endpoint(chainId: number): string {
  const key = apiKey();
  if (!key) throw new Error('GHOST_WALLET_PIMLICO_API_KEY_UNAVAILABLE');
  return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${encodeURIComponent(key)}`;
}

function configuredGasTier(): PimlicoGasTier {
  const value = String(process.env.GHOST_WALLET_PIMLICO_GAS_TIER || 'standard').trim().toLowerCase();
  return value === 'slow' || value === 'fast' ? value : 'standard';
}

function boostedEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env.GHOST_WALLET_PIMLICO_BOOSTED_ENABLED || ''));
}

function boostedRequired(): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env.GHOST_WALLET_PIMLICO_BOOSTED_REQUIRED || ''));
}

function quantity(value: ethers.BigNumberish): string {
  return ethers.utils.hexValue(BigNumber.from(value));
}

function parseQuantity(value: unknown, label: string, positive: boolean): bigint {
  const raw = String(value ?? '').trim();
  if (!/^0x[0-9a-fA-F]+$/.test(raw)) throw new Error(`${label}_INVALID`);
  const parsed = BigInt(raw);
  if (positive ? parsed <= 0n : parsed < 0n) throw new Error(`${label}_INVALID`);
  return parsed;
}

function positiveQuantity(value: unknown, label: string): bigint {
  return parseQuantity(value, label, true);
}

function nonNegativeQuantity(value: unknown, label: string): bigint {
  return parseQuantity(value, label, false);
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
      const message = String(parsed.error.message || 'rpc_error')
        .replace(/apikey=[^&\s]+/gi, 'apikey=REDACTED')
        .slice(0, 400);
      throw new Error(`GHOST_WALLET_PIMLICO_RPC_${code}:${message}`);
    }
    if (!Object.prototype.hasOwnProperty.call(parsed, 'result')) {
      throw new Error('GHOST_WALLET_PIMLICO_RPC_RESULT_MISSING');
    }
    return parsed.result as T;
  } finally {
    clearTimeout(timer);
  }
}

async function gasPriceRaw(chainId: number): Promise<any> {
  const cached = gasPriceCache.get(chainId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await rpc<any>(chainId, 'pimlico_getUserOperationGasPrice', []);
  gasPriceCache.set(chainId, { expiresAt: Date.now() + GAS_PRICE_CACHE_MS, value });
  return value;
}

function parseGasPrice(result: any, requestedTier = configuredGasTier()): GasPriceQuote {
  const order: PimlicoGasTier[] = requestedTier === 'fast'
    ? ['fast', 'standard', 'slow']
    : requestedTier === 'slow'
      ? ['slow', 'standard', 'fast']
      : ['standard', 'fast', 'slow'];
  for (const tier of order) {
    const value = result?.[tier];
    if (!value) continue;
    return {
      maxFeePerGas: positiveQuantity(value.maxFeePerGas, 'GHOST_WALLET_PIMLICO_MAX_FEE'),
      maxPriorityFeePerGas: positiveQuantity(value.maxPriorityFeePerGas, 'GHOST_WALLET_PIMLICO_PRIORITY_FEE'),
      tier,
    };
  }
  throw new Error('GHOST_WALLET_PIMLICO_GAS_PRICE_UNAVAILABLE');
}

function delegationTarget(code: string): string | null {
  const normalized = String(code || '').toLowerCase();
  if (!normalized.startsWith(EIP7702_DELEGATION_PREFIX) || normalized.length !== 48) return null;
  const candidate = `0x${normalized.slice(EIP7702_DELEGATION_PREFIX.length)}`;
  return ethers.utils.isAddress(candidate) ? ethers.utils.getAddress(candidate) : null;
}

function signAuthorization(wallet: Wallet, chainId: number, nonce: ethers.BigNumberish): Record<string, string> {
  const payload = ethers.utils.RLP.encode([rlpInteger(chainId), SIMPLE_7702_ACCOUNT, rlpInteger(nonce)]);
  const digest = ethers.utils.keccak256(ethers.utils.hexConcat(['0x05', payload]));
  const signature = wallet._signingKey().signDigest(digest);
  return {
    chainId: quantity(chainId),
    address: SIMPLE_7702_ACCOUNT,
    nonce: quantity(nonce),
    yParity: signature.recoveryParam === 1 ? '0x01' : '0x00',
    r: ethers.utils.hexZeroPad(signature.r, 32),
    s: ethers.utils.hexZeroPad(signature.s, 32),
  };
}

function packedPaymasterAndData(userOperation: GhostWalletPimlicoRpcUserOperation): string {
  if (!userOperation.paymaster || !ethers.utils.isAddress(userOperation.paymaster)) return '0x';
  return ethers.utils.hexConcat([
    userOperation.paymaster,
    padUint128(userOperation.paymasterVerificationGasLimit || '0x0', 'GHOST_WALLET_PIMLICO_PAYMASTER_VERIFICATION_GAS'),
    padUint128(userOperation.paymasterPostOpGasLimit || '0x0', 'GHOST_WALLET_PIMLICO_PAYMASTER_POSTOP_GAS'),
    userOperation.paymasterData || '0x',
  ]);
}

function userOperationTypedData(userOperation: GhostWalletPimlicoRpcUserOperation, chainId: number) {
  return {
    domain: { name: 'ERC4337', version: '1', chainId, verifyingContract: ENTRY_POINT_V08 },
    types: PACKED_USER_OPERATION_TYPES,
    message: {
      sender: userOperation.sender,
      nonce: BigNumber.from(userOperation.nonce),
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

function userOperationHash(userOperation: GhostWalletPimlicoRpcUserOperation, chainId: number): string {
  const typed = userOperationTypedData(userOperation, chainId);
  return ethers.utils._TypedDataEncoder.hash(typed.domain, typed.types, typed.message);
}

async function signUserOperation(wallet: Wallet, userOperation: GhostWalletPimlicoRpcUserOperation, chainId: number): Promise<string> {
  const typed = userOperationTypedData(userOperation, chainId);
  return wallet._signTypedData(typed.domain, typed.types, typed.message);
}

function mergeEstimatedOperation(base: Record<string, unknown>, estimate: any): GhostWalletPimlicoRpcUserOperation {
  return {
    ...base,
    callGasLimit: quantity(positiveQuantity(estimate?.callGasLimit, 'GHOST_WALLET_PIMLICO_CALL_GAS')),
    verificationGasLimit: quantity(positiveQuantity(estimate?.verificationGasLimit, 'GHOST_WALLET_PIMLICO_VERIFICATION_GAS')),
    preVerificationGas: quantity(positiveQuantity(estimate?.preVerificationGas, 'GHOST_WALLET_PIMLICO_PREVERIFICATION_GAS')),
  } as GhostWalletPimlicoRpcUserOperation;
}

function mergeSponsoredOperation(base: GhostWalletPimlicoRpcUserOperation, sponsored: any): GhostWalletPimlicoRpcUserOperation {
  const paymaster = String(sponsored?.paymaster || '').trim();
  const paymasterData = String(sponsored?.paymasterData || '0x').trim();
  if (!ethers.utils.isAddress(paymaster)) throw new Error('GHOST_WALLET_PIMLICO_PAYMASTER_INVALID');
  if (!ethers.utils.isHexString(paymasterData)) throw new Error('GHOST_WALLET_PIMLICO_PAYMASTER_DATA_INVALID');
  return {
    ...base,
    callGasLimit: quantity(positiveQuantity(sponsored?.callGasLimit ?? base.callGasLimit, 'GHOST_WALLET_PIMLICO_CALL_GAS')),
    verificationGasLimit: quantity(positiveQuantity(sponsored?.verificationGasLimit ?? base.verificationGasLimit, 'GHOST_WALLET_PIMLICO_VERIFICATION_GAS')),
    preVerificationGas: quantity(positiveQuantity(sponsored?.preVerificationGas ?? base.preVerificationGas, 'GHOST_WALLET_PIMLICO_PREVERIFICATION_GAS')),
    paymaster: ethers.utils.getAddress(paymaster),
    paymasterVerificationGasLimit: quantity(positiveQuantity(sponsored?.paymasterVerificationGasLimit, 'GHOST_WALLET_PIMLICO_PAYMASTER_VERIFICATION_GAS')),
    paymasterPostOpGasLimit: quantity(nonNegativeQuantity(sponsored?.paymasterPostOpGasLimit ?? '0x0', 'GHOST_WALLET_PIMLICO_PAYMASTER_POSTOP_GAS')),
    paymasterData,
    signature: STUB_SIGNATURE,
  };
}

async function ensureStaticCapabilities(provider: providers.JsonRpcProvider, chainId: number): Promise<void> {
  const cached = staticCapabilityCache.get(chainId);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = (async () => {
    const network = await provider.getNetwork();
    if (network.chainId !== chainId) throw new Error('GHOST_WALLET_PIMLICO_CHAIN_ID_MISMATCH');
    const [entryPointCode, implementationCode] = await Promise.all([
      provider.getCode(ENTRY_POINT_V08),
      provider.getCode(SIMPLE_7702_ACCOUNT),
    ]);
    if (entryPointCode === '0x') throw new Error('GHOST_WALLET_PIMLICO_ENTRYPOINT_NOT_DEPLOYED');
    if (implementationCode === '0x') throw new Error('GHOST_WALLET_PIMLICO_7702_IMPLEMENTATION_NOT_DEPLOYED');
  })();
  staticCapabilityCache.set(chainId, { expiresAt: Date.now() + STATIC_CAPABILITY_TTL_MS, promise });
  try {
    await promise;
  } catch (error) {
    staticCapabilityCache.delete(chainId);
    throw error;
  }
}

async function resolveAuthorization(
  provider: providers.JsonRpcProvider,
  wallet: Wallet,
  chainId: number,
): Promise<Record<string, string> | undefined> {
  const senderCode = await provider.getCode(wallet.address);
  if (senderCode !== '0x') {
    const delegate = delegationTarget(senderCode);
    if (!delegate || delegate.toLowerCase() !== SIMPLE_7702_ACCOUNT.toLowerCase()) {
      throw new Error('GHOST_WALLET_PIMLICO_EIP7702_DELEGATION_CONFLICT');
    }
    return undefined;
  }
  const authorizationNonce = await provider.getTransactionCount(wallet.address, 'pending');
  return signAuthorization(wallet, chainId, authorizationNonce);
}

function summedGasUnits(userOperation: GhostWalletPimlicoRpcUserOperation): bigint {
  return [
    userOperation.callGasLimit,
    userOperation.verificationGasLimit,
    userOperation.preVerificationGas,
    userOperation.paymasterVerificationGasLimit || '0x0',
    userOperation.paymasterPostOpGasLimit || '0x0',
  ].reduce((sum, value) => sum + BigInt(value), 0n);
}

async function finalizePrepared(input: {
  chain: GhostWalletChain;
  chainId: number;
  wallet: Wallet;
  userOperation: GhostWalletPimlicoRpcUserOperation;
  authorizationIncluded: boolean;
  gasPrice: GasPriceQuote;
  submissionMode: GhostWalletPimlicoSubmissionMode;
}): Promise<GhostWalletPimlicoPreparedSubmission> {
  input.userOperation.signature = await signUserOperation(input.wallet, input.userOperation, input.chainId);
  const hash = userOperationHash(input.userOperation, input.chainId);
  const estimatedGasUnits = summedGasUnits(input.userOperation);
  const bps = surchargeBps();
  const billableGasUnitsWithSurcharge = (estimatedGasUnits * BigInt(10_000 + bps) + 9_999n) / 10_000n;
  return {
    chain: input.chain,
    chainId: input.chainId,
    submissionMode: input.submissionMode,
    userOperationHash: hash,
    userOperation: input.userOperation,
    entryPoint: ENTRY_POINT_V08,
    implementation: SIMPLE_7702_ACCOUNT,
    authorizationIncluded: input.authorizationIncluded,
    estimatedGasUnits,
    billableGasUnitsWithSurcharge,
    billingFeePerGasWei: input.gasPrice.maxFeePerGas,
    maxFeePerGasWei: BigInt(input.userOperation.maxFeePerGas),
    maxPriorityFeePerGasWei: BigInt(input.userOperation.maxPriorityFeePerGas),
    surchargeBps: bps,
    gasTier: input.gasPrice.tier,
  };
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

export async function probeGhostWalletPimlicoChain(chain: GhostWalletChain): Promise<GhostWalletPimlicoProbeResult> {
  const chainId = PIMLICO_7702_CHAIN_IDS[chain];
  if (!chainId) throw new Error(`GHOST_WALLET_PIMLICO_EIP7702_UNSUPPORTED:${chain}`);
  if (!isGhostWalletPimlicoConfigured()) throw new Error('GHOST_WALLET_PIMLICO_API_KEY_UNAVAILABLE');
  const [entryPoints, gasPrice] = await Promise.all([
    rpc<string[]>(chainId, 'eth_supportedEntryPoints', []),
    gasPriceRaw(chainId),
  ]);
  const entryPointSupported = Array.isArray(entryPoints)
    && entryPoints.some(value => String(value).toLowerCase() === ENTRY_POINT_V08.toLowerCase());
  if (!entryPointSupported) throw new Error(`GHOST_WALLET_PIMLICO_ENTRYPOINT_V08_UNSUPPORTED:${chain}`);
  parseGasPrice(gasPrice);
  return { chain, chainId, entryPointSupported: true, gasPriceAvailable: true, boostedConfigured: boostedEnabled() };
}

export async function prepareGhostWalletPimlicoSponsoredTransaction(input: {
  chain: GhostWalletChain;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  transaction: { to: string; data: string; value: string };
}): Promise<GhostWalletPimlicoPreparedSubmission> {
  const chainId = PIMLICO_7702_CHAIN_IDS[input.chain];
  if (!chainId) throw new Error(`GHOST_WALLET_PIMLICO_EIP7702_UNSUPPORTED:${input.chain}`);
  if (!isGhostWalletPimlicoConfigured()) throw new Error('GHOST_WALLET_PIMLICO_API_KEY_UNAVAILABLE');
  if (!ethers.utils.isAddress(input.transaction.to) || !ethers.utils.isHexString(input.transaction.data)) {
    throw new Error('GHOST_WALLET_PIMLICO_TRANSACTION_INVALID');
  }

  await ensureStaticCapabilities(input.provider, chainId);
  const [authorization, nonceRaw, gasPriceResult] = await Promise.all([
    resolveAuthorization(input.provider, input.wallet, chainId),
    new Contract(ENTRY_POINT_V08, ENTRY_POINT_ABI, input.provider).getNonce(input.wallet.address, 0),
    gasPriceRaw(chainId),
  ]);
  const gasPrice = parseGasPrice(gasPriceResult);
  const callData = SIMPLE_7702_INTERFACE.encodeFunctionData('execute', [
    input.transaction.to,
    BigNumber.from(input.transaction.value || '0'),
    input.transaction.data,
  ]);

  const commonBase = {
    sender: input.wallet.address,
    nonce: quantity(nonceRaw),
    factory: EIP7702_MARKER,
    factoryData: '0x',
    callData,
    signature: STUB_SIGNATURE,
    ...(authorization ? { eip7702Auth: authorization } : {}),
  };

  if (boostedEnabled()) {
    try {
      const boostedBase = {
        ...commonBase,
        maxFeePerGas: '0x0',
        maxPriorityFeePerGas: '0x0',
      };
      const estimate = await rpc<any>(chainId, 'eth_estimateUserOperationGas', [boostedBase, ENTRY_POINT_V08]);
      const boosted = mergeEstimatedOperation(boostedBase, estimate);
      return await finalizePrepared({
        chain: input.chain,
        chainId,
        wallet: input.wallet,
        userOperation: boosted,
        authorizationIncluded: Boolean(authorization),
        gasPrice,
        submissionMode: 'boosted',
      });
    } catch (error) {
      if (boostedRequired()) throw error;
      // Same-provider fallback only. Ghost never falls back to native wallet gas.
    }
  }

  const base = {
    ...commonBase,
    maxFeePerGas: quantity(gasPrice.maxFeePerGas),
    maxPriorityFeePerGas: quantity(gasPrice.maxPriorityFeePerGas),
  };
  const initialEstimate = await rpc<any>(chainId, 'eth_estimateUserOperationGas', [base, ENTRY_POINT_V08]);
  const preparedBase = mergeEstimatedOperation(base, initialEstimate);
  const policyId = process.env.GHOST_WALLET_PIMLICO_SPONSORSHIP_POLICY_ID?.trim();
  const sponsorParams: unknown[] = [preparedBase, ENTRY_POINT_V08];
  if (policyId) sponsorParams.push({ sponsorshipPolicyId: policyId });
  const sponsored = await rpc<any>(chainId, 'pm_sponsorUserOperation', sponsorParams);
  const userOperation = mergeSponsoredOperation(preparedBase, sponsored);
  return finalizePrepared({
    chain: input.chain,
    chainId,
    wallet: input.wallet,
    userOperation,
    authorizationIncluded: Boolean(authorization),
    gasPrice,
    submissionMode: 'standard',
  });
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

export async function getGhostWalletPimlicoReceipt(
  chain: GhostWalletChain,
  userOperationHashValue: string,
): Promise<GhostWalletPimlicoReceipt | null> {
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
  userOperation: GhostWalletPimlicoRpcUserOperation;
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
  purpose: 'exclusive_ghost_wallet_transaction_gas_authority',
  requiredForGhostControllerTransactions: true,
  zeroCapitalDependency: false,
  operatorNativePrefundRequired: false,
  nativeGasFallbackAllowed: false,
  nativeBalanceAdmissionRequired: false,
  preservesControllerEoaAddress: true,
  entryPointVersion: '0.8',
  eip7702Implementation: SIMPLE_7702_ACCOUNT,
  supportedChains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc'] as const,
  unsupportedChainsFailLocally: ['avalanche'] as const,
  boostedFastPathOptional: true,
  boostedFallback: 'standard_pimlico_only',
  staticCapabilityCacheMs: STATIC_CAPABILITY_TTL_MS,
  gasPriceCacheMs: GAS_PRICE_CACHE_MS,
  mainnetBillingSurchargeBpsDefault: 1_000,
  billingSurchargeIncludedInCanonicalEconomics: true,
  sponsorshipPolicyOptional: true,
  apiKeyEnvironmentVariable: 'GHOST_WALLET_PIMLICO_API_KEY',
  policyEnvironmentVariable: 'GHOST_WALLET_PIMLICO_SPONSORSHIP_POLICY_ID',
  boostedEnvironmentVariable: 'GHOST_WALLET_PIMLICO_BOOSTED_ENABLED',
  authorizationYParityIsSingleByte: true,
  signedUserOperationPersistBeforeSubmissionRequired: true,
} as const;
