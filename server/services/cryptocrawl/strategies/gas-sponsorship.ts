import { BigNumber, Contract, Wallet, ethers, type providers } from 'ethers';

const ENTRY_POINT_V08 = '0x4337084d9e255ff0702461cf8895ce9e3b5ff108';
const SIMPLE_7702_ACCOUNT = '0xe6Cae83BdE06E4c305530e199D7217f42808555B';
const EIP7702_MARKER = '0x7702';
const EIP7702_DELEGATION_PREFIX = '0xef0100';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_MS = 200;
const DEFAULT_RPC_TIMEOUT_MS = 8_000;
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

const PIMLICO_EIP7702_CHAIN_IDS = new Set([1, 10, 56, 137, 8453, 42161]);

type PimlicoGasTier = 'slow' | 'standard' | 'fast';
type PimlicoRpcUserOperation = Record<string, unknown> & {
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

export interface SponsoredCall {
  to: string;
  data: string;
  value?: BigNumber | bigint | string | number;
}

export interface GasSponsorshipReadiness {
  ready: boolean;
  reason?: string;
  provider: 'pimlico-paymaster';
  operatorMonetaryCostProvenZero: boolean;
}

export interface PimlicoGasPriceQuote {
  maxFeePerGasWei: bigint;
  maxPriorityFeePerGasWei: bigint;
  tier: PimlicoGasTier;
  observedAt: number;
}

export interface SponsoredExecutionResult {
  callId: string;
  transactionHash: string;
  blockNumber?: number;
  gasUsed?: bigint;
  receiptStatus: 0 | 1;
}

interface JsonRpcEnvelope<T> {
  result?: T;
  error?: { code?: number; message?: string; data?: unknown };
}

interface PimlicoPreparedOperation {
  chainId: number;
  userOperationHash: string;
  userOperation: PimlicoRpcUserOperation;
}

const staticCapabilityCache = new Map<number, { expiresAt: number; promise: Promise<void> }>();
const gasPriceCache = new Map<number, { expiresAt: number; value: PimlicoGasPriceQuote }>();

function requireHexAddress(label: string, value: string): string {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`${label} must be a valid EVM address`);
  return ethers.utils.getAddress(value);
}

function quantity(value: ethers.BigNumberish): string {
  return ethers.utils.hexValue(BigNumber.from(value));
}

function toHexValue(value: SponsoredCall['value']): string {
  if (value === undefined) return '0x0';
  if (typeof value === 'bigint') return quantity(value.toString());
  return quantity(value);
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

function optionalQuantity(value: unknown): bigint | undefined {
  const raw = String(value ?? '').trim();
  return /^0x[0-9a-fA-F]+$/.test(raw) ? BigInt(raw) : undefined;
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

function configuredGasTier(environment: NodeJS.ProcessEnv): PimlicoGasTier {
  const value = String(environment.APE_PIMLICO_GAS_TIER || environment.GHOST_WALLET_PIMLICO_GAS_TIER || 'standard').trim().toLowerCase();
  return value === 'slow' || value === 'fast' ? value : 'standard';
}

function parseGasPrice(result: any, tier: PimlicoGasTier): PimlicoGasPriceQuote {
  const order: PimlicoGasTier[] = tier === 'fast'
    ? ['fast', 'standard', 'slow']
    : tier === 'slow'
      ? ['slow', 'standard', 'fast']
      : ['standard', 'fast', 'slow'];
  for (const candidate of order) {
    const value = result?.[candidate];
    if (!value) continue;
    return {
      maxFeePerGasWei: positiveQuantity(value.maxFeePerGas, 'APE_PIMLICO_MAX_FEE'),
      maxPriorityFeePerGasWei: positiveQuantity(value.maxPriorityFeePerGas, 'APE_PIMLICO_PRIORITY_FEE'),
      tier: candidate,
      observedAt: Date.now(),
    };
  }
  throw new Error('APE_PIMLICO_GAS_PRICE_UNAVAILABLE');
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

function packedPaymasterAndData(userOperation: PimlicoRpcUserOperation): string {
  if (!userOperation.paymaster || !ethers.utils.isAddress(userOperation.paymaster)) return '0x';
  return ethers.utils.hexConcat([
    userOperation.paymaster,
    padUint128(userOperation.paymasterVerificationGasLimit || '0x0', 'APE_PIMLICO_PAYMASTER_VERIFICATION_GAS'),
    padUint128(userOperation.paymasterPostOpGasLimit || '0x0', 'APE_PIMLICO_PAYMASTER_POSTOP_GAS'),
    userOperation.paymasterData || '0x',
  ]);
}

function userOperationTypedData(userOperation: PimlicoRpcUserOperation, chainId: number) {
  return {
    domain: { name: 'ERC4337', version: '1', chainId, verifyingContract: ENTRY_POINT_V08 },
    types: PACKED_USER_OPERATION_TYPES,
    message: {
      sender: userOperation.sender,
      nonce: BigNumber.from(userOperation.nonce),
      initCode: ethers.utils.hexConcat([SIMPLE_7702_ACCOUNT, userOperation.factoryData || '0x']),
      callData: userOperation.callData,
      accountGasLimits: ethers.utils.hexConcat([
        padUint128(userOperation.verificationGasLimit, 'APE_PIMLICO_VERIFICATION_GAS'),
        padUint128(userOperation.callGasLimit, 'APE_PIMLICO_CALL_GAS'),
      ]),
      preVerificationGas: BigNumber.from(userOperation.preVerificationGas),
      gasFees: ethers.utils.hexConcat([
        padUint128(userOperation.maxPriorityFeePerGas, 'APE_PIMLICO_PRIORITY_FEE'),
        padUint128(userOperation.maxFeePerGas, 'APE_PIMLICO_MAX_FEE'),
      ]),
      paymasterAndData: packedPaymasterAndData(userOperation),
    },
  };
}

function userOperationHash(userOperation: PimlicoRpcUserOperation, chainId: number): string {
  const typed = userOperationTypedData(userOperation, chainId);
  return ethers.utils._TypedDataEncoder.hash(typed.domain, typed.types, typed.message);
}

function mergeEstimatedOperation(base: Record<string, unknown>, estimate: any): PimlicoRpcUserOperation {
  return {
    ...base,
    callGasLimit: quantity(positiveQuantity(estimate?.callGasLimit, 'APE_PIMLICO_CALL_GAS')),
    verificationGasLimit: quantity(positiveQuantity(estimate?.verificationGasLimit, 'APE_PIMLICO_VERIFICATION_GAS')),
    preVerificationGas: quantity(positiveQuantity(estimate?.preVerificationGas, 'APE_PIMLICO_PREVERIFICATION_GAS')),
  } as PimlicoRpcUserOperation;
}

function mergeSponsoredOperation(base: PimlicoRpcUserOperation, sponsored: any): PimlicoRpcUserOperation {
  const paymaster = String(sponsored?.paymaster || '').trim();
  const paymasterData = String(sponsored?.paymasterData || '0x').trim();
  if (!ethers.utils.isAddress(paymaster)) throw new Error('APE_PIMLICO_PAYMASTER_INVALID');
  if (!ethers.utils.isHexString(paymasterData)) throw new Error('APE_PIMLICO_PAYMASTER_DATA_INVALID');
  return {
    ...base,
    callGasLimit: quantity(positiveQuantity(sponsored?.callGasLimit ?? base.callGasLimit, 'APE_PIMLICO_CALL_GAS')),
    verificationGasLimit: quantity(positiveQuantity(sponsored?.verificationGasLimit ?? base.verificationGasLimit, 'APE_PIMLICO_VERIFICATION_GAS')),
    preVerificationGas: quantity(positiveQuantity(sponsored?.preVerificationGas ?? base.preVerificationGas, 'APE_PIMLICO_PREVERIFICATION_GAS')),
    paymaster: ethers.utils.getAddress(paymaster),
    paymasterVerificationGasLimit: quantity(positiveQuantity(sponsored?.paymasterVerificationGasLimit, 'APE_PIMLICO_PAYMASTER_VERIFICATION_GAS')),
    paymasterPostOpGasLimit: quantity(nonNegativeQuantity(sponsored?.paymasterPostOpGasLimit ?? '0x0', 'APE_PIMLICO_PAYMASTER_POSTOP_GAS')),
    paymasterData,
    signature: STUB_SIGNATURE,
  };
}

export class PimlicoGasSponsorshipManager {
  private readonly apiKey: string;
  private readonly policyId: string;
  private readonly gasTier: PimlicoGasTier;
  private readonly operatorCostProvenZero: boolean;
  private readonly billingSurchargeBps: number;
  private readonly stageOneOverheadGasUnits: number;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.apiKey = String(
      environment.APE_PIMLICO_API_KEY
      || environment.PIMLICO_API_KEY
      || environment.GHOST_WALLET_PIMLICO_API_KEY
      || '',
    ).trim();
    this.policyId = String(
      environment.APE_PIMLICO_SPONSORSHIP_POLICY_ID
      || environment.GHOST_WALLET_PIMLICO_SPONSORSHIP_POLICY_ID
      || '',
    ).trim();
    this.gasTier = configuredGasTier(environment);
    this.operatorCostProvenZero = /^(1|true|yes|on)$/i.test(String(environment.APE_PIMLICO_OPERATOR_COST_PROVEN_ZERO || ''));
    const surcharge = Number(environment.APE_PIMLICO_SURCHARGE_BPS || environment.GHOST_WALLET_PIMLICO_SURCHARGE_BPS || '0');
    this.billingSurchargeBps = Number.isFinite(surcharge) ? Math.max(0, Math.min(5_000, Math.trunc(surcharge))) : 0;
    const overhead = Number(environment.APE_PIMLICO_STAGE_ONE_OVERHEAD_GAS_UNITS || '120000');
    this.stageOneOverheadGasUnits = Number.isFinite(overhead) ? Math.max(0, Math.min(1_000_000, Math.trunc(overhead))) : 120_000;
  }

  isEnabled(): boolean {
    return this.apiKey.length > 0;
  }

  supportsChainId(chainId: number): boolean {
    return PIMLICO_EIP7702_CHAIN_IDS.has(chainId);
  }

  getReadiness(): GasSponsorshipReadiness {
    if (!this.apiKey) {
      return {
        ready: false,
        provider: 'pimlico-paymaster',
        operatorMonetaryCostProvenZero: false,
        reason: 'APE Pimlico API key is not configured',
      };
    }
    return {
      ready: true,
      provider: 'pimlico-paymaster',
      operatorMonetaryCostProvenZero: this.operatorCostProvenZero,
    };
  }

  getBillingSurchargeBps(): number {
    return this.billingSurchargeBps;
  }

  getStageOneOverheadGasUnits(): number {
    return this.stageOneOverheadGasUnits;
  }

  private endpoint(chainId: number): string {
    if (!this.apiKey) throw new Error('APE_PIMLICO_API_KEY_UNAVAILABLE');
    if (!this.supportsChainId(chainId)) throw new Error(`APE_PIMLICO_EIP7702_UNSUPPORTED:${chainId}`);
    return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${encodeURIComponent(this.apiKey)}`;
  }

  private async rpc<T>(chainId: number, method: string, params: unknown[], timeoutMs = DEFAULT_RPC_TIMEOUT_MS): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
    timeout.unref?.();
    try {
      const response = await fetch(this.endpoint(chainId), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
        signal: controller.signal,
      });
      const text = await response.text();
      let envelope: JsonRpcEnvelope<T> = {};
      try { envelope = text ? JSON.parse(text) as JsonRpcEnvelope<T> : {}; } catch { /* normalized below */ }
      if (!response.ok) throw new Error(`Pimlico ${method} HTTP ${response.status}`);
      if (envelope.error) {
        const message = String(envelope.error.message || envelope.error.code || 'unknown error')
          .replace(/apikey=[^&\s]+/gi, 'apikey=REDACTED')
          .slice(0, 400);
        throw new Error(`Pimlico ${method} failed: ${message}`);
      }
      if (envelope.result === undefined) throw new Error(`Pimlico ${method} returned no result`);
      return envelope.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getGasPriceQuote(chainId: number): Promise<PimlicoGasPriceQuote> {
    const cached = gasPriceCache.get(chainId);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.value };
    const raw = await this.rpc<any>(chainId, 'pimlico_getUserOperationGasPrice', []);
    const quote = parseGasPrice(raw, this.gasTier);
    gasPriceCache.set(chainId, { expiresAt: Date.now() + GAS_PRICE_CACHE_MS, value: quote });
    return { ...quote };
  }

  private async ensureStaticCapabilities(provider: providers.Provider, chainId: number): Promise<void> {
    const cached = staticCapabilityCache.get(chainId);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
    const promise = (async () => {
      const [network, entryPoints, entryPointCode, implementationCode] = await Promise.all([
        provider.getNetwork(),
        this.rpc<string[]>(chainId, 'eth_supportedEntryPoints', []),
        provider.getCode(ENTRY_POINT_V08),
        provider.getCode(SIMPLE_7702_ACCOUNT),
      ]);
      if (network.chainId !== chainId) throw new Error('APE_PIMLICO_CHAIN_ID_MISMATCH');
      if (!Array.isArray(entryPoints) || !entryPoints.some(value => String(value).toLowerCase() === ENTRY_POINT_V08.toLowerCase())) {
        throw new Error('APE_PIMLICO_ENTRYPOINT_V08_UNSUPPORTED');
      }
      if (entryPointCode === '0x') throw new Error('APE_PIMLICO_ENTRYPOINT_NOT_DEPLOYED');
      if (implementationCode === '0x') throw new Error('APE_PIMLICO_7702_IMPLEMENTATION_NOT_DEPLOYED');
    })();
    staticCapabilityCache.set(chainId, { expiresAt: Date.now() + STATIC_CAPABILITY_TTL_MS, promise });
    try {
      await promise;
    } catch (error) {
      staticCapabilityCache.delete(chainId);
      throw error;
    }
  }

  private async resolveAuthorization(provider: providers.Provider, wallet: Wallet, chainId: number): Promise<Record<string, string> | undefined> {
    const senderCode = await provider.getCode(wallet.address);
    if (senderCode !== '0x') {
      const delegate = delegationTarget(senderCode);
      if (!delegate || delegate.toLowerCase() !== SIMPLE_7702_ACCOUNT.toLowerCase()) {
        throw new Error('APE_PIMLICO_EIP7702_DELEGATION_CONFLICT');
      }
      return undefined;
    }
    const authorizationNonce = await provider.getTransactionCount(wallet.address, 'pending');
    return signAuthorization(wallet, chainId, authorizationNonce);
  }

  private async prepareSingle(wallet: Wallet, chainId: number, call: SponsoredCall): Promise<PimlicoPreparedOperation> {
    const provider = wallet.provider;
    if (!provider) throw new Error('APE_PIMLICO_CONNECTED_WALLET_REQUIRED');
    await this.ensureStaticCapabilities(provider, chainId);
    const [authorization, nonceRaw, gasPrice] = await Promise.all([
      this.resolveAuthorization(provider, wallet, chainId),
      new Contract(ENTRY_POINT_V08, ENTRY_POINT_ABI, provider).getNonce(wallet.address, 0),
      this.getGasPriceQuote(chainId),
    ]);
    const callData = SIMPLE_7702_INTERFACE.encodeFunctionData('execute', [
      requireHexAddress('call.to', call.to),
      BigNumber.from(toHexValue(call.value)),
      ethers.utils.hexlify(call.data || '0x'),
    ]);
    const base = {
      sender: wallet.address,
      nonce: quantity(nonceRaw),
      factory: EIP7702_MARKER,
      factoryData: '0x',
      callData,
      maxFeePerGas: quantity(gasPrice.maxFeePerGasWei),
      maxPriorityFeePerGas: quantity(gasPrice.maxPriorityFeePerGasWei),
      signature: STUB_SIGNATURE,
      ...(authorization ? { eip7702Auth: authorization } : {}),
    };
    const initialEstimate = await this.rpc<any>(chainId, 'eth_estimateUserOperationGas', [base, ENTRY_POINT_V08]);
    const preparedBase = mergeEstimatedOperation(base, initialEstimate);
    const sponsorParams: unknown[] = [preparedBase, ENTRY_POINT_V08];
    if (this.policyId) sponsorParams.push({ sponsorshipPolicyId: this.policyId });
    const sponsored = await this.rpc<any>(chainId, 'pm_sponsorUserOperation', sponsorParams);
    const userOperation = mergeSponsoredOperation(preparedBase, sponsored);
    const typed = userOperationTypedData(userOperation, chainId);
    userOperation.signature = await wallet._signTypedData(typed.domain, typed.types, typed.message);
    return {
      chainId,
      userOperation,
      userOperationHash: userOperationHash(userOperation, chainId),
    };
  }

  private async submitAndWait(
    prepared: PimlicoPreparedOperation,
    timeoutMs: number,
    pollMs: number,
  ): Promise<SponsoredExecutionResult> {
    const returned = String(await this.rpc<string>(prepared.chainId, 'eth_sendUserOperation', [prepared.userOperation, ENTRY_POINT_V08]));
    if (!/^0x[a-fA-F0-9]{64}$/.test(returned)) throw new Error('APE_PIMLICO_USER_OPERATION_HASH_INVALID');
    if (returned.toLowerCase() !== prepared.userOperationHash.toLowerCase()) {
      throw new Error('APE_PIMLICO_USER_OPERATION_HASH_MISMATCH');
    }
    const deadline = Date.now() + Math.max(5_000, timeoutMs);
    while (Date.now() < deadline) {
      const receipt = await this.rpc<any>(prepared.chainId, 'eth_getUserOperationReceipt', [returned]);
      if (receipt) {
        const transactionHash = String(receipt?.receipt?.transactionHash || '');
        if (!/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) throw new Error('APE_PIMLICO_RECEIPT_TRANSACTION_HASH_INVALID');
        const success = receipt.success === true || String(receipt?.receipt?.status || '').toLowerCase() === '0x1';
        if (!success) throw new Error('APE_PIMLICO_SPONSORED_TRANSACTION_REVERTED');
        const blockNumberRaw = receipt?.receipt?.blockNumber;
        return {
          callId: returned,
          transactionHash,
          blockNumber: blockNumberRaw !== undefined ? Number(BigInt(blockNumberRaw)) : undefined,
          gasUsed: optionalQuantity(receipt.actualGasUsed),
          receiptStatus: 1,
        };
      }
      await new Promise(resolve => setTimeout(resolve, Math.max(100, pollMs)));
    }
    throw new Error(`Pimlico sponsored call timed out after ${Math.max(5_000, timeoutMs)}ms`);
  }

  async execute(input: { wallet: Wallet; chainId: number; calls: SponsoredCall[]; timeoutMs?: number; pollMs?: number }): Promise<SponsoredExecutionResult> {
    if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new Error('chainId must be a positive integer');
    if (!this.supportsChainId(input.chainId)) throw new Error(`APE_PIMLICO_EIP7702_UNSUPPORTED:${input.chainId}`);
    if (!Array.isArray(input.calls) || input.calls.length === 0) throw new Error('At least one sponsored call is required');
    const timeoutMs = Math.max(5_000, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const pollMs = Math.max(100, input.pollMs ?? DEFAULT_POLL_MS);
    const deadline = Date.now() + timeoutMs;
    let result: SponsoredExecutionResult | null = null;
    for (const call of input.calls) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Pimlico sponsored call batch timed out after ${timeoutMs}ms`);
      const prepared = await this.prepareSingle(input.wallet, input.chainId, call);
      result = await this.submitAndWait(prepared, remaining, pollMs);
    }
    if (!result) throw new Error('Pimlico sponsored execution produced no result');
    return result;
  }
}

let singleton: PimlicoGasSponsorshipManager | null = null;
export function getGasSponsorManager(): PimlicoGasSponsorshipManager {
  if (!singleton) singleton = new PimlicoGasSponsorshipManager();
  return singleton;
}
export default PimlicoGasSponsorshipManager;
