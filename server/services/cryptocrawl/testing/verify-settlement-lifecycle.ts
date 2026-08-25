import assert from 'node:assert/strict';
import { BigNumber, ethers, providers } from 'ethers';
import { executeCexPlan, type CexSettlementAdapter } from '../execution/cex-settlement.js';
import { DexSettlementObserver } from '../execution/dex-settlement-observer.js';
import type { NormalizedOrderSettlement } from '../execution/settlement-types.js';
import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { getCryptara, type CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { stageManager } from '../governance/stage-management.js';

const WALLET = '0x0000000000000000000000000000000000000001';
const ROUTER = '0x0000000000000000000000000000000000000002';
const POOL = '0x0000000000000000000000000000000000000003';
const TOKEN_IN = '0x0000000000000000000000000000000000000011';
const TOKEN_OUT = '0x0000000000000000000000000000000000000012';

function cexPlan(): VerifiedArbitragePlan {
  return {
    symbol: 'ETHUSDT',
    notionalUsd: 10_000,
    buyVenue: 'kraken',
    sellVenue: 'okx',
    buyAsk: 100,
    sellBid: 101,
    baseQty: 100,
    grossProfitUsd: 100,
    netProfitUsd: 80,
    spreadPct: 1,
    costs: { buyFeeUsd: 10, sellFeeUsd: 10, gasUsd: 0, bridgeFeeUsd: 0, totalCostsUsd: 20 },
    quoteAgeMs: 50,
    requestedNotionalUsd: 10_000,
    executableNotionalUsd: 10_000,
    expectedSlippageBps: 5,
    expectedPriceImpactBps: 2,
    liquidity: { status: 'measured', buyAvailableBaseQty: 100, sellAvailableBaseQty: 100, source: ['test'] },
  };
}

function orderSettlement(input: {
  venue: 'kraken' | 'okx';
  side: 'buy' | 'sell';
  status: NormalizedOrderSettlement['status'];
  terminal: boolean;
  quantity: number;
  price: number | null;
  fee: number | null;
  feeAsset?: string | null;
}): NormalizedOrderSettlement {
  return {
    venue: input.venue,
    orderId: `${input.venue}-${input.side}`,
    symbol: 'ETHUSDT',
    side: input.side,
    status: input.status,
    terminal: input.terminal,
    requestedQuantity: 100,
    filledQuantity: input.quantity,
    remainingQuantity: 100 - input.quantity,
    averageFillPrice: input.price,
    fills: input.quantity > 0 && input.price !== null ? [{ quantity: input.quantity, price: input.price, feeAmount: input.fee, feeAsset: input.feeAsset || 'USDT', timestamp: 1000 }] : [],
    feeAmount: input.fee,
    feeAsset: input.feeAsset || 'USDT',
    submittedAt: 900,
    terminalAt: input.terminal ? 1000 : null,
  };
}

function adapterFor(states: {
  buy: NormalizedOrderSettlement;
  sell: NormalizedOrderSettlement;
}): CexSettlementAdapter {
  return {
    async submit(request) {
      return {
        venue: request.side === 'buy' ? 'kraken' : 'okx',
        orderId: `${request.side}-order`,
        symbol: request.symbol,
        side: request.side,
        requestedQuantity: request.quantity,
        submittedAt: 900,
      };
    },
    async query(order) {
      return order.side === 'buy' ? states.buy : states.sell;
    },
    async cancel() {},
  };
}

function sequencedAdapterFor(states: {
  buy: NormalizedOrderSettlement[];
  sell: NormalizedOrderSettlement[];
}): CexSettlementAdapter {
  const queryCounts = new Map<string, number>();
  return {
    async submit(request) {
      return {
        venue: request.side === 'buy' ? 'kraken' : 'okx',
        orderId: `${request.side}-order`,
        symbol: request.symbol,
        side: request.side,
        requestedQuantity: request.quantity,
        submittedAt: 900,
      };
    },
    async query(order) {
      const key = order.side;
      const index = queryCounts.get(key) || 0;
      queryCounts.set(key, index + 1);
      const sequence = order.side === 'buy' ? states.buy : states.sell;
      return sequence[Math.min(index, sequence.length - 1)];
    },
    async cancel() {},
  };
}

function transferLog(token: string, from: string, to: string, amount: string): providers.Log {
  const iface = new ethers.utils.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
  const encoded = iface.encodeEventLog('Transfer', [from, to, amount]);
  return {
    address: token,
    topics: encoded.topics,
    data: encoded.data,
    blockNumber: 10,
    transactionIndex: 0,
    removed: false,
    logIndex: 0,
    blockHash: `0x${'1'.repeat(64)}`,
    transactionHash: `0x${'2'.repeat(64)}`,
  };
}

export async function verifySettlementLifecycle(): Promise<void> {
  const fullAdapter = adapterFor({
      buy: orderSettlement({ venue: 'kraken', side: 'buy', status: 'filled', terminal: true, quantity: 100, price: 100, fee: 10 }),
      sell: orderSettlement({ venue: 'okx', side: 'sell', status: 'filled', terminal: true, quantity: 100, price: 101, fee: 10 }),
    });
  const full = await executeCexPlan(cexPlan(), {
    adapters: { kraken: fullAdapter, okx: fullAdapter },
    settlementTimeoutMs: 0,
    sleep: async () => {},
  });
  assert.equal(full.status, 'filled');
  assert.equal(full.success, true);
  assert.equal(full.settlementConfirmed, true);
  assert.equal(full.normalized?.realized.netProfitUsd, 80);
  assert.equal(full.normalized?.predicted.profitUsd, 80);
  assert.equal(full.normalized?.realized.exchangeFeeUsd, 20);

  const rebate = await executeCexPlan(cexPlan(), {
    adapters: {
      kraken: adapterFor({
        buy: orderSettlement({ venue: 'kraken', side: 'buy', status: 'filled', terminal: true, quantity: 100, price: 100, fee: -10 }),
        sell: orderSettlement({ venue: 'okx', side: 'sell', status: 'filled', terminal: true, quantity: 100, price: 101, fee: 10 }),
      }),
      okx: adapterFor({
        buy: orderSettlement({ venue: 'kraken', side: 'buy', status: 'filled', terminal: true, quantity: 100, price: 100, fee: -10 }),
        sell: orderSettlement({ venue: 'okx', side: 'sell', status: 'filled', terminal: true, quantity: 100, price: 101, fee: 10 }),
      }),
    },
    settlementTimeoutMs: 0,
    sleep: async () => {},
  });
  assert.equal(rebate.normalized?.realized.exchangeFeeUsd, 0);
  assert.equal(rebate.normalized?.realized.netProfitUsd, 100);

  let polledNow = 900;
  const polled = await executeCexPlan(cexPlan(), {
    adapters: {
      kraken: sequencedAdapterFor({
        buy: [
          orderSettlement({ venue: 'kraken', side: 'buy', status: 'submitted', terminal: false, quantity: 0, price: null, fee: null }),
          orderSettlement({ venue: 'kraken', side: 'buy', status: 'filled', terminal: true, quantity: 100, price: 100, fee: 10 }),
        ],
        sell: [],
      }),
      okx: sequencedAdapterFor({
        buy: [],
        sell: [
          orderSettlement({ venue: 'okx', side: 'sell', status: 'submitted', terminal: false, quantity: 0, price: null, fee: null }),
          orderSettlement({ venue: 'okx', side: 'sell', status: 'filled', terminal: true, quantity: 100, price: 101, fee: 10 }),
        ],
      }),
    },
    settlementTimeoutMs: 1,
    pollIntervalMs: 1,
    now: () => polledNow,
    sleep: async milliseconds => { polledNow += Math.max(1, milliseconds); },
  });
  assert.equal(polled.status, 'filled');
  assert.equal(polled.settlementConfirmed, true);

  const partialAdapter = adapterFor({
      buy: orderSettlement({ venue: 'kraken', side: 'buy', status: 'partially_filled', terminal: true, quantity: 50, price: 100, fee: 5 }),
      sell: orderSettlement({ venue: 'okx', side: 'sell', status: 'partially_filled', terminal: true, quantity: 50, price: 101, fee: 5 }),
    });
  const partial = await executeCexPlan(cexPlan(), {
    adapters: { kraken: partialAdapter, okx: partialAdapter },
    settlementTimeoutMs: 0,
    sleep: async () => {},
  });
  assert.equal(partial.status, 'partially_filled');
  assert.equal(partial.success, false);
  assert.equal(partial.settlementConfirmed, true);
  assert.equal(partial.normalized?.realized.netProfitUsd, 40);

  const rejectedAdapter = adapterFor({
      buy: orderSettlement({ venue: 'kraken', side: 'buy', status: 'rejected', terminal: true, quantity: 0, price: null, fee: null }),
      sell: orderSettlement({ venue: 'okx', side: 'sell', status: 'cancelled', terminal: true, quantity: 0, price: null, fee: null }),
    });
  const rejected = await executeCexPlan(cexPlan(), {
    adapters: { kraken: rejectedAdapter, okx: rejectedAdapter },
    settlementTimeoutMs: 0,
    sleep: async () => {},
  });
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.settlementConfirmed, true);
  assert.equal(rejected.normalized?.realized.netProfitUsd, null);

  const unknownAdapter: CexSettlementAdapter = {
    async submit(request) {
      return { venue: 'kraken', orderId: `${request.side}-order`, symbol: request.symbol, side: request.side, requestedQuantity: request.quantity, submittedAt: 900 };
    },
    async query(order) {
      return orderSettlement({ venue: order.venue, side: order.side, status: 'submitted', terminal: false, quantity: 0, price: null, fee: null });
    },
    async cancel() {},
  };
  const unknown = await executeCexPlan(cexPlan(), {
    adapters: { kraken: unknownAdapter, okx: unknownAdapter },
    settlementTimeoutMs: 0,
    sleep: async () => {},
  });
  assert.equal(unknown.status, 'settlement_unknown');
  assert.equal(unknown.settlementConfirmed, false);
  assert.equal(unknown.normalized?.terminal, false);
  assert.equal(unknown.normalized?.realized.netProfitUsd, null);

  const txHash = `0x${'2'.repeat(64)}`;
  const inputAmount = BigNumber.from('1000000000000000000');
  const outputAmount = BigNumber.from('1010000000000000000');
  const receipt = {
    transactionHash: txHash,
    blockNumber: 10,
    status: 1,
    gasUsed: BigNumber.from(21_000),
    effectiveGasPrice: BigNumber.from(1_000_000_000),
    logs: [
      transferLog(TOKEN_IN, WALLET, ROUTER, inputAmount.toString()),
      transferLog(TOKEN_OUT, POOL, WALLET, outputAmount.toString()),
    ],
  } as unknown as providers.TransactionReceipt;
  const provider = {
    async getTransactionReceipt() { return receipt; },
    async getTransaction() { return { from: WALLET, value: BigNumber.from(0) }; },
  } as unknown as providers.Provider;
  const dex = await new DexSettlementObserver(provider).observe({
    txHash,
    chain: 'polygon',
    walletAddress: WALLET,
    tokenIn: TOKEN_IN,
    tokenOut: TOKEN_OUT,
    inputTokenDecimals: 18,
    outputTokenDecimals: 18,
    prices: { inputTokenPriceUsd: 100, outputTokenPriceUsd: 100, nativeTokenPriceUsd: 2_000 },
    expectedOutputAmountBaseUnits: '1020000000000000000',
    confirmationTimeoutMs: 0,
    sleep: async () => {},
  });
  assert.equal(dex.status, 'filled');
  assert.equal(dex.settlementConfirmed, true);
  assert.equal(dex.normalized.realized.gasUsd, 0.042);
  assert.equal(Number(dex.normalized.realized.netProfitUsd?.toFixed(3)), 0.958);
  assert.equal(dex.normalized.tokenAmounts?.length, 2);

  const reverted = await new DexSettlementObserver({
    async getTransactionReceipt() { return { ...receipt, status: 0, logs: [] } as unknown as providers.TransactionReceipt; },
    async getTransaction() { return { from: WALLET, value: BigNumber.from(0) }; },
  } as unknown as providers.Provider).observe({
    txHash,
    chain: 'polygon',
    walletAddress: WALLET,
    tokenIn: TOKEN_IN,
    tokenOut: TOKEN_OUT,
    inputTokenDecimals: 18,
    outputTokenDecimals: 18,
    confirmationTimeoutMs: 0,
    sleep: async () => {},
  });
  assert.equal(reverted.status, 'failed');
  assert.equal(reverted.settlementConfirmed, false);
  assert.equal(reverted.normalized.realized.netProfitUsd, null);

  const incompleteAssessment = await getCryptara().assessOpportunity({
    opportunityId: `missing-monte-carlo-${Date.now()}`,
    observedAt: Date.now(),
    chain: 'cex',
    symbol: 'ETHUSDT',
    plan: cexPlan(),
    tradingView: null,
    mempool: null,
    marketUniverse: [],
    dexObservation: null,
    missingInformation: [],
    provenance: [],
  });
  assert.equal(incompleteAssessment.monteCarlo, null);
  assert.equal(incompleteAssessment.probabilityOfProfitableExecution, null);
  assert.ok(incompleteAssessment.missingInformation.includes('monte_carlo_evidence'));

  const feedback: CryptaraExecutionFeedback = {
    source: 'manual',
    opportunityId: `terminal-rejection-${Date.now()}`,
    chain: 'cex',
    symbol: 'ETHUSDT',
    strategy: 'verified_cex_arbitrage',
    success: false,
    expectedProfitUsd: 80,
    realizedProfitUsd: null,
    feeUsd: null,
    slippageBps: null,
    latencyMs: 120,
    usedZeroCapital: false,
    timestamp: Date.now(),
    settlementStatus: 'rejected',
    settlementConfirmed: true,
    provenance: ['kraken:authenticated_order_query'],
    settlement: {
      status: 'rejected',
      terminal: true,
      settlementConfirmed: true,
      submittedAt: 900,
      settledAt: 1020,
      venueOrRoute: 'kraken->okx',
      chain: 'cex',
      predicted: { profitUsd: 80, feeUsd: 20, slippageBps: 5 },
      realized: {
        acquisitionCostUsd: null,
        proceedsUsd: null,
        exchangeFeeUsd: null,
        gasUsd: null,
        gasUsed: null,
        effectiveGasPriceWei: null,
        slippageBps: null,
        netProfitUsd: null,
      },
      provenance: ['kraken:authenticated_order_query'],
    },
  };
  const historyBefore = getCryptara().getExecutionHistory().length;
  const stageEvidenceBefore = stageManager.getState().cryptaraExecutionEvidence.length;
  await recordCryptaraExecutionEvidence(feedback);
  assert.equal(getCryptara().getExecutionHistory().length, historyBefore + 1);
  assert.equal(stageManager.getState().cryptaraExecutionEvidence.length, stageEvidenceBefore + 1);
  assert.equal(stageManager.getState().cryptaraExecutionEvidence.at(-1)?.realizedProfitUsd, null);
}

if (process.argv[1]?.endsWith('/verify-settlement-lifecycle.ts')) {
  verifySettlementLifecycle()
    .then(() => console.log('Settlement lifecycle verification passed'))
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}