import { BigNumber, Contract, Wallet, ethers, providers } from 'ethers';
import { EUROPA_NETWORK } from './adapters/europa-network.js';
import { EUROPA_SUSHI } from './adapters/europa-sushi-registry.js';
import { Stage4PowComputeCoordinator } from './adapters/stage4-pow-compute-coordinator.js';
import { resolveEuropaExternalGasDifficulty } from './adapters/skale-pow-adapter.js';
import {
  NativeGasFundingSubmissionUnknownError,
  type NativeGasFundingQuote,
  type NativeGasFundingRequest,
  type NativeGasFundingSettlement,
  type NativeGasFundingStrategy,
} from './native-gas-funding-coordinator.js';

const MESON_MAINNET_RELAYER = 'https://relayer.meson.fi';
const ZEROEX_API = 'https://api.0x.org';
const ARBITRUM_CHAIN_ID = 42161;
const ARBITRUM_USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const NATIVE_TOKEN = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const USDC_DECIMALS = 6;
const ERC20_ABI = [
  'function allowance(address owner,address spender) view returns (uint256)',
  'function approve(address spender,uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];

export const MESON_ZEROEX_NATIVE_GAS_DESTINATIONS = ['arbitrum'] as const;

interface MesonPriceResponse {
  result?: { totalFee?: string; serviceFee?: string; lpFee?: string };
  error?: unknown;
}

interface MesonEncodeResponse {
  result?: {
    encoded?: string;
    signingRequest?: { message?: string; hash?: string };
    fee?: { totalFee?: string; serviceFee?: string; lpFee?: string };
    tx?: { to?: string; data?: string; value?: string };
    initiator?: string;
  };
  error?: { message?: string; data?: { swapData?: MesonEncodeResponse['result'] } };
}

interface MesonSubmitResponse {
  result?: { swapId?: string };
}

type MesonStatus = 'PENDING' | 'BONDED' | 'EXECUTING' | 'RELEASED' | 'CANCELLED' | 'EXPIRED' | 'UNLOCKED';

interface ZeroExTypedData {
  types: Record<string, Array<{ name: string; type: string }>>;
  domain: Record<string, unknown>;
  message: Record<string, unknown>;
  primaryType: string;
}

interface ZeroExGaslessObject {
  type: string;
  eip712: ZeroExTypedData;
}

interface ZeroExQuote {
  liquidityAvailable?: boolean;
  buyAmount?: string;
  minBuyAmount?: string;
  sellAmount?: string;
  issues?: {
    allowance?: { actual?: string; spender?: string } | null;
    balance?: unknown;
    simulationIncomplete?: boolean;
  };
  approval?: ZeroExGaslessObject | null;
  trade?: ZeroExGaslessObject;
  fees?: {
    gasFee?: { amount?: string; token?: string; type?: string } | null;
    zeroExFee?: { amount?: string; token?: string; type?: string } | null;
  };
}

interface ZeroExSubmitResponse {
  tradeHash?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function asPositiveInteger(value: string | undefined): bigint | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed > 0n ? parsed : null;
}

function parseUsdcAmount(value: string | undefined): bigint | null {
  if (!value) return null;
  try {
    const parsed = ethers.utils.parseUnits(value, USDC_DECIMALS);
    return BigInt(parsed.toString());
  } catch {
    return null;
  }
}

function normalizeAddress(value: string): string {
  return ethers.utils.getAddress(value);
}

function stripEip712Domain(types: ZeroExTypedData['types']): ZeroExTypedData['types'] {
  const { EIP712Domain: _ignored, ...rest } = types;
  return rest;
}

function extractTransactionHashes(value: unknown, key = ''): string[] {
  if (typeof value === 'string') {
    if (/^(transactionHash|txHash|transaction_hash|tx_hash)$/i.test(key) && /^0x[a-fA-F0-9]{64}$/.test(value)) return [value];
    return [];
  }
  if (Array.isArray(value)) return value.flatMap(item => extractTransactionHashes(item));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([childKey, child]) => extractTransactionHashes(child, childKey));
}

export class MesonZeroExNativeGasStrategy implements NativeGasFundingStrategy {
  readonly name = 'bridge_refuel' as const;
  private readonly sourceProvider: providers.Provider;
  private readonly destinationProvider: providers.Provider;
  private readonly mesonRelayer: string;
  private readonly zeroExApi: string;
  private readonly zeroExApiKey: string;

  constructor(
    private readonly sourceWallet: Wallet,
    private readonly destinationWallet: Wallet,
    options: {
      mesonRelayer?: string;
      zeroExApi?: string;
      zeroExApiKey?: string;
    } = {},
  ) {
    if (!sourceWallet.provider) throw new Error('Meson bridge/refuel requires a connected Europa source wallet');
    if (!destinationWallet.provider) throw new Error('Meson bridge/refuel requires a connected destination wallet');
    this.sourceProvider = sourceWallet.provider;
    this.destinationProvider = destinationWallet.provider;
    this.mesonRelayer = (options.mesonRelayer || process.env.ZERO_CAPITAL_MESON_RELAYER_URL || MESON_MAINNET_RELAYER).replace(/\/$/, '');
    this.zeroExApi = (options.zeroExApi || process.env.ZERO_CAPITAL_ZEROX_API_URL || ZEROEX_API).replace(/\/$/, '');
    this.zeroExApiKey = options.zeroExApiKey || process.env.ZERO_CAPITAL_ZEROX_API_KEY || process.env.ZERO_EX_API_KEY || '';
  }

  async quote(request: NativeGasFundingRequest): Promise<NativeGasFundingQuote> {
    const unavailable = (reason: string): NativeGasFundingQuote => ({
      strategy: this.name,
      available: false,
      economicallyViable: false,
      sourceProceedsRequiredBaseUnits: '0',
      estimatedNetProceedsBaseUnits: '0',
      estimatedCostNativeWei: '0',
      estimatedDeliveredNativeWei: '0',
      reimbursementRequired: true,
      reason,
    });

    if (request.evidence.sourceChain !== 'europa') return unavailable('Meson bridge/refuel only accepts verified Europa bootstrap proceeds');
    if (request.destinationChain !== 'arbitrum') return unavailable(`Meson bridge/refuel destination ${request.destinationChain} is not enabled; current verified path is Arbitrum`);
    if (request.evidence.profitToken.toLowerCase() !== EUROPA_SUSHI.tokens.usdc.toLowerCase()) {
      return unavailable('Current verified Meson bridge/refuel path requires Europa USDC profit');
    }
    if (!this.zeroExApiKey) return unavailable('ZERO_CAPITAL_ZEROX_API_KEY (or ZERO_EX_API_KEY) is required for destination gasless native conversion');

    const [sourceNetwork, destinationNetwork] = await Promise.all([
      this.sourceProvider.getNetwork(),
      this.destinationProvider.getNetwork(),
    ]);
    if (sourceNetwork.chainId !== EUROPA_NETWORK.chainId) return unavailable(`Europa source provider chain mismatch: ${sourceNetwork.chainId}`);
    if (destinationNetwork.chainId !== ARBITRUM_CHAIN_ID) return unavailable(`Arbitrum destination provider chain mismatch: ${destinationNetwork.chainId}`);
    if (this.sourceWallet.address.toLowerCase() !== request.evidence.recipient.toLowerCase()) {
      return unavailable('Verified Europa profit recipient does not match the authoritative source wallet');
    }
    if (this.destinationWallet.address.toLowerCase() !== request.destinationWallet.toLowerCase()) {
      return unavailable('Destination request does not match the authoritative execution wallet');
    }

    const realizedProfit = asPositiveInteger(request.evidence.realizedProfitBaseUnits);
    if (!realizedProfit) return unavailable('Verified Europa profit amount is not positive');
    const amount = ethers.utils.formatUnits(realizedProfit.toString(), USDC_DECIMALS);
    const mesonPrice = await this.mesonJson<MesonPriceResponse>('/api/v1/price', {
      method: 'POST',
      body: JSON.stringify({
        from: 'skale-europa:usdc',
        to: 'arb:usdc',
        amount,
        fromAddress: this.sourceWallet.address,
      }),
    });
    const mesonFee = parseUsdcAmount(mesonPrice.result?.totalFee);
    if (mesonFee === null || mesonFee >= realizedProfit) return unavailable('Meson quote did not prove positive USDC proceeds after bridge fees');
    const expectedDestinationUsdc = realizedProfit - mesonFee;

    const zeroExPrice = await this.zeroExQuote('price', expectedDestinationUsdc, request.destinationWallet);
    if (!zeroExPrice.liquidityAvailable) return unavailable('0x Gasless API reports no destination USDC/native liquidity');
    const expectedNative = asPositiveInteger(zeroExPrice.buyAmount);
    if (!expectedNative) return unavailable('0x Gasless API did not return a positive native-token output');
    const minimumNative = BigInt(request.minimumDeliveredNativeWei || request.requiredNativeWei);
    if (expectedNative < minimumNative) {
      return unavailable(`Verified bootstrap profit currently converts to ${expectedNative.toString()} native wei, below required ${minimumNative.toString()}`);
    }
    const gasFee = this.zeroExSellTokenFee(zeroExPrice.fees?.gasFee);
    if (gasFee <= 0n) return unavailable('0x quote does not prove that relayer gas will be reimbursed from the internally generated USDC proceeds');
    const zeroExFee = this.zeroExSellTokenFee(zeroExPrice.fees?.zeroExFee);
    const netSourceProceeds = expectedDestinationUsdc - gasFee - zeroExFee;
    if (netSourceProceeds <= 0n) return unavailable('Bridge and gasless-conversion fees consume all verified bootstrap proceeds');

    return {
      strategy: this.name,
      available: true,
      economicallyViable: true,
      sourceProceedsRequiredBaseUnits: realizedProfit.toString(),
      estimatedNetProceedsBaseUnits: netSourceProceeds.toString(),
      estimatedCostNativeWei: '0',
      estimatedDeliveredNativeWei: expectedNative.toString(),
      reimbursementRequired: true,
      reason: 'Meson can relay verified Europa USDC to Arbitrum and 0x Gasless can convert it to native ETH with gas charged from the bridged USDC',
    };
  }

  async settle(request: NativeGasFundingRequest, quote: NativeGasFundingQuote): Promise<NativeGasFundingSettlement> {
    if (!quote.available || !quote.economicallyViable) throw new Error(quote.reason);
    const realizedProfit = asPositiveInteger(request.evidence.realizedProfitBaseUnits);
    if (!realizedProfit) throw new Error('Verified Europa profit amount is not positive');
    const destination = normalizeAddress(request.destinationWallet);
    if (destination.toLowerCase() !== this.destinationWallet.address.toLowerCase()) {
      throw new Error('Destination request does not match the authoritative Arbitrum execution wallet');
    }

    const destinationToken = new Contract(ARBITRUM_USDC, ERC20_ABI, this.destinationProvider);
    const [nativeBefore, usdcBefore] = await Promise.all([
      this.destinationProvider.getBalance(destination),
      destinationToken.balanceOf(destination) as Promise<BigNumber>,
    ]);

    const amount = ethers.utils.formatUnits(realizedProfit.toString(), USDC_DECIMALS);
    const encodedResponse = await this.mesonJson<MesonEncodeResponse>('/api/v1/swap', {
      method: 'POST',
      body: JSON.stringify({
        from: 'skale-europa:usdc',
        to: 'arb:usdc',
        amount,
        fromAddress: this.sourceWallet.address,
        recipient: destination,
      }),
    }, true);
    const encoded = encodedResponse.result?.encoded || encodedResponse.error?.data?.swapData?.encoded;
    const signingRequest = encodedResponse.result?.signingRequest || encodedResponse.error?.data?.swapData?.signingRequest;
    const approvalTx = encodedResponse.result?.tx || encodedResponse.error?.data?.swapData?.tx;
    if (!encoded || !signingRequest?.message) throw new Error('Meson did not return an executable signed-intent payload');

    if (approvalTx?.to) {
      await this.ensureEuropaZeroGasApproval(request.evidence.profitToken, approvalTx.to, realizedProfit);
    }

    const mesonSignature = await this.signMesonMessage(signingRequest.message);
    const submitted = await this.mesonJson<MesonSubmitResponse>(`/api/v1/swap/${encodeURIComponent(encoded)}`, {
      method: 'POST',
      body: JSON.stringify({
        fromAddress: this.sourceWallet.address,
        recipient: destination,
        signature: mesonSignature,
      }),
    });
    const swapId = submitted.result?.swapId;
    if (!swapId) throw new Error('Meson submission did not return a swapId');

    try {
      await this.waitForMesonRelease(swapId);
    } catch (error) {
      throw new NativeGasFundingSubmissionUnknownError(
        `Meson settlement outcome requires reconciliation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const bridgedUsdc = await this.waitForTokenIncrease(destinationToken, destination, usdcBefore);
    if (bridgedUsdc <= 0n) {
      throw new NativeGasFundingSubmissionUnknownError('Meson reported release but no destination USDC balance increase was observed');
    }

    const zeroExQuote = await this.zeroExQuote('quote', bridgedUsdc, destination);
    if (!zeroExQuote.liquidityAvailable || !zeroExQuote.trade) throw new Error('0x Gasless firm quote is not executable');
    const expectedNative = asPositiveInteger(zeroExQuote.buyAmount);
    const minimumNative = BigInt(request.minimumDeliveredNativeWei || request.requiredNativeWei);
    if (!expectedNative || expectedNative < minimumNative) {
      throw new Error(`0x Gasless firm quote cannot deliver required native gas: expected=${expectedNative?.toString() || '0'}, minimum=${minimumNative.toString()}`);
    }
    const gasFee = this.zeroExSellTokenFee(zeroExQuote.fees?.gasFee);
    if (gasFee <= 0n) throw new Error('0x Gasless firm quote does not charge relayer gas from the internally generated USDC proceeds');

    const approvalRequired = zeroExQuote.issues?.allowance != null;
    if (approvalRequired && !zeroExQuote.approval) {
      throw new Error('0x Gasless requires a destination token approval but did not provide a gasless approval object');
    }
    const trade = await this.signZeroExObject(zeroExQuote.trade);
    const approval = approvalRequired && zeroExQuote.approval
      ? await this.signZeroExObject(zeroExQuote.approval)
      : undefined;

    const submittedTrade = await this.zeroExJson<ZeroExSubmitResponse>('/gasless/submit', {
      method: 'POST',
      body: JSON.stringify({
        trade,
        chainId: ARBITRUM_CHAIN_ID,
        ...(approval ? { approval } : {}),
      }),
    });
    const tradeHash = submittedTrade.tradeHash;
    if (!tradeHash || !/^0x[a-fA-F0-9]{64}$/.test(tradeHash)) {
      throw new Error('0x Gasless submission did not return a valid trade hash');
    }

    let destinationTransactionHash: string;
    try {
      destinationTransactionHash = await this.waitForZeroExReceipt(tradeHash);
    } catch (error) {
      throw new NativeGasFundingSubmissionUnknownError(
        `0x Gasless submission outcome requires reconciliation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const receipt = await this.destinationProvider.getTransactionReceipt(destinationTransactionHash);
    if (!receipt || receipt.status !== 1) throw new Error('0x Gasless destination transaction receipt was missing or reverted');
    const nativeAfter = await this.destinationProvider.getBalance(destination);
    const delivered = nativeAfter.gt(nativeBefore) ? nativeAfter.sub(nativeBefore) : BigNumber.from(0);
    if (BigInt(delivered.toString()) < minimumNative) {
      throw new Error(`Gasless conversion delivered ${delivered.toString()} native wei, below required ${minimumNative.toString()}`);
    }
    const usdcAfter = BigNumber.from(await destinationToken.balanceOf(destination));
    if (usdcAfter.gte(usdcBefore.add(bridgedUsdc))) {
      throw new Error('Destination USDC did not decrease after the gasless conversion; reimbursement from bootstrap proceeds is unverified');
    }

    return {
      strategy: this.name,
      state: 'SETTLED',
      sourceTransactionHash: request.evidence.sourceTransactionHash,
      destinationTransactionHash,
      destinationReceiptVerified: true,
      destinationNativeBalanceBeforeWei: nativeBefore.toString(),
      destinationNativeBalanceAfterWei: nativeAfter.toString(),
      deliveredNativeWei: delivered.toString(),
      reimbursementRequired: true,
      reimbursementVerified: true,
      sourceProceedsAllocatedBaseUnits: realizedProfit.toString(),
      provenance: [
        `source_receipt:${request.evidence.sourceTransactionHash}`,
        `meson_swap:${swapId}`,
        `zeroex_trade:${tradeHash}`,
        `destination_receipt:${destinationTransactionHash}`,
        `zeroex_gas_fee_from_profit:${gasFee.toString()}`,
        'destination_native_balance_delta_verified',
        'source_funded_bridge_refuel',
      ],
    };
  }

  private zeroExSellTokenFee(fee: { amount?: string; token?: string } | null | undefined): bigint {
    if (!fee?.amount || !fee.token || fee.token.toLowerCase() !== ARBITRUM_USDC.toLowerCase()) return 0n;
    return asPositiveInteger(fee.amount) || 0n;
  }

  private async ensureEuropaZeroGasApproval(tokenAddress: string, spenderAddress: string, requiredAmount: bigint): Promise<void> {
    const token = new Contract(normalizeAddress(tokenAddress), ERC20_ABI, this.sourceProvider);
    const spender = normalizeAddress(spenderAddress);
    const currentAllowance = BigNumber.from(await token.allowance(this.sourceWallet.address, spender));
    if (BigInt(currentAllowance.toString()) >= requiredAmount) return;

    const iface = new ethers.utils.Interface(ERC20_ABI);
    const data = iface.encodeFunctionData('approve', [spender, ethers.constants.MaxUint256]);
    const nonce = await this.sourceProvider.getTransactionCount(this.sourceWallet.address, 'pending');
    const estimate = await this.sourceProvider.estimateGas({
      from: this.sourceWallet.address,
      to: token.address,
      data,
      value: 0,
    });
    const gasLimit = estimate.mul(125).div(100);
    const difficulty = (await resolveEuropaExternalGasDifficulty(this.sourceProvider)).difficulty;
    const compute = new Stage4PowComputeCoordinator(this.sourceProvider);
    const configuredWorkers = Number(process.env.ZERO_CAPITAL_EUROPA_POW_WORKERS || '');
    const pow = await compute.findProof({
      workloadId: `meson-approval:${token.address}:${spender}:${nonce}`,
      sender: this.sourceWallet.address,
      nonce,
      payload: {
        to: token.address,
        data,
        value: '0',
        gasLimit: gasLimit.toNumber(),
      },
      requiredGas: BigInt(estimate.toString()),
      externalGasDifficulty: difficulty,
      maxAttempts: Math.max(1, Number(process.env.ZERO_CAPITAL_EUROPA_POW_MAX_ATTEMPTS || 250_000)),
    }, {
      workerCount: Number.isInteger(configuredWorkers) && configuredWorkers > 0 ? configuredWorkers : undefined,
      timeoutMs: Math.max(10_000, Number(process.env.ZERO_CAPITAL_EUROPA_APPROVAL_TIMEOUT_MS || 120_000)),
    });

    const nativeBefore = await this.sourceProvider.getBalance(this.sourceWallet.address);
    const signed = await this.sourceWallet.signTransaction({
      chainId: EUROPA_NETWORK.chainId,
      nonce,
      to: token.address,
      data,
      value: 0,
      gasLimit,
      gasPrice: BigNumber.from(pow.solution.gasPriceWei),
    });
    const tx = await this.sourceProvider.sendTransaction(signed);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error('Europa zero-gas Meson approval reverted');
    const nativeAfter = await this.sourceProvider.getBalance(this.sourceWallet.address);
    if (!nativeAfter.eq(nativeBefore)) {
      const nativeDelta = nativeBefore.gt(nativeAfter) ? nativeBefore.sub(nativeAfter) : nativeAfter.sub(nativeBefore);
      throw new Error(`Europa Meson approval changed native balance by ${nativeDelta.toString()} wei; zero-monetary-gas proof failed`);
    }
    const allowanceAfter = BigNumber.from(await token.allowance(this.sourceWallet.address, spender));
    if (BigInt(allowanceAfter.toString()) < requiredAmount) throw new Error('Europa Meson allowance did not reach the required amount');
  }

  private async signMesonMessage(message: string): Promise<string> {
    const headerHex = Buffer.from('\x19Ethereum Signed Message:\n52', 'utf8').toString('hex');
    let stripped = message.replace(headerHex, '');
    if (!stripped.startsWith('0x')) stripped = `0x${stripped}`;
    if (!ethers.utils.isHexString(stripped)) throw new Error('Meson signing request is not valid hex data');
    return this.sourceWallet.signMessage(ethers.utils.arrayify(stripped));
  }

  private async signZeroExObject(object: ZeroExGaslessObject): Promise<Record<string, unknown>> {
    if (!object.eip712?.primaryType || !object.eip712.domain || !object.eip712.message || !object.eip712.types) {
      throw new Error('0x Gasless returned an incomplete EIP-712 signing object');
    }
    const signatureHex = await this.destinationWallet._signTypedData(
      object.eip712.domain,
      stripEip712Domain(object.eip712.types),
      object.eip712.message,
    );
    const split = ethers.utils.splitSignature(signatureHex);
    return {
      type: object.type,
      eip712: object.eip712,
      signature: {
        r: split.r,
        s: split.s,
        v: split.v,
        recoveryParam: split.recoveryParam,
        signatureType: 2,
      },
    };
  }

  private async waitForMesonRelease(swapId: string): Promise<void> {
    const timeoutMs = Math.max(30_000, Number(process.env.ZERO_CAPITAL_MESON_TIMEOUT_MS || 600_000));
    const pollMs = Math.max(1_000, Number(process.env.ZERO_CAPITAL_MESON_POLL_MS || 3_000));
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const raw = await this.mesonJson<Record<string, any>>(`/api/v1/swap/${encodeURIComponent(swapId)}`, { method: 'GET' });
      const result = raw.result || {};
      const status: MesonStatus = result.RELEASED
        ? 'RELEASED'
        : result.UNLOCKED
          ? 'UNLOCKED'
          : result.CANCELLED
            ? 'CANCELLED'
            : result.EXECUTED
              ? 'EXECUTING'
              : result.BONDED
                ? 'BONDED'
                : 'PENDING';
      if (status === 'RELEASED') return;
      if (status === 'CANCELLED' || status === 'EXPIRED' || status === 'UNLOCKED') {
        throw new Error(`Meson swap ${status.toLowerCase()}`);
      }
      await sleep(pollMs);
    }
    throw new Error(`Meson swap ${swapId} timed out`);
  }

  private async waitForTokenIncrease(token: Contract, wallet: string, before: BigNumber): Promise<bigint> {
    const timeoutMs = Math.max(30_000, Number(process.env.ZERO_CAPITAL_DESTINATION_TOKEN_TIMEOUT_MS || 120_000));
    const pollMs = Math.max(500, Number(process.env.ZERO_CAPITAL_DESTINATION_TOKEN_POLL_MS || 2_000));
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const current = BigNumber.from(await token.balanceOf(wallet));
      if (current.gt(before)) return BigInt(current.sub(before).toString());
      await sleep(pollMs);
    }
    return 0n;
  }

  private async waitForZeroExReceipt(tradeHash: string): Promise<string> {
    const timeoutMs = Math.max(30_000, Number(process.env.ZERO_CAPITAL_ZEROX_TIMEOUT_MS || 180_000));
    const pollMs = Math.max(500, Number(process.env.ZERO_CAPITAL_ZEROX_POLL_MS || 3_000));
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const status = await this.zeroExJson<Record<string, unknown>>(`/gasless/status/${tradeHash}?chainId=${ARBITRUM_CHAIN_ID}`, { method: 'GET' });
      const statusName = String(status.status || '').toLowerCase();
      const hashes = Array.from(new Set(extractTransactionHashes(status)));
      for (const hash of hashes) {
        const receipt = await this.destinationProvider.getTransactionReceipt(hash).catch(() => null);
        if (receipt?.status === 1) return hash;
        if (receipt?.status === 0) throw new Error(`0x Gasless transaction ${hash} reverted`);
      }
      if (['failed', 'reverted', 'cancelled', 'canceled'].includes(statusName)) {
        throw new Error(`0x Gasless trade ended in ${statusName}`);
      }
      await sleep(pollMs);
    }
    throw new Error(`0x Gasless trade ${tradeHash} timed out before a verified on-chain receipt was available`);
  }

  private async zeroExQuote(kind: 'price' | 'quote', sellAmount: bigint, taker: string): Promise<ZeroExQuote> {
    const params = new URLSearchParams({
      chainId: String(ARBITRUM_CHAIN_ID),
      sellToken: ARBITRUM_USDC,
      buyToken: NATIVE_TOKEN,
      sellAmount: sellAmount.toString(),
      taker,
    });
    return this.zeroExJson<ZeroExQuote>(`/gasless/${kind}?${params.toString()}`, { method: 'GET' });
  }

  private async mesonJson<T>(path: string, init: RequestInit, allowSwapDataError = false): Promise<T> {
    return this.fetchJson<T>(`${this.mesonRelayer}${path}`, init, {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }, allowSwapDataError);
  }

  private async zeroExJson<T>(path: string, init: RequestInit): Promise<T> {
    if (!this.zeroExApiKey) throw new Error('ZERO_CAPITAL_ZEROX_API_KEY (or ZERO_EX_API_KEY) is required');
    return this.fetchJson<T>(`${this.zeroExApi}${path}`, init, {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      '0x-api-key': this.zeroExApiKey,
      '0x-version': 'v2',
    });
  }

  private async fetchJson<T>(
    url: string,
    init: RequestInit,
    headers: Record<string, string>,
    allowSwapDataError = false,
  ): Promise<T> {
    const timeoutMs = Math.max(1_000, Number(process.env.ZERO_CAPITAL_HTTP_TIMEOUT_MS || 15_000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) }, signal: controller.signal });
      const text = await response.text();
      let parsed: any;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`Non-JSON response from ${new URL(url).host}: HTTP ${response.status}`);
      }
      if (!response.ok) {
        if (allowSwapDataError && parsed?.error?.data?.swapData) return parsed as T;
        throw new Error(`HTTP ${response.status} from ${new URL(url).host}: ${JSON.stringify(parsed).slice(0, 1000)}`);
      }
      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
