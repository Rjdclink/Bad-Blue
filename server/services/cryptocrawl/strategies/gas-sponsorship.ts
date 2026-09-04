import { BigNumber, Wallet, ethers } from 'ethers';

const ALCHEMY_WALLET_API_BASE = 'https://api.g.alchemy.com/v2';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_MS = 1_000;
// Alchemy Wallet APIs support both current SemiModularAccount7702 deployments.
// v1.1.0 is deployed now and becomes the default for new Wallet-API EIP-7702
// delegations on 2026-09-21; existing delegations retain their recorded version.
const ALCHEMY_MODULAR_ACCOUNT_7702_ALLOWLIST = new Set([
  '0x69007702764179f14f51cdce752f4f775d74e139', // SemiModularAccount7702 v1.0.0
  '0x77021100bd87b7008e5e1989d0eb38555d0d0000', // SemiModularAccount7702 v1.1.0
]);

export interface SponsoredCall {
  to: string;
  data: string;
  value?: BigNumber | bigint | string | number;
}

export interface GasSponsorshipReadiness {
  ready: boolean;
  reason?: string;
  provider: 'alchemy-gas-manager';
}

export interface SponsoredExecutionResult {
  callId: string;
  transactionHash: string;
  blockNumber?: number;
  gasUsed?: bigint;
  receiptStatus: 0 | 1;
}

export interface OpportunityBackedGasQuote {
  provider: 'alchemy-gas-manager';
  tokenAddress: string;
  maxTokenAmount: bigint;
  fundingMode: 'opportunity_erc20_postop';
  upfrontExecutionWalletTokenBalanceRequired: false;
  operatorNativeGasInputRequired: false;
}

export interface OpportunityBackedExecutionResult extends SponsoredExecutionResult {
  feeTokenAddress: string;
  maxFeeTokenAmount: bigint;
  guaranteedSurplusBeforeGasTokenAmount: bigint;
  minimumResidualAfterGasTokenAmount: bigint;
  fundingMode: 'opportunity_erc20_postop';
  operatorNativeGasInputRequired: false;
}

interface JsonRpcEnvelope<T> {
  result?: T;
  error?: { code?: number; message?: string; data?: unknown };
}

function requireHexAddress(label: string, value: string): string {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`${label} must be a valid EVM address`);
  return ethers.utils.getAddress(value.toLowerCase());
}

function toHexValue(value: SponsoredCall['value']): string {
  if (value === undefined) return '0x0';
  if (typeof value === 'bigint') return ethers.utils.hexValue(BigNumber.from(value.toString()));
  return ethers.utils.hexValue(BigNumber.from(value));
}

function toPositiveBigNumber(label: string, value: BigNumber | bigint | string | number): BigNumber {
  const parsed = typeof value === 'bigint' ? BigNumber.from(value.toString()) : BigNumber.from(value);
  if (parsed.lte(0)) throw new Error(`${label} must be greater than zero`);
  return parsed;
}

function stripEip712Domain(types: Record<string, Array<{ name: string; type: string }>>): Record<string, Array<{ name: string; type: string }>> {
  const { EIP712Domain: _domain, ...rest } = types;
  return rest;
}

function preparedItems(prepared: any): any[] {
  return prepared?.type === 'array' && Array.isArray(prepared.data) ? prepared.data : [prepared];
}

function extractFeePayment(prepared: any, expectedTokenAddress: string): BigNumber {
  const expected = requireHexAddress('opportunity-backed gas token', expectedTokenAddress).toLowerCase();
  const payments = preparedItems(prepared)
    .map(item => item?.feePayment)
    .filter(payment => payment && payment.sponsored === false && typeof payment.tokenAddress === 'string');
  if (payments.length === 0) throw new Error('Alchemy opportunity-backed preparation returned no ERC-20 feePayment');

  let max = BigNumber.from(0);
  let matched = false;
  for (const payment of payments) {
    const token = requireHexAddress('Alchemy feePayment.tokenAddress', payment.tokenAddress).toLowerCase();
    if (token !== expected) continue;
    const amount = BigNumber.from(payment.maxAmount);
    if (amount.lte(0)) throw new Error('Alchemy opportunity-backed feePayment maxAmount is not positive');
    if (amount.gt(max)) max = amount;
    matched = true;
  }
  if (!matched) throw new Error('Alchemy opportunity-backed feePayment token does not match the requested profit token');
  return max;
}

export class AlchemyGasSponsorshipManager {
  private readonly apiKey: string;
  private readonly policyId: string;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.apiKey = String(environment.ALCHEMY_API_KEY || '').trim();
    this.policyId = String(environment.ALCHEMY_GAS_POLICY_ID || '').trim();
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

  private normalizeCalls(input: { wallet: Wallet; chainId: number; calls: SponsoredCall[] }): {
    from: string;
    chainId: string;
    calls: Array<{ to: string; data: string; value: string }>;
  } {
    if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new Error('chainId must be a positive integer');
    if (!Array.isArray(input.calls) || input.calls.length === 0) throw new Error('At least one sponsored call is required');
    const from = requireHexAddress('wallet.address', input.wallet.address);
    const calls = input.calls.map((call, index) => ({
      to: requireHexAddress(`calls[${index}].to`, call.to),
      data: ethers.utils.hexlify(call.data || '0x'),
      value: toHexValue(call.value),
    }));
    return { from, chainId: ethers.utils.hexValue(input.chainId), calls };
  }

  private async waitForResult(callId: string, timeoutMs?: number, pollMs?: number): Promise<SponsoredExecutionResult> {
    const deadline = Date.now() + Math.max(5_000, timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const poll = Math.max(250, pollMs ?? DEFAULT_POLL_MS);
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
        return { callId, transactionHash, blockNumber, gasUsed, receiptStatus: 1 };
      }
      if (numericStatus === 400) throw new Error('Alchemy sponsored call failed or reverted');
      await new Promise(resolve => setTimeout(resolve, poll));
    }
    throw new Error(`Alchemy sponsored call timed out after ${Math.max(5_000, timeoutMs ?? DEFAULT_TIMEOUT_MS)}ms`);
  }

  async execute(input: {
    wallet: Wallet;
    chainId: number;
    calls: SponsoredCall[];
    timeoutMs?: number;
    pollMs?: number;
  }): Promise<SponsoredExecutionResult> {
    const request = this.normalizeCalls(input);
    const prepared = await this.rpc<any>('wallet_prepareCalls', [{
      calls: request.calls,
      from: request.from,
      chainId: request.chainId,
      capabilities: {
        paymasterService: { policyId: this.policyId },
      },
    }]);

    const signed = await this.signPreparedCalls(input.wallet, prepared, input.chainId);
    const sendResult = await this.rpc<any>('wallet_sendPreparedCalls', [signed]);
    const callId = String(sendResult?.id || '');
    if (!ethers.utils.isHexString(callId)) throw new Error('Alchemy wallet_sendPreparedCalls returned an invalid call id');
    return this.waitForResult(callId, input.timeoutMs, input.pollMs);
  }

  /**
   * Quote a post-operation ERC-20 gas charge. balanceCheck=false allows the
   * prepared operation to create the payment-token balance during execution.
   * This is a quote only; provider policy acceptance remains runtime evidence.
   */
  async quoteOpportunityBackedGas(input: {
    wallet: Wallet;
    chainId: number;
    calls: SponsoredCall[];
    tokenAddress: string;
  }): Promise<OpportunityBackedGasQuote> {
    const request = this.normalizeCalls(input);
    const tokenAddress = requireHexAddress('opportunity-backed gas token', input.tokenAddress);
    const prepared = await this.rpc<any>('wallet_prepareCalls', [{
      calls: request.calls,
      from: request.from,
      chainId: request.chainId,
      capabilities: {
        paymasterService: {
          policyId: this.policyId,
          onlyEstimation: true,
          erc20: {
            tokenAddress,
            postOpSettings: { autoApprove: true, balanceCheck: false },
          },
        },
      },
    }]);
    return {
      provider: 'alchemy-gas-manager',
      tokenAddress,
      maxTokenAmount: extractFeePayment(prepared, tokenAddress).toBigInt(),
      fundingMode: 'opportunity_erc20_postop',
      upfrontExecutionWalletTokenBalanceRequired: false,
      operatorNativeGasInputRequired: false,
    };
  }

  /**
   * Execute an atomic opportunity whose output token repays its gas charge in
   * postOp. guaranteedSurplusBeforeGasTokenAmount MUST already be net of borrowed
   * principal, flash-loan fees, venue fees, relay/builder charges, modeled
   * slippage and every other canonical cost except this ERC-20 gas payment.
   * minimumResidualAfterGasTokenAmount is the safety epsilon/profit floor that
   * must remain after the maximum gas-token charge. No fallback submission is
   * performed here after ambiguity or rejection.
   */
  async executeOpportunityBacked(input: {
    wallet: Wallet;
    chainId: number;
    calls: SponsoredCall[];
    tokenAddress: string;
    guaranteedSurplusBeforeGasTokenAmount: BigNumber | bigint | string | number;
    minimumResidualAfterGasTokenAmount: BigNumber | bigint | string | number;
    timeoutMs?: number;
    pollMs?: number;
  }): Promise<OpportunityBackedExecutionResult> {
    const request = this.normalizeCalls(input);
    const tokenAddress = requireHexAddress('opportunity-backed gas token', input.tokenAddress);
    const guaranteedSurplus = toPositiveBigNumber('guaranteedSurplusBeforeGasTokenAmount', input.guaranteedSurplusBeforeGasTokenAmount);
    const minimumResidual = toPositiveBigNumber('minimumResidualAfterGasTokenAmount', input.minimumResidualAfterGasTokenAmount);
    if (guaranteedSurplus.lte(minimumResidual)) {
      throw new Error('Guaranteed surplus must exceed the required post-gas residual');
    }
    const hardMaxTokenAmount = guaranteedSurplus.sub(minimumResidual);

    const estimate = await this.quoteOpportunityBackedGas({
      wallet: input.wallet,
      chainId: input.chainId,
      calls: input.calls,
      tokenAddress,
    });
    const estimatedMax = BigNumber.from(estimate.maxTokenAmount.toString());
    if (estimatedMax.gt(hardMaxTokenAmount)) {
      throw new Error('Opportunity-backed gas quote would violate the guaranteed residual-profit floor');
    }

    const prepared = await this.rpc<any>('wallet_prepareCalls', [{
      calls: request.calls,
      from: request.from,
      chainId: request.chainId,
      capabilities: {
        paymasterService: {
          policyId: this.policyId,
          erc20: {
            tokenAddress,
            maxTokenAmount: ethers.utils.hexValue(hardMaxTokenAmount),
            postOpSettings: { autoApprove: true, balanceCheck: false },
          },
        },
      },
    }]);
    const finalMax = extractFeePayment(prepared, tokenAddress);
    if (finalMax.gt(hardMaxTokenAmount)) {
      throw new Error('Final opportunity-backed gas charge violates the guaranteed residual-profit floor');
    }

    const signed = await this.signPreparedCalls(input.wallet, prepared, input.chainId);
    const sendResult = await this.rpc<any>('wallet_sendPreparedCalls', [signed]);
    const callId = String(sendResult?.id || '');
    if (!ethers.utils.isHexString(callId)) throw new Error('Alchemy wallet_sendPreparedCalls returned an invalid call id');
    const result = await this.waitForResult(callId, input.timeoutMs, input.pollMs);
    return {
      ...result,
      feeTokenAddress: tokenAddress,
      maxFeeTokenAmount: finalMax.toBigInt(),
      guaranteedSurplusBeforeGasTokenAmount: guaranteedSurplus.toBigInt(),
      minimumResidualAfterGasTokenAmount: minimumResidual.toBigInt(),
      fundingMode: 'opportunity_erc20_postop',
      operatorNativeGasInputRequired: false,
    };
  }
}

let singleton: AlchemyGasSponsorshipManager | null = null;

export function getGasSponsorManager(): AlchemyGasSponsorshipManager {
  if (!singleton) singleton = new AlchemyGasSponsorshipManager();
  return singleton;
}

export default AlchemyGasSponsorshipManager;
