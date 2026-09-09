import { BigNumber, Wallet, ethers } from 'ethers';

const ALCHEMY_WALLET_API_BASE = 'https://api.g.alchemy.com/v2';
const BICONOMY_API_BASE = 'https://api.biconomy.io';
const BICONOMY_EXPLORER_BASE = 'https://network.biconomy.io/v1/explorer';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_MS = 1_000;
const DEFAULT_ALCHEMY_ADMIN_FEE_BPS = 800;
// Alchemy Wallet APIs currently support both SemiModularAccount7702 deployments.
// v1.1.0 became the default for new EIP-7702 delegations on 2026-08-20, while
// existing v1.0.0 delegations remain valid and are not upgraded in place.
const ALCHEMY_MODULAR_ACCOUNT_7702_ALLOWLIST = new Set([
  '0x69007702764179f14f51cdce752f4f775d74e139', // SemiModularAccount7702 v1.0.0
  '0x77021100bd87b7008e5e1989d0eb38555d0d0000', // SemiModularAccount7702 v1.1.0
]);
// Biconomy documents these Nexus implementations for MEE/EIP-7702. A future
// provider implementation must be explicitly added/configured before this signer
// will delegate to it; a quote response alone never grants delegation authority.
const BICONOMY_NEXUS_7702_ALLOWLIST = new Set([
  '0x000000004f43c49e93c970e84001853a70923b03', // MEE v2.0 / documented 7702 integration
  '0x00000000383e8cbe298514674ea60ee1d1de50ac', // MEE v2.1 Nexus implementation
  '0x0000000020fe2f30453074ad916edeb653ec7e9d', // MEE v2.2.1 Nexus implementation
  '0x54f220e4f0deab58be26153df5a674668b9d7fb2', // current Nexus implementation listing
]);

export interface SponsoredCall {
  to: string;
  data: string;
  value?: BigNumber | bigint | string | number;
}

export type GasSponsorshipProvider = 'alchemy-gas-manager' | 'biconomy-mee' | 'competitive-mesh';

export interface GasSponsorshipReadiness {
  ready: boolean;
  reason?: string;
  provider: GasSponsorshipProvider;
  readyProviders?: Array<'alchemy-gas-manager' | 'biconomy-mee'>;
}

export interface ProviderQuotedCost {
  amount: string;
  token: string | null;
  chainId: number;
  nativeWeiComparable: boolean;
}

export interface SponsoredExecutionResult {
  callId: string;
  transactionHash: string;
  blockNumber?: number;
  gasUsed?: bigint;
  receiptStatus: 0 | 1;
  provider?: 'alchemy-gas-manager' | 'biconomy-mee';
  providerQuotedCost?: ProviderQuotedCost;
  providerBillingLiability?: boolean;
  operatorMonetaryCostProvenZero?: boolean;
  providerLatencyMs?: number;
}

interface JsonRpcEnvelope<T> {
  result?: T;
  error?: { code?: number; message?: string; data?: unknown };
}

interface SponsorshipExecutionInput {
  wallet: Wallet;
  chainId: number;
  calls: SponsoredCall[];
  timeoutMs?: number;
  pollMs?: number;
}

interface PreparedSponsorship {
  provider: 'alchemy-gas-manager' | 'biconomy-mee';
  preparedAt: number;
  prepareLatencyMs: number;
  estimatedNativeCostWei: bigint | null;
  quotedCost: ProviderQuotedCost | null;
  submit: () => Promise<SponsoredExecutionResult>;
}

interface ProviderPerformance {
  prepared: number;
  prepareFailures: number;
  submitted: number;
  settled: number;
  submissionFailures: number;
  ewmaPrepareLatencyMs: number | null;
  ewmaSettlementLatencyMs: number | null;
}

function requireHexAddress(label: string, value: string): string {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`${label} must be a valid EVM address`);
  return value;
}

function toHexValue(value: SponsoredCall['value']): string {
  if (value === undefined) return '0x0';
  if (typeof value === 'bigint') return ethers.utils.hexValue(BigNumber.from(value.toString()));
  return ethers.utils.hexValue(BigNumber.from(value));
}

function toDecimalValue(value: SponsoredCall['value']): string {
  if (value === undefined) return '0';
  if (typeof value === 'bigint') return value.toString();
  return BigNumber.from(value).toString();
}

function stripEip712Domain(types: Record<string, Array<{ name: string; type: string }>>): Record<string, Array<{ name: string; type: string }>> {
  const { EIP712Domain: _domain, ...rest } = types;
  return rest;
}

function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function rlpQuantity(value: bigint): string {
  if (value === 0n) return '0x';
  return ethers.utils.hexStripZeros(ethers.utils.hexlify(BigNumber.from(value.toString())));
}

function explicitTransactionHash(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of ['transactionHash', 'txHash', 'transaction_hash']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && /^0x[a-fA-F0-9]{64}$/.test(candidate)) return candidate;
  }
  for (const nested of Object.values(record)) {
    if (!nested || typeof nested !== 'object') continue;
    const candidate = explicitTransactionHash(nested);
    if (candidate) return candidate;
  }
  return null;
}

function isNativeFeeToken(value: unknown): boolean {
  const token = String(value ?? '').trim().toLowerCase();
  return token === ''
    || token === 'native'
    || token === '0x0000000000000000000000000000000000000000'
    || token === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
}

function ewma(previous: number | null, sample: number): number {
  return previous === null ? sample : previous * 0.75 + sample * 0.25;
}

export class AlchemyGasSponsorshipManager {
  private readonly apiKey: string;
  private readonly policyId: string;
  private readonly adminFeeBps: number;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.apiKey = String(environment.ALCHEMY_API_KEY || '').trim();
    this.policyId = String(environment.ALCHEMY_GAS_POLICY_ID || '').trim();
    this.adminFeeBps = boundedInt(environment.ALCHEMY_GAS_MANAGER_ADMIN_FEE_BPS, DEFAULT_ALCHEMY_ADMIN_FEE_BPS, 0, 10_000);
  }

  isEnabled(): boolean {
    return this.apiKey.length > 0 && this.policyId.length > 0;
  }

  getReadiness(): GasSponsorshipReadiness {
    if (!this.apiKey) {
      return { ready: false, provider: 'alchemy-gas-manager', reason: 'ALCHEMY_API_KEY is not configured' };
    }
    if (!this.policyId) {
      return { ready: false, provider: 'alchemy-gas-manager', reason: 'ALCHEMY_GAS_POLICY_ID is not configured' };
    }
    return { ready: true, provider: 'alchemy-gas-manager' };
  }

  private async rpc<T>(method: string, params: unknown[], timeoutMs = 15_000): Promise<T> {
    const readiness = this.getReadiness();
    if (!readiness.ready) throw new Error(readiness.reason || 'Alchemy Gas Manager is not configured');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${ALCHEMY_WALLET_API_BASE}/${this.apiKey}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Alchemy Wallet API HTTP ${response.status}`);
      const envelope = await response.json() as JsonRpcEnvelope<T>;
      if (envelope.error) {
        throw new Error(`Alchemy Wallet API ${method} failed: ${envelope.error.message || envelope.error.code || 'unknown error'}`);
      }
      if (envelope.result === undefined) throw new Error(`Alchemy Wallet API ${method} returned no result`);
      return envelope.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async signPreparedItem(wallet: Wallet, item: any, expectedChainId: number): Promise<any> {
    const request = item?.signatureRequest;
    if (!request) throw new Error('Alchemy prepared call is missing signatureRequest');

    let signature: string;
    if (request.type === 'personal_sign') {
      const raw = request.data?.raw;
      if (typeof raw !== 'string' || !ethers.utils.isHexString(raw)) {
        throw new Error('Alchemy personal_sign request is missing a valid raw payload');
      }
      signature = await wallet.signMessage(ethers.utils.arrayify(raw));
    } else if (request.type === 'eth_signTypedData_v4') {
      const typed = request.data;
      if (!typed?.domain || !typed?.types || typed?.message === undefined) {
        throw new Error('Alchemy typed-data signature request is incomplete');
      }
      signature = await wallet._signTypedData(typed.domain, stripEip712Domain(typed.types), typed.message);
    } else if (item?.type === 'authorization' || request.type === 'eth_sign') {
      if (item?.type === 'authorization') {
        const delegationAddress = String(item?.data?.address || '').toLowerCase();
        if (!ALCHEMY_MODULAR_ACCOUNT_7702_ALLOWLIST.has(delegationAddress)) {
          throw new Error(`Refusing unexpected EIP-7702 delegation target: ${delegationAddress || 'missing'}`);
        }
        if (item?.chainId !== undefined && Number(BigInt(item.chainId)) !== expectedChainId) {
          throw new Error('Refusing EIP-7702 authorization for an unexpected chain');
        }
      }
      const raw = request.rawPayload || request.data?.raw;
      if (typeof raw !== 'string' || !ethers.utils.isHexString(raw, 32)) {
        throw new Error('Alchemy EIP-7702 authorization is missing a 32-byte raw payload');
      }
      signature = ethers.utils.joinSignature(wallet._signingKey().signDigest(raw));
    } else {
      throw new Error(`Unsupported Alchemy signature request type: ${String(request.type)}`);
    }

    const { signatureRequest: _signatureRequest, ...unsigned } = item;
    return {
      ...unsigned,
      signature: { type: 'secp256k1', data: signature },
    };
  }

  private async signPreparedCalls(wallet: Wallet, prepared: any, expectedChainId: number): Promise<any> {
    if (prepared?.type === 'array') {
      if (!Array.isArray(prepared.data) || prepared.data.length === 0) {
        throw new Error('Alchemy prepared call array is empty');
      }
      return {
        type: 'array',
        data: await Promise.all(prepared.data.map((item: any) => this.signPreparedItem(wallet, item, expectedChainId))),
      };
    }
    return this.signPreparedItem(wallet, prepared, expectedChainId);
  }

  private estimateNativeCostWei(prepared: any): bigint | null {
    const items = prepared?.type === 'array' && Array.isArray(prepared.data) ? prepared.data : [prepared];
    let total = 0n;
    let measured = false;
    for (const item of items) {
      if (!String(item?.type || '').startsWith('user-operation')) continue;
      const data = item?.data;
      try {
        const maxFeePerGas = BigInt(data?.maxFeePerGas ?? 0);
        const gas = BigInt(data?.callGasLimit ?? 0)
          + BigInt(data?.verificationGasLimit ?? 0)
          + BigInt(data?.preVerificationGas ?? 0)
          + BigInt(data?.paymasterVerificationGasLimit ?? 0)
          + BigInt(data?.paymasterPostOpGasLimit ?? 0);
        if (maxFeePerGas <= 0n || gas <= 0n) continue;
        total += gas * maxFeePerGas;
        measured = true;
      } catch {
        return null;
      }
    }
    if (!measured || total <= 0n) return null;
    return total * BigInt(10_000 + this.adminFeeBps) / 10_000n;
  }

  async prepare(input: SponsorshipExecutionInput): Promise<PreparedSponsorship> {
    if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new Error('chainId must be a positive integer');
    if (!Array.isArray(input.calls) || input.calls.length === 0) throw new Error('At least one sponsored call is required');
    const from = requireHexAddress('wallet.address', input.wallet.address);
    const calls = input.calls.map((call, index) => ({
      to: requireHexAddress(`calls[${index}].to`, call.to),
      data: ethers.utils.hexlify(call.data || '0x'),
      value: toHexValue(call.value),
    }));
    const startedAt = Date.now();
    const prepared = await this.rpc<any>('wallet_prepareCalls', [{
      calls,
      from,
      chainId: ethers.utils.hexValue(input.chainId),
      capabilities: { paymasterService: { policyId: this.policyId } },
    }]);
    const prepareLatencyMs = Date.now() - startedAt;
    const estimatedNativeCostWei = this.estimateNativeCostWei(prepared);
    const quotedCost: ProviderQuotedCost | null = estimatedNativeCostWei === null ? null : {
      amount: estimatedNativeCostWei.toString(), token: null, chainId: input.chainId, nativeWeiComparable: true,
    };
    return {
      provider: 'alchemy-gas-manager', preparedAt: Date.now(), prepareLatencyMs, estimatedNativeCostWei, quotedCost,
      submit: () => this.executePrepared(input, prepared, quotedCost, prepareLatencyMs),
    };
  }

  private async executePrepared(
    input: SponsorshipExecutionInput,
    prepared: any,
    quotedCost: ProviderQuotedCost | null,
    prepareLatencyMs: number,
  ): Promise<SponsoredExecutionResult> {
    const startedAt = Date.now();
    const signed = await this.signPreparedCalls(input.wallet, prepared, input.chainId);
    const sendResult = await this.rpc<any>('wallet_sendPreparedCalls', [signed]);
    const callId = String(sendResult?.id || '');
    if (!ethers.utils.isHexString(callId)) throw new Error('Alchemy wallet_sendPreparedCalls returned an invalid call id');

    const deadline = Date.now() + Math.max(5_000, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const pollMs = Math.max(250, input.pollMs ?? DEFAULT_POLL_MS);
    while (Date.now() < deadline) {
      const status = await this.rpc<any>('wallet_getCallsStatus', [callId]);
      const numericStatus = Number(status?.status);
      if (numericStatus === 200) {
        const receipts = Array.isArray(status?.receipts) ? status.receipts : [];
        const receipt = receipts[0];
        const transactionHash = String(receipt?.transactionHash || status?.transactionHash || '');
        if (!/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) {
          throw new Error('Alchemy confirmed the call but returned no transaction hash');
        }
        const receiptStatusHex = receipt?.status;
        const receiptStatus = receiptStatusHex === undefined ? 1 : Number(BigInt(receiptStatusHex));
        if (receiptStatus !== 1) throw new Error('Alchemy sponsored transaction reverted');
        const blockNumber = receipt?.blockNumber !== undefined ? Number(BigInt(receipt.blockNumber)) : undefined;
        const gasUsed = receipt?.gasUsed !== undefined ? BigInt(receipt.gasUsed) : undefined;
        return {
          callId, transactionHash, blockNumber, gasUsed, receiptStatus: 1,
          provider: 'alchemy-gas-manager', providerQuotedCost: quotedCost || undefined,
          providerBillingLiability: true, operatorMonetaryCostProvenZero: false,
          providerLatencyMs: prepareLatencyMs + (Date.now() - startedAt),
        };
      }
      if (numericStatus === 400) throw new Error('Alchemy sponsored call failed or reverted');
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
    throw new Error(`Alchemy sponsored call timed out after ${Math.max(5_000, input.timeoutMs ?? DEFAULT_TIMEOUT_MS)}ms`);
  }

  async execute(input: SponsorshipExecutionInput): Promise<SponsoredExecutionResult> {
    const prepared = await this.prepare(input);
    return prepared.submit();
  }
}

export class BiconomyGasSponsorshipManager {
  private readonly apiKey: string;
  private readonly extraDelegates: Set<string>;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.apiKey = String(environment.BICONOMY_API_KEY || '').trim();
    this.extraDelegates = new Set(String(environment.BICONOMY_7702_DELEGATE_ALLOWLIST || '')
      .split(',').map(value => value.trim().toLowerCase()).filter(value => /^0x[a-f0-9]{40}$/.test(value)));
  }

  isEnabled(): boolean { return this.apiKey.length > 0; }

  getReadiness(): GasSponsorshipReadiness {
    return this.apiKey
      ? { ready: true, provider: 'biconomy-mee' }
      : { ready: false, provider: 'biconomy-mee', reason: 'BICONOMY_API_KEY is not configured' };
  }

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': this.apiKey };
  }

  private async request(path: string, body: unknown, timeoutMs = 15_000): Promise<{ status: number; payload: any }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${BICONOMY_API_BASE}${path}`, {
        method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: controller.signal,
      });
      let payload: any = null;
      const text = await response.text();
      try { payload = text ? JSON.parse(text) : null; } catch { payload = { message: text }; }
      return { status: response.status, payload };
    } finally {
      clearTimeout(timeout);
    }
  }

  private delegateAllowed(address: string): boolean {
    const normalized = address.toLowerCase();
    return BICONOMY_NEXUS_7702_ALLOWLIST.has(normalized) || this.extraDelegates.has(normalized);
  }

  private signAuthorization(wallet: Wallet, item: any, expectedChainId: number): any {
    const chainId = BigInt(item?.chainId ?? -1);
    const address = requireHexAddress('Biconomy authorization address', String(item?.address || ''));
    const nonce = BigInt(item?.nonce ?? -1);
    if (chainId !== 0n && chainId !== BigInt(expectedChainId)) throw new Error('Refusing Biconomy EIP-7702 authorization for an unexpected chain');
    if (nonce < 0n || nonce >= (1n << 64n)) throw new Error('Biconomy EIP-7702 authorization nonce is invalid');
    if (!this.delegateAllowed(address)) throw new Error(`Refusing unapproved Biconomy EIP-7702 delegation target: ${address}`);
    const encoded = ethers.utils.RLP.encode([rlpQuantity(chainId), address, rlpQuantity(nonce)]);
    const digest = ethers.utils.keccak256(ethers.utils.hexConcat(['0x05', encoded]));
    const signature = wallet._signingKey().signDigest(digest);
    return {
      chainId: Number(chainId), address, nonce: Number(nonce),
      yParity: signature.recoveryParam, r: signature.r, s: signature.s, v: String(signature.v),
    };
  }

  private async quote(input: SponsorshipExecutionInput): Promise<any> {
    const ownerAddress = requireHexAddress('wallet.address', input.wallet.address);
    const composeFlows = input.calls.map((call, index) => ({
      type: '/instructions/build-raw',
      data: {
        to: requireHexAddress(`calls[${index}].to`, call.to),
        data: ethers.utils.hexlify(call.data || '0x'),
        chainId: input.chainId,
        value: toDecimalValue(call.value),
      },
    }));
    const baseRequest: any = { mode: 'eoa-7702', ownerAddress, composeFlows };
    let response = await this.request('/v1/quote', baseRequest);
    if (response.status === 412) {
      const authorizations = Array.isArray(response.payload?.authorizations) ? response.payload.authorizations : [];
      if (authorizations.length === 0) throw new Error('Biconomy requested EIP-7702 authorization without authorization tuples');
      const signed = authorizations.map((item: any) => this.signAuthorization(input.wallet, item, input.chainId));
      response = await this.request('/v1/quote', { ...baseRequest, authorizations: signed });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Biconomy MEE quote failed (${response.status}): ${String(response.payload?.message || response.payload?.error || 'unknown error')}`);
    }
    if (response.payload?.quoteType !== 'simple' || !Array.isArray(response.payload?.payloadToSign) || response.payload.payloadToSign.length === 0) {
      throw new Error('Biconomy EIP-7702 quote did not return the required simple signature payload');
    }
    return response.payload;
  }

  private quotedCost(quote: any, expectedChainId: number): { cost: ProviderQuotedCost | null; nativeWei: bigint | null } {
    const amountRaw = quote?.fee?.amount;
    if (typeof amountRaw !== 'string' || !/^\d+$/.test(amountRaw)) return { cost: null, nativeWei: null };
    const chainId = Number(quote?.fee?.chainId ?? expectedChainId);
    if (!Number.isSafeInteger(chainId) || chainId !== expectedChainId) return { cost: null, nativeWei: null };
    const token = quote?.fee?.token == null ? null : String(quote.fee.token);
    // Biconomy's EIP-7702 documentation describes this fee amount in wei when no
    // feeToken is requested. If the response names a non-native fee token, cost
    // remains visible but is deliberately non-comparable until a canonical FX
    // conversion authority is provided by the caller.
    const nativeWeiComparable = isNativeFeeToken(token);
    const cost: ProviderQuotedCost = { amount: amountRaw, token, chainId, nativeWeiComparable };
    return { cost, nativeWei: nativeWeiComparable ? BigInt(amountRaw) : null };
  }

  private async signSimplePayload(wallet: Wallet, item: any): Promise<any> {
    const message = item?.signablePayload?.message ?? item?.message;
    const raw = typeof message === 'object' && message !== null ? (message as any).raw : message;
    if (typeof raw !== 'string' || raw.length === 0) throw new Error('Biconomy simple signature payload is missing');
    const signature = ethers.utils.isHexString(raw)
      ? await wallet.signMessage(ethers.utils.arrayify(raw))
      : await wallet.signMessage(raw);
    return { ...item, signature };
  }

  private async waitForTransactionHash(supertxHash: string, timeoutMs: number, pollMs: number): Promise<{ transactionHash: string; blockNumber?: number; gasUsed?: bigint }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(15_000, Math.max(3_000, pollMs * 3)));
      try {
        const response = await fetch(`${BICONOMY_EXPLORER_BASE}/${supertxHash}`, {
          headers: { accept: 'application/json', 'x-api-key': this.apiKey, authorization: `Bearer ${this.apiKey}` },
          signal: controller.signal,
        });
        if (response.ok) {
          const status = await response.json() as any;
          const normalizedStatus = String(status?.status || '').toUpperCase();
          if (normalizedStatus === 'FAILED') throw new Error(`Biconomy MEE execution failed after acceptance: ${String(status?.error || 'unknown error')}`);
          const transactionHash = explicitTransactionHash(status);
          if (normalizedStatus === 'SUCCESS' && transactionHash) {
            const blockNumberRaw = status?.blockNumber ?? status?.receipt?.blockNumber;
            const gasUsedRaw = status?.gasUsed ?? status?.receipt?.gasUsed;
            const blockNumber = blockNumberRaw == null ? undefined : Number(blockNumberRaw);
            let gasUsed: bigint | undefined;
            try { if (gasUsedRaw != null) gasUsed = BigInt(gasUsedRaw); } catch { /* receipt follower remains canonical */ }
            return { transactionHash, ...(Number.isFinite(blockNumber) ? { blockNumber } : {}), ...(gasUsed !== undefined ? { gasUsed } : {}) };
          }
        }
      } finally {
        clearTimeout(timeout);
      }
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
    throw new Error(`Biconomy MEE accepted ${supertxHash} but no canonical transaction hash became available before timeout; automatic alternate submission is forbidden`);
  }

  async prepare(input: SponsorshipExecutionInput): Promise<PreparedSponsorship> {
    if (!this.isEnabled()) throw new Error('BICONOMY_API_KEY is not configured');
    if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new Error('chainId must be a positive integer');
    if (!Array.isArray(input.calls) || input.calls.length === 0) throw new Error('At least one sponsored call is required');
    const startedAt = Date.now();
    const quote = await this.quote(input);
    const prepareLatencyMs = Date.now() - startedAt;
    const cost = this.quotedCost(quote, input.chainId);
    return {
      provider: 'biconomy-mee', preparedAt: Date.now(), prepareLatencyMs,
      estimatedNativeCostWei: cost.nativeWei, quotedCost: cost.cost,
      submit: async () => {
        const submitStartedAt = Date.now();
        const signedPayloads = await Promise.all(quote.payloadToSign.map((item: any) => this.signSimplePayload(input.wallet, item)));
        const response = await this.request('/v1/execute', { ...quote, payloadToSign: signedPayloads }, Math.min(30_000, Math.max(10_000, input.timeoutMs ?? DEFAULT_TIMEOUT_MS)));
        if (response.status < 200 || response.status >= 300 || response.payload?.success !== true) {
          throw new Error(`Biconomy MEE execute failed before confirmed acceptance (${response.status}): ${String(response.payload?.error || response.payload?.message || 'unknown error')}`);
        }
        const supertxHash = String(response.payload?.supertxHash || '');
        if (!/^0x[a-fA-F0-9]{64}$/.test(supertxHash)) throw new Error('Biconomy MEE accepted execution without a valid supertransaction hash');
        const immediateHash = explicitTransactionHash(response.payload);
        const tracked = immediateHash
          ? { transactionHash: immediateHash }
          : await this.waitForTransactionHash(
            supertxHash,
            Math.max(10_000, input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
            Math.max(500, input.pollMs ?? 2_000),
          );
        return {
          callId: supertxHash,
          transactionHash: tracked.transactionHash,
          blockNumber: tracked.blockNumber,
          gasUsed: tracked.gasUsed,
          receiptStatus: 1,
          provider: 'biconomy-mee', providerQuotedCost: cost.cost || undefined,
          providerBillingLiability: true, operatorMonetaryCostProvenZero: false,
          providerLatencyMs: prepareLatencyMs + (Date.now() - submitStartedAt),
        };
      },
    };
  }

  async execute(input: SponsorshipExecutionInput): Promise<SponsoredExecutionResult> {
    const prepared = await this.prepare(input);
    return prepared.submit();
  }
}

export class CompetitiveGasSponsorshipManager {
  private readonly alchemy: AlchemyGasSponsorshipManager;
  private readonly biconomy: BiconomyGasSponsorshipManager;
  private readonly performance = new Map<'alchemy-gas-manager' | 'biconomy-mee', ProviderPerformance>();

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.alchemy = new AlchemyGasSponsorshipManager(environment);
    this.biconomy = new BiconomyGasSponsorshipManager(environment);
    for (const provider of ['alchemy-gas-manager', 'biconomy-mee'] as const) {
      this.performance.set(provider, {
        prepared: 0, prepareFailures: 0, submitted: 0, settled: 0, submissionFailures: 0,
        ewmaPrepareLatencyMs: null, ewmaSettlementLatencyMs: null,
      });
    }
  }

  getReadiness(): GasSponsorshipReadiness {
    const readyProviders = [
      this.alchemy.getReadiness(),
      this.biconomy.getReadiness(),
    ].filter(readiness => readiness.ready).map(readiness => readiness.provider as 'alchemy-gas-manager' | 'biconomy-mee');
    return readyProviders.length > 0
      ? { ready: true, provider: 'competitive-mesh', readyProviders }
      : { ready: false, provider: 'competitive-mesh', readyProviders: [], reason: 'No gas sponsorship provider is configured' };
  }

  private notePrepared(candidate: PreparedSponsorship): void {
    const metrics = this.performance.get(candidate.provider)!;
    metrics.prepared += 1;
    metrics.ewmaPrepareLatencyMs = ewma(metrics.ewmaPrepareLatencyMs, candidate.prepareLatencyMs);
  }

  private notePrepareFailure(provider: 'alchemy-gas-manager' | 'biconomy-mee'): void {
    this.performance.get(provider)!.prepareFailures += 1;
  }

  private reliability(provider: 'alchemy-gas-manager' | 'biconomy-mee'): number {
    const metrics = this.performance.get(provider)!;
    if (metrics.submitted === 0) return 1;
    return metrics.settled / metrics.submitted;
  }

  private rank(candidates: PreparedSponsorship[]): PreparedSponsorship[] {
    return [...candidates].sort((left, right) => {
      const leftCost = left.estimatedNativeCostWei;
      const rightCost = right.estimatedNativeCostWei;
      if (leftCost !== null && rightCost !== null && leftCost !== rightCost) return leftCost < rightCost ? -1 : 1;
      // A directly comparable provider quote is stronger than an unpriced lane.
      if (leftCost !== null && rightCost === null) return -1;
      if (leftCost === null && rightCost !== null) return 1;
      const reliabilityDelta = this.reliability(right.provider) - this.reliability(left.provider);
      if (Math.abs(reliabilityDelta) > 0.001) return reliabilityDelta > 0 ? 1 : -1;
      return left.prepareLatencyMs - right.prepareLatencyMs;
    });
  }

  getMetrics(): Record<string, ProviderPerformance> {
    return Object.fromEntries([...this.performance.entries()].map(([provider, metrics]) => [provider, { ...metrics }]));
  }

  async execute(input: SponsorshipExecutionInput): Promise<SponsoredExecutionResult> {
    const readiness = this.getReadiness();
    if (!readiness.ready) throw new Error(readiness.reason || 'No gas sponsorship provider is configured');
    const attempts: Array<Promise<PreparedSponsorship>> = [];
    const providers: Array<'alchemy-gas-manager' | 'biconomy-mee'> = [];
    if (this.alchemy.isEnabled()) { providers.push('alchemy-gas-manager'); attempts.push(this.alchemy.prepare(input)); }
    if (this.biconomy.isEnabled()) { providers.push('biconomy-mee'); attempts.push(this.biconomy.prepare(input)); }
    const settled = await Promise.allSettled(attempts);
    const candidates: PreparedSponsorship[] = [];
    settled.forEach((result, index) => {
      const provider = providers[index];
      if (result.status === 'fulfilled') {
        candidates.push(result.value);
        this.notePrepared(result.value);
      } else {
        this.notePrepareFailure(provider);
      }
    });
    if (candidates.length === 0) throw new Error('Every configured sponsorship provider failed during non-state-changing preparation');
    const selected = this.rank(candidates)[0];
    const metrics = this.performance.get(selected.provider)!;
    metrics.submitted += 1;
    const startedAt = Date.now();
    try {
      // State-changing submission is deliberately single-provider. Once a lane is
      // selected, transport ambiguity can never trigger a second provider submit.
      const result = await selected.submit();
      metrics.settled += 1;
      metrics.ewmaSettlementLatencyMs = ewma(metrics.ewmaSettlementLatencyMs, Date.now() - startedAt);
      return result;
    } catch (error) {
      metrics.submissionFailures += 1;
      throw error;
    }
  }
}

let singleton: CompetitiveGasSponsorshipManager | null = null;

export function getGasSponsorManager(): CompetitiveGasSponsorshipManager {
  if (!singleton) singleton = new CompetitiveGasSponsorshipManager();
  return singleton;
}

export default CompetitiveGasSponsorshipManager;
