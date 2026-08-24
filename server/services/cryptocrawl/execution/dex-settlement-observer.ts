import { BigNumber, ethers, providers } from 'ethers';
import logger from '../../../logger.js';
import type { OnchainExecutionPlan } from './adapters/onchain-payload-builder.js';
import type {
  ExecutionStatus,
  NormalizedRealizedExecution,
  RealizedExecutionEconomics,
} from './settlement-types.js';

const TRANSFER_INTERFACE = new ethers.utils.Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);
const ERC20_INTERFACE = new ethers.utils.Interface([
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
]);
const TRANSFER_TOPIC = TRANSFER_INTERFACE.getEventTopic('Transfer').toLowerCase();

export interface DexSettlementPriceContext {
  inputTokenPriceUsd?: number;
  outputTokenPriceUsd?: number;
  nativeTokenPriceUsd?: number;
}

export interface DexSettlementObservationRequest {
  txHash: string;
  chain: string;
  walletAddress: string;
  plan?: OnchainExecutionPlan;
  tokenIn?: string;
  tokenOut?: string;
  inputAmountBaseUnits?: string;
  expectedOutputAmountBaseUnits?: string;
  inputTokenDecimals?: number;
  outputTokenDecimals?: number;
  prices?: DexSettlementPriceContext;
  predictedProfitUsd?: number | null;
  predictedFeeUsd?: number | null;
  predictedSlippageBps?: number | null;
  confirmationTimeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface DexSettlementObservationResult {
  success: boolean;
  status: ExecutionStatus;
  settlementConfirmed: boolean;
  normalized: NormalizedRealizedExecution;
  error?: string;
}

function isAddress(value: string | undefined): value is string {
  return !!value && ethers.utils.isAddress(value);
}

function finitePositive(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : null;
}

function parseBaseUnits(value: string | undefined, label: string): BigNumber | null {
  if (value === undefined) return null;
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a non-negative integer string`);
  return BigNumber.from(value);
}

function formatBaseUnits(amount: BigNumber, decimals: number | undefined): number | null {
  if (decimals === undefined || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const parsed = Number(ethers.utils.formatUnits(amount, decimals));
  return Number.isFinite(parsed) ? parsed : null;
}

function decodeTokenTransfers(receipt: providers.TransactionReceipt, walletAddress: string): Array<{ token: string; direction: 'in' | 'out'; amount: string }> {
  const wallet = walletAddress.toLowerCase();
  const transfers: Array<{ token: string; direction: 'in' | 'out'; amount: string }> = [];
  for (const log of receipt.logs) {
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || log.topics.length < 3) continue;
    try {
      const parsed = TRANSFER_INTERFACE.parseLog(log);
      const from = String(parsed.args.from).toLowerCase();
      const to = String(parsed.args.to).toLowerCase();
      const amount = BigNumber.from(parsed.args.value).toString();
      if (from === wallet) transfers.push({ token: log.address, direction: 'out', amount });
      if (to === wallet) transfers.push({ token: log.address, direction: 'in', amount });
    } catch {
      logger.debug('[DEX Settlement] Ignoring undecodable transfer log', {
        component: 'DexSettlementObserver',
        transactionHash: receipt.transactionHash,
        token: log.address,
      });
    }
  }
  return transfers;
}

async function readTokenBalance(
  provider: providers.Provider,
  token: string,
  walletAddress: string,
  blockTag: number,
): Promise<BigNumber | null> {
  try {
    const data = ERC20_INTERFACE.encodeFunctionData('balanceOf', [walletAddress]);
    const result = await provider.call({ to: token, data }, blockTag);
    return ERC20_INTERFACE.decodeFunctionResult('balanceOf', result)[0] as BigNumber;
  } catch {
    return null;
  }
}

async function measureBalanceDeltas(
  provider: providers.Provider,
  receipt: providers.TransactionReceipt,
  walletAddress: string,
  tokenIn: string | undefined,
  tokenOut: string | undefined,
): Promise<Array<{ token: string; direction: 'in' | 'out'; amount: string }>> {
  if (receipt.blockNumber <= 0) return [];
  const tokens = [...new Set([tokenIn, tokenOut].filter(isAddress).map(token => token!.toLowerCase()))];
  const deltas = await Promise.all(tokens.map(async token => {
    const [before, after] = await Promise.all([
      readTokenBalance(provider, token, walletAddress, receipt.blockNumber - 1),
      readTokenBalance(provider, token, walletAddress, receipt.blockNumber),
    ]);
    if (!before || !after || before.eq(after)) return null;
    return after.gt(before)
      ? { token, direction: 'in' as const, amount: after.sub(before).toString() }
      : { token, direction: 'out' as const, amount: before.sub(after).toString() };
  }));
  return deltas.filter((delta): delta is { token: string; direction: 'in' | 'out'; amount: string } => delta !== null);
}

function emptyEconomics(): RealizedExecutionEconomics {
  return {
    acquisitionCostUsd: null,
    proceedsUsd: null,
    exchangeFeeUsd: null,
    gasUsd: null,
    gasUsed: null,
    effectiveGasPriceWei: null,
    slippageBps: null,
    netProfitUsd: null,
  };
}

function unresolvedResult(request: DexSettlementObservationRequest, error: string): DexSettlementObservationResult {
  const normalized: NormalizedRealizedExecution = {
    status: 'settlement_unknown',
    terminal: false,
    settlementConfirmed: false,
    submittedAt: request.now ? request.now() : Date.now(),
    settledAt: null,
    venueOrRoute: request.plan?.legs.map(leg => leg.protocol).join('->') || 'dex',
    chain: request.chain,
    predicted: {
      profitUsd: request.predictedProfitUsd ?? null,
      feeUsd: request.predictedFeeUsd ?? null,
      slippageBps: request.predictedSlippageBps ?? null,
    },
    realized: emptyEconomics(),
    provenance: ['rpc:receipt_unavailable'],
    transactionHash: request.txHash,
    error,
  };
  return { success: false, status: 'settlement_unknown', settlementConfirmed: false, normalized, error };
}

function calculateEconomics(
  request: DexSettlementObservationRequest,
  receipt: providers.TransactionReceipt,
  tokenAmounts: Array<{ token: string; direction: 'in' | 'out'; amount: string }>,
  nativeValueWei: BigNumber,
  inputTokenDecimals: number | undefined,
  outputTokenDecimals: number | undefined,
): RealizedExecutionEconomics {
  const inputToken = isAddress(request.tokenIn) ? request.tokenIn.toLowerCase() : undefined;
  const outputToken = isAddress(request.tokenOut) ? request.tokenOut.toLowerCase() : undefined;
  const expectedOutput = parseBaseUnits(request.expectedOutputAmountBaseUnits, 'expectedOutputAmountBaseUnits');
  const inputTransfers = tokenAmounts
    .filter(transfer => transfer.direction === 'out' && (!inputToken || transfer.token.toLowerCase() === inputToken))
    .reduce((sum, transfer) => sum.add(BigNumber.from(transfer.amount)), BigNumber.from(0));
  const outputTransfers = tokenAmounts
    .filter(transfer => transfer.direction === 'in' && (!outputToken || transfer.token.toLowerCase() === outputToken))
    .reduce((sum, transfer) => sum.add(BigNumber.from(transfer.amount)), BigNumber.from(0));
  const measuredInput = inputTransfers.gt(0) ? inputTransfers : inputToken === undefined && nativeValueWei.gt(0) ? nativeValueWei : null;
  const measuredOutput = outputTransfers.gt(0) ? outputTransfers : null;
  const inputUnits = measuredInput ? formatBaseUnits(measuredInput, inputTokenDecimals ?? (inputToken === undefined ? 18 : undefined)) : null;
  const outputUnits = measuredOutput ? formatBaseUnits(measuredOutput, outputTokenDecimals) : null;
  const inputPriceUsd = finitePositive(request.prices?.inputTokenPriceUsd);
  const outputPriceUsd = finitePositive(request.prices?.outputTokenPriceUsd);
  const nativePriceUsd = finitePositive(request.prices?.nativeTokenPriceUsd);
  const gasUsed = receipt.gasUsed?.toString() || null;
  const effectiveGasPriceWei = receipt.effectiveGasPrice?.toString() || null;
  const gasWei = receipt.gasUsed && receipt.effectiveGasPrice ? receipt.gasUsed.mul(receipt.effectiveGasPrice) : null;
  const gasNative = gasWei ? formatBaseUnits(gasWei, 18) : null;
  const gasUsd = gasNative !== null && nativePriceUsd !== null ? gasNative * nativePriceUsd : null;
  const acquisitionCostUsd = inputUnits !== null && inputPriceUsd !== null ? inputUnits * inputPriceUsd : null;
  const proceedsUsd = outputUnits !== null && outputPriceUsd !== null ? outputUnits * outputPriceUsd : null;
  const expectedOutputUnits = expectedOutput ? formatBaseUnits(expectedOutput, outputTokenDecimals) : null;
  const slippageBps = expectedOutputUnits !== null && expectedOutputUnits > 0 && outputUnits !== null
    ? Math.max(0, ((expectedOutputUnits - outputUnits) / expectedOutputUnits) * 10000)
    : null;
  const netProfitUsd = acquisitionCostUsd !== null && proceedsUsd !== null && gasUsd !== null
    ? proceedsUsd - acquisitionCostUsd - gasUsd
    : null;
  return {
    acquisitionCostUsd,
    proceedsUsd,
    exchangeFeeUsd: null,
    gasUsd,
    gasUsed,
    effectiveGasPriceWei,
    slippageBps,
    netProfitUsd,
  };
}

export class DexSettlementObserver {
  constructor(private readonly provider: providers.Provider) {}

  private async resolveTokenDecimals(token: string | undefined, configured: number | undefined): Promise<number | undefined> {
    if (configured !== undefined) return configured;
    if (!token) return 18;
    try {
      const contract = new ethers.Contract(token, ERC20_INTERFACE, this.provider);
      const decimals = Number(await contract.decimals());
      return Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : undefined;
    } catch (error) {
      logger.warn('[DEX Settlement] Token decimals unavailable', {
        component: 'DexSettlementObserver',
        token,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  async observe(request: DexSettlementObservationRequest): Promise<DexSettlementObservationResult> {
    if (!ethers.utils.isHexString(request.txHash, 32)) throw new Error('DEX settlement observer requires a 32-byte transaction hash');
    if (!ethers.utils.isAddress(request.walletAddress)) throw new Error('DEX settlement observer requires a valid wallet address');
    if (request.tokenIn !== undefined && !ethers.utils.isAddress(request.tokenIn)) throw new Error('tokenIn must be a valid token address');
    if (request.tokenOut !== undefined && !ethers.utils.isAddress(request.tokenOut)) throw new Error('tokenOut must be a valid token address');
    parseBaseUnits(request.inputAmountBaseUnits, 'inputAmountBaseUnits');
    parseBaseUnits(request.expectedOutputAmountBaseUnits, 'expectedOutputAmountBaseUnits');

    const now = request.now || Date.now;
    const sleep = request.sleep || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    const timeoutMs = Math.max(0, request.confirmationTimeoutMs ?? Math.max(1000, Number(process.env.CRYPTO_DEX_SETTLEMENT_TIMEOUT_MS || 30000)));
    const pollIntervalMs = Math.max(0, request.pollIntervalMs ?? Math.max(100, Number(process.env.CRYPTO_DEX_SETTLEMENT_POLL_INTERVAL_MS || 1000)));
    const deadline = now() + timeoutMs;
    let receipt: providers.TransactionReceipt | null = null;
    let lastError = 'transaction receipt was not available before the settlement deadline';
    while (now() <= deadline) {
      try {
        receipt = await this.provider.getTransactionReceipt(request.txHash);
        if (receipt) break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (now() >= deadline) break;
      await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
    }
    if (!receipt) return unresolvedResult(request, lastError);

    let nativeValueWei = BigNumber.from(0);
    try {
      const transaction = await this.provider.getTransaction(request.txHash);
      if (transaction?.from?.toLowerCase() === request.walletAddress.toLowerCase() && transaction.value) {
        nativeValueWei = transaction.value;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    const transferAmounts = decodeTokenTransfers(receipt, request.walletAddress);
    const tokenAmounts = transferAmounts.length > 0
      ? transferAmounts
      : await measureBalanceDeltas(this.provider, receipt, request.walletAddress, request.tokenIn, request.tokenOut);
    const inputTokenDecimals = await this.resolveTokenDecimals(request.tokenIn, request.inputTokenDecimals);
    const outputTokenDecimals = await this.resolveTokenDecimals(request.tokenOut, request.outputTokenDecimals);
    const successful = receipt.status === 1;
    const status: ExecutionStatus = successful ? 'filled' : 'failed';
    const economics = successful ? calculateEconomics(request, receipt, tokenAmounts, nativeValueWei, inputTokenDecimals, outputTokenDecimals) : emptyEconomics();
    const normalized: NormalizedRealizedExecution = {
      status,
      terminal: true,
      settlementConfirmed: successful,
      submittedAt: request.now ? request.now() : Date.now(),
      settledAt: receipt.blockNumber > 0 ? Date.now() : null,
      venueOrRoute: request.plan?.legs.map(leg => leg.protocol).join('->') || 'dex',
      chain: request.chain,
      predicted: {
        profitUsd: request.predictedProfitUsd ?? null,
        feeUsd: request.predictedFeeUsd ?? null,
        slippageBps: request.predictedSlippageBps ?? null,
      },
      realized: economics,
      provenance: [
        'rpc:transaction_receipt',
        ...(transferAmounts.length > 0 ? ['erc20:transfer_logs'] : ['erc20:transfer_logs_missing']),
        ...(transferAmounts.length === 0 && tokenAmounts.length > 0 ? ['erc20:balance_delta'] : []),
        ...(economics.gasUsed !== null ? ['receipt:gas_used'] : []),
        ...(economics.netProfitUsd !== null ? ['priced:realized_usd'] : ['priced:realized_usd_incomplete']),
      ],
      transactionHash: request.txHash,
      receiptStatus: successful ? 1 : 0,
      tokenAmounts: tokenAmounts.map(transfer => ({
        ...transfer,
        decimals: transfer.token.toLowerCase() === request.tokenIn?.toLowerCase() ? inputTokenDecimals :
          transfer.token.toLowerCase() === request.tokenOut?.toLowerCase() ? outputTokenDecimals : undefined,
      })),
      error: successful ? lastError !== 'transaction receipt was not available before the settlement deadline' ? lastError : undefined : 'transaction reverted on-chain',
    };
    logger.info('[DEX Settlement] Normalized on-chain settlement', {
      component: 'DexSettlementObserver',
      chain: request.chain,
      transactionHash: request.txHash,
      status,
      settlementConfirmed: successful,
      tokenTransferCount: tokenAmounts.length,
      realizedProfitUsd: economics.netProfitUsd,
      gasUsd: economics.gasUsd,
    });
    return {
      success: successful,
      status,
      settlementConfirmed: successful,
      normalized,
      error: normalized.error,
    };
  }
}