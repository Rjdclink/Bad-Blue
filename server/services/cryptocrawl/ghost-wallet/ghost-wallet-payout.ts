import { BigNumber, Contract, ethers, providers, type Wallet } from 'ethers';
import { zeroCapitalEngine } from '../core/zero-capital-engine.js';
import {
  resolvePayoutFallbackAddress,
  resolvePrimaryProfitPayoutAddress,
} from '../core/wallet-identity.js';

const ETHEREUM_CHAIN_ID = 1;
const ZERO_ADDRESS = ethers.constants.AddressZero;
const WETH_MAINNET = ethers.utils.getAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
const UNISWAP_V3_ROUTER = ethers.utils.getAddress('0xE592427A0AEce92De3Edee1F18E0157C05861564');
const UNISWAP_V3_QUOTER = ethers.utils.getAddress('0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6');
const SUSHISWAP_V2_ROUTER = ethers.utils.getAddress('0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F');
const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function approve(address spender,uint256 amount) returns (bool)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
];
const WETH_ABI = [
  ...ERC20_ABI,
  'function withdraw(uint256 wad)',
  'event Withdrawal(address indexed src,uint256 wad)',
];
const UNI_QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96) returns (uint256 amountOut)',
];
const UNI_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
];
const SUSHI_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn,address[] path) view returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline) returns (uint256[] amounts)',
];

const TRANSFER_TOPIC = ethers.utils.id('Transfer(address,address,uint256)');
const WITHDRAWAL_TOPIC = ethers.utils.id('Withdrawal(address,uint256)');

type SponsoredRuntime = {
  getGasFundingDecision: (chain: any) => Promise<{
    mode: 'sponsored' | 'native' | 'unavailable';
    paymentSource?: string;
    strictZeroInitialCapitalEligible?: boolean;
    operatorMonetaryInputRequired?: boolean;
    sponsorOperatorMonetaryCostProvenZero?: boolean;
    reason?: string;
  }>;
  gasSponsor: {
    execute: (input: {
      wallet: Wallet;
      chainId: number;
      calls: Array<{ to: string; data: string; value?: BigNumber }>;
      timeoutMs: number;
    }) => Promise<{ transactionHash: string }>;
  };
};

export interface GhostWalletProfitConversionPayload {
  sourceTransactionHash: string;
  sourceBlockNumber?: number | null;
  chain: string;
  asset: string;
  amountBaseUnits: string;
  destinationMode?: 'primary' | 'fallback';
  sourceKind?: string;
}

export interface GhostWalletPayoutSubmission {
  state: 'submitted';
  transactionHash: string;
  result: Record<string, unknown>;
  retryAfterMs: number;
}

export interface GhostWalletPayoutSettled {
  state: 'settled';
  transactionHash: string;
  blockNumber: number | null;
  payoutTransactionHash: string;
  payoutDestinationMode: 'primary' | 'fallback';
  destination: string;
  ethAmountWei: bigint;
  result: Record<string, unknown>;
  followUp?: GhostWalletProfitConversionPayload;
}

export interface GhostWalletPayoutFallbackRequired {
  state: 'fallback_required';
  reason: string;
  payload: GhostWalletProfitConversionPayload;
}

export type GhostWalletPayoutResult = GhostWalletPayoutSubmission | GhostWalletPayoutSettled | GhostWalletPayoutFallbackRequired;

function asBigInt(value: unknown): bigint {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) throw new Error('GHOST_WALLET_PAYOUT_AMOUNT_INVALID');
  const amount = BigInt(raw);
  if (amount <= 0n) throw new Error('GHOST_WALLET_PAYOUT_AMOUNT_MUST_BE_POSITIVE');
  return amount;
}

function normalizeChain(value: string): string {
  return value.trim().toLowerCase();
}

function validTxHash(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function payoutDestination(mode: 'primary' | 'fallback'): string {
  const primary = resolvePrimaryProfitPayoutAddress();
  if (!primary) throw new Error('GHOST_WALLET_PRIMARY_PAYOUT_UNAVAILABLE');
  if (mode === 'primary') return primary;
  const fallback = resolvePayoutFallbackAddress();
  if (!fallback) throw new Error('GHOST_WALLET_FALLBACK_PAYOUT_UNAVAILABLE');
  return fallback;
}

async function sponsoredRuntime(chain: string): Promise<{
  runtime: SponsoredRuntime;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  chainId: number;
}> {
  const normalized = normalizeChain(chain);
  const provider = zeroCapitalEngine.providers.get(normalized as any);
  const wallet = zeroCapitalEngine.executionWallets.get(normalized as any);
  if (!provider || !wallet) throw new Error(`GHOST_WALLET_PAYOUT_RUNTIME_UNAVAILABLE:${normalized}`);
  const runtime = zeroCapitalEngine as unknown as SponsoredRuntime;
  const funding = await runtime.getGasFundingDecision(normalized as any);
  const sponsoredFree = funding.mode === 'sponsored'
    && funding.paymentSource === 'provider_sponsored'
    && funding.strictZeroInitialCapitalEligible === true
    && funding.operatorMonetaryInputRequired === false
    && funding.sponsorOperatorMonetaryCostProvenZero === true;
  if (!sponsoredFree) throw new Error(`GHOST_WALLET_PAYOUT_SPONSOR_UNAVAILABLE:${funding.reason || funding.mode}`);
  const network = await provider.getNetwork();
  return { runtime, provider, wallet, chainId: network.chainId };
}

function slippageBps(expectedOut: bigint): bigint {
  // Exact quotes are refreshed on every attempt. A small execution tolerance is
  // not treated as cost; if the route moves beyond it the transaction fails and
  // the durable job requotes rather than accepting an unmeasured payout loss.
  if (expectedOut <= 0n) return 0n;
  const tolerance = 20n;
  return (expectedOut * (10_000n - tolerance)) / 10_000n;
}

function sumTransferTo(receipt: providers.TransactionReceipt, token: string, recipient: string): bigint {
  let total = 0n;
  const recipientTopic = ethers.utils.hexZeroPad(recipient, 32).toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== token.toLowerCase()) continue;
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC.toLowerCase()) continue;
    if (log.topics[2]?.toLowerCase() !== recipientTopic) continue;
    try { total += BigInt(ethers.BigNumber.from(log.data).toString()); } catch { /* ignore malformed */ }
  }
  return total;
}

function sumWethWithdrawal(receipt: providers.TransactionReceipt, source: string): bigint {
  let total = 0n;
  const sourceTopic = ethers.utils.hexZeroPad(source, 32).toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== WETH_MAINNET.toLowerCase()) continue;
    if (log.topics[0]?.toLowerCase() !== WITHDRAWAL_TOPIC.toLowerCase()) continue;
    if (log.topics[1]?.toLowerCase() !== sourceTopic) continue;
    try { total += BigInt(ethers.BigNumber.from(log.data).toString()); } catch { /* ignore malformed */ }
  }
  return total;
}

async function executeSponsoredCalls(input: {
  chain: string;
  calls: Array<{ to: string; data: string; value?: BigNumber }>;
  onSubmitted?: (transactionHash: string, result: Record<string, unknown>) => Promise<void>;
  result: Record<string, unknown>;
}): Promise<{ transactionHash: string; receipt: providers.TransactionReceipt }> {
  const { runtime, provider, wallet, chainId } = await sponsoredRuntime(input.chain);
  const sent = await runtime.gasSponsor.execute({
    wallet,
    chainId,
    calls: input.calls,
    timeoutMs: Math.max(10_000, Number(process.env.GHOST_WALLET_SPONSORED_TX_TIMEOUT_MS || 60_000)),
  });
  if (input.onSubmitted) await input.onSubmitted(sent.transactionHash, input.result);
  let receipt = await provider.getTransactionReceipt(sent.transactionHash);
  if (!receipt) receipt = await provider.waitForTransaction(sent.transactionHash, 1, 60_000);
  if (!receipt || receipt.status !== 1) throw new Error('GHOST_WALLET_PAYOUT_TRANSACTION_FAILED');
  return { transactionHash: sent.transactionHash, receipt };
}

async function bestEthereumWethQuote(provider: providers.JsonRpcProvider, asset: string, amount: bigint): Promise<{
  protocol: 'uniswap_v3' | 'sushiswap_v2';
  expectedOut: bigint;
  approvalTarget: string;
  swapData: string;
}> {
  const candidates: Array<{ protocol: 'uniswap_v3' | 'sushiswap_v2'; expectedOut: bigint; approvalTarget: string; swapData: string }> = [];
  const quoter = new Contract(UNISWAP_V3_QUOTER, UNI_QUOTER_ABI, provider);
  const uni = new ethers.utils.Interface(UNI_ROUTER_ABI);
  const deadline = Math.floor(Date.now() / 1000) + 120;

  await Promise.all([100, 500, 3000, 10000].map(async fee => {
    try {
      const quoted = await quoter.callStatic.quoteExactInputSingle(asset, WETH_MAINNET, fee, amount.toString(), 0);
      const expectedOut = BigInt(quoted.toString());
      if (expectedOut <= 0n) return;
      candidates.push({
        protocol: 'uniswap_v3',
        expectedOut,
        approvalTarget: UNISWAP_V3_ROUTER,
        swapData: uni.encodeFunctionData('exactInputSingle', [{
          tokenIn: asset,
          tokenOut: WETH_MAINNET,
          fee,
          recipient: resolvePrimaryProfitPayoutAddress(),
          deadline,
          amountIn: amount.toString(),
          amountOutMinimum: slippageBps(expectedOut).toString(),
          sqrtPriceLimitX96: 0,
        }]),
      });
    } catch { /* another live route may qualify */ }
  }));

  try {
    const sushi = new Contract(SUSHISWAP_V2_ROUTER, SUSHI_ROUTER_ABI, provider);
    const amounts = await sushi.getAmountsOut(amount.toString(), [asset, WETH_MAINNET]);
    const expectedOut = BigInt(amounts[amounts.length - 1].toString());
    if (expectedOut > 0n) {
      const iface = new ethers.utils.Interface(SUSHI_ROUTER_ABI);
      candidates.push({
        protocol: 'sushiswap_v2',
        expectedOut,
        approvalTarget: SUSHISWAP_V2_ROUTER,
        swapData: iface.encodeFunctionData('swapExactTokensForTokens', [
          amount.toString(),
          slippageBps(expectedOut).toString(),
          [asset, WETH_MAINNET],
          resolvePrimaryProfitPayoutAddress(),
          deadline,
        ]),
      });
    }
  } catch { /* no direct Sushi route */ }

  candidates.sort((a, b) => a.expectedOut === b.expectedOut ? 0 : a.expectedOut > b.expectedOut ? -1 : 1);
  const best = candidates[0];
  if (!best) throw new Error('GHOST_WALLET_ETHEREUM_CONVERSION_ROUTE_UNAVAILABLE');
  return best;
}

async function convertEthereumTokenToWeth(
  payload: GhostWalletProfitConversionPayload,
  onSubmitted?: (transactionHash: string, result: Record<string, unknown>) => Promise<void>,
): Promise<GhostWalletPayoutSettled> {
  const amount = asBigInt(payload.amountBaseUnits);
  const primary = payoutDestination('primary');
  const { provider, wallet } = await sponsoredRuntime('ethereum');
  const asset = ethers.utils.getAddress(payload.asset);
  if (asset.toLowerCase() === WETH_MAINNET.toLowerCase()) {
    return {
      state: 'settled', transactionHash: payload.sourceTransactionHash,
      blockNumber: payload.sourceBlockNumber ?? null,
      payoutTransactionHash: payload.sourceTransactionHash,
      payoutDestinationMode: payload.destinationMode || 'primary',
      destination: payoutDestination(payload.destinationMode || 'primary'),
      ethAmountWei: amount,
      result: { phase: 'weth_ready', sourceAssetAlreadyWeth: true },
      followUp: payload,
    };
  }

  const token = new Contract(asset, ERC20_ABI, provider);
  const balance = BigInt((await token.balanceOf(wallet.address)).toString());
  if (balance < amount) throw new Error('GHOST_WALLET_PROFIT_TOKEN_BALANCE_BELOW_DURABLE_SETTLEMENT_AMOUNT');
  const quote = await bestEthereumWethQuote(provider, asset, amount);
  const approve = new ethers.utils.Interface(ERC20_ABI).encodeFunctionData('approve', [quote.approvalTarget, amount.toString()]);
  const { transactionHash, receipt } = await executeSponsoredCalls({
    chain: 'ethereum',
    calls: [
      { to: asset, data: approve, value: BigNumber.from(0) },
      { to: quote.approvalTarget, data: quote.swapData, value: BigNumber.from(0) },
      { to: asset, data: new ethers.utils.Interface(ERC20_ABI).encodeFunctionData('approve', [quote.approvalTarget, 0]), value: BigNumber.from(0) },
    ],
    result: { phase: 'token_to_weth', protocol: quote.protocol, expectedWethWei: quote.expectedOut.toString() },
    onSubmitted,
  });
  const acquired = sumTransferTo(receipt, WETH_MAINNET, primary);
  if (acquired < slippageBps(quote.expectedOut) || acquired <= 0n) {
    throw new Error('GHOST_WALLET_WETH_ACQUISITION_NOT_TERMINALLY_VERIFIED');
  }
  return {
    state: 'settled',
    transactionHash,
    blockNumber: receipt.blockNumber ?? null,
    payoutTransactionHash: transactionHash,
    payoutDestinationMode: payload.destinationMode || 'primary',
    destination: payoutDestination(payload.destinationMode || 'primary'),
    ethAmountWei: acquired,
    result: { phase: 'weth_ready', protocol: quote.protocol, acquiredWethWei: acquired.toString() },
    followUp: {
      sourceTransactionHash: transactionHash,
      sourceBlockNumber: receipt.blockNumber ?? null,
      chain: 'ethereum',
      asset: WETH_MAINNET,
      amountBaseUnits: acquired.toString(),
      destinationMode: payload.destinationMode || 'primary',
      sourceKind: 'ghost_wallet_weth_unwrap',
    },
  };
}

async function unwrapWethToEth(
  payload: GhostWalletProfitConversionPayload,
  onSubmitted?: (transactionHash: string, result: Record<string, unknown>) => Promise<void>,
): Promise<GhostWalletPayoutSettled> {
  const amount = asBigInt(payload.amountBaseUnits);
  const mode = payload.destinationMode || 'primary';
  const destination = payoutDestination(mode);
  const { provider, wallet } = await sponsoredRuntime('ethereum');
  const weth = new Contract(WETH_MAINNET, WETH_ABI, provider);
  const balance = BigInt((await weth.balanceOf(wallet.address)).toString());
  if (balance < amount) throw new Error('GHOST_WALLET_WETH_BALANCE_BELOW_DURABLE_PAYOUT_AMOUNT');
  const iface = new ethers.utils.Interface(WETH_ABI);
  const beforeDestination = await provider.getBalance(destination);
  const calls: Array<{ to: string; data: string; value?: BigNumber }> = [
    { to: WETH_MAINNET, data: iface.encodeFunctionData('withdraw', [amount.toString()]), value: BigNumber.from(0) },
  ];
  if (mode === 'fallback') calls.push({ to: destination, data: '0x', value: BigNumber.from(amount.toString()) });
  const { transactionHash, receipt } = await executeSponsoredCalls({
    chain: 'ethereum', calls,
    result: { phase: 'weth_to_native_eth', destinationMode: mode, amountWei: amount.toString() }, onSubmitted,
  });
  const unwrapped = sumWethWithdrawal(receipt, wallet.address);
  if (unwrapped !== amount) throw new Error('GHOST_WALLET_WETH_WITHDRAWAL_EVENT_MISMATCH');
  const afterDestination = await provider.getBalance(destination);
  if (BigInt(afterDestination.toString()) < BigInt(beforeDestination.toString()) + amount) {
    throw new Error('GHOST_WALLET_NATIVE_ETH_DESTINATION_BALANCE_NOT_VERIFIED');
  }
  return {
    state: 'settled', transactionHash, blockNumber: receipt.blockNumber ?? null,
    payoutTransactionHash: transactionHash, payoutDestinationMode: mode,
    destination, ethAmountWei: amount,
    result: { phase: 'native_eth_delivered', destinationMode: mode, amountWei: amount.toString() },
  };
}

function acrossCredentials(): { apiKey: string; integratorId: string } {
  const apiKey = process.env.ACROSS_API_KEY?.trim();
  const integratorId = process.env.ACROSS_INTEGRATOR_ID?.trim();
  if (!apiKey || !integratorId || !/^0x[a-fA-F0-9]{4}$/.test(integratorId)) {
    throw new Error('GHOST_WALLET_ACROSS_EXISTING_CREDENTIALS_UNAVAILABLE');
  }
  return { apiKey, integratorId };
}

function parseAcrossCall(value: any, expectedChainId: number): { to: string; data: string; value: BigNumber } | null {
  if (!value || Number(value.chainId ?? expectedChainId) !== expectedChainId) return null;
  if (!ethers.utils.isAddress(String(value.to || '')) || !ethers.utils.isHexString(String(value.data || '0x'))) return null;
  try {
    return {
      to: ethers.utils.getAddress(String(value.to)),
      data: String(value.data || '0x'),
      value: BigNumber.from(String(value.value || '0')),
    };
  } catch { return null; }
}

async function submitAcrossNativeEthPayout(
  payload: GhostWalletProfitConversionPayload,
  onSubmitted?: (transactionHash: string, result: Record<string, unknown>) => Promise<void>,
): Promise<GhostWalletPayoutSubmission> {
  const amount = asBigInt(payload.amountBaseUnits);
  const mode = payload.destinationMode || 'primary';
  const destination = payoutDestination(mode);
  const { provider, wallet, chainId, runtime } = await sponsoredRuntime(payload.chain);
  if (chainId === ETHEREUM_CHAIN_ID) throw new Error('GHOST_WALLET_ACROSS_NOT_USED_FOR_SAME_CHAIN_ETHEREUM');
  const asset = ethers.utils.getAddress(payload.asset);
  const token = new Contract(asset, ERC20_ABI, provider);
  const balance = BigInt((await token.balanceOf(wallet.address)).toString());
  if (balance < amount) throw new Error('GHOST_WALLET_PROFIT_TOKEN_BALANCE_BELOW_DURABLE_SETTLEMENT_AMOUNT');
  const { apiKey, integratorId } = acrossCredentials();
  const params = new URLSearchParams({
    tradeType: 'exactInput',
    amount: amount.toString(),
    inputToken: asset,
    outputToken: ZERO_ADDRESS,
    originChainId: String(chainId),
    destinationChainId: String(ETHEREUM_CHAIN_ID),
    depositor: wallet.address,
    recipient: destination,
    refundAddress: wallet.address,
    integratorId,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let quote: any;
  try {
    const response = await fetch(`https://app.across.to/api/swap/approval?${params.toString()}`, {
      headers: { accept: 'application/json', Authorization: `Bearer ${apiKey}` }, signal: controller.signal,
    });
    const text = await response.text();
    quote = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(`GHOST_WALLET_ACROSS_QUOTE_FAILED:${response.status}:${String(quote?.message || '')}`);
  } finally {
    clearTimeout(timeout);
  }
  const expiry = Number(quote?.quoteExpiryTimestamp || 0) * 1_000;
  if (expiry > 0 && expiry <= Date.now()) throw new Error('GHOST_WALLET_ACROSS_QUOTE_EXPIRED');
  const swap = parseAcrossCall(quote?.swapTx, chainId);
  if (!swap || quote?.swapTx?.simulationSuccess !== true) throw new Error('GHOST_WALLET_ACROSS_SWAP_NOT_SIMULATION_VERIFIED');
  const approvals = (Array.isArray(quote?.approvalTxns) ? quote.approvalTxns : [])
    .map((row: any) => parseAcrossCall(row, chainId))
    .filter((row: any): row is { to: string; data: string; value: BigNumber } => Boolean(row));
  if (approvals.length !== (Array.isArray(quote?.approvalTxns) ? quote.approvalTxns.length : 0)) {
    throw new Error('GHOST_WALLET_ACROSS_APPROVAL_PAYLOAD_INVALID');
  }
  const expectedOutputAmount = String(quote?.expectedOutputAmount || quote?.minOutputAmount || '0');
  if (!/^\d+$/.test(expectedOutputAmount) || BigInt(expectedOutputAmount) <= 0n) {
    throw new Error('GHOST_WALLET_ACROSS_EXPECTED_ETH_INVALID');
  }
  const sent = await runtime.gasSponsor.execute({
    wallet,
    chainId,
    calls: [...approvals, swap],
    timeoutMs: Math.max(10_000, Number(process.env.GHOST_WALLET_SPONSORED_TX_TIMEOUT_MS || 60_000)),
  });
  const result = {
    phase: 'across_native_eth_submitted',
    originChainId: chainId,
    destinationChainId: ETHEREUM_CHAIN_ID,
    destination,
    destinationMode: mode,
    expectedEthWei: expectedOutputAmount,
    expectedFillTimeSec: Number(quote?.expectedFillTime || 0),
    quoteId: typeof quote?.id === 'string' ? quote.id : null,
  };
  if (onSubmitted) await onSubmitted(sent.transactionHash, result);
  return {
    state: 'submitted', transactionHash: sent.transactionHash, result,
    retryAfterMs: Math.max(1_000, Math.min(15_000, Number(quote?.expectedFillTime || 2) * 1_000)),
  };
}

async function reconcileAcrossNativeEthPayout(
  payload: GhostWalletProfitConversionPayload,
  transactionHash: string,
  priorResult: Record<string, unknown>,
): Promise<GhostWalletPayoutResult> {
  if (!validTxHash(transactionHash)) throw new Error('GHOST_WALLET_ACROSS_DEPOSIT_TX_INVALID');
  const mode = payload.destinationMode || 'primary';
  const destination = payoutDestination(mode);
  const { apiKey, integratorId } = acrossCredentials();
  const params = new URLSearchParams({ depositTxnRef: transactionHash, integratorId });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let status: any;
  try {
    const response = await fetch(`https://app.across.to/api/deposit/status?${params.toString()}`, {
      headers: { accept: 'application/json', Authorization: `Bearer ${apiKey}` }, signal: controller.signal,
    });
    const text = await response.text();
    status = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(`GHOST_WALLET_ACROSS_STATUS_FAILED:${response.status}`);
  } finally {
    clearTimeout(timeout);
  }
  const providerStatus = String(status?.status || '').toLowerCase();
  if (providerStatus === 'filled') {
    if (Number(status?.destinationChainId) !== ETHEREUM_CHAIN_ID) throw new Error('GHOST_WALLET_ACROSS_DESTINATION_CHAIN_MISMATCH');
    const fillTx = String(status?.fillTxnRef || status?.fillTx || '');
    const ethereumProvider = zeroCapitalEngine.providers.get('ethereum' as any);
    if (!ethereumProvider || !validTxHash(fillTx)) throw new Error('GHOST_WALLET_ACROSS_FILL_RECEIPT_UNAVAILABLE');
    const receipt = await ethereumProvider.getTransactionReceipt(fillTx);
    if (!receipt || receipt.status !== 1) throw new Error('GHOST_WALLET_ACROSS_FILL_NOT_TERMINALLY_VERIFIED');
    if (status?.actionsSucceeded === false) throw new Error('GHOST_WALLET_ACROSS_DESTINATION_ACTION_FAILED');
    const expected = asBigInt(priorResult.expectedEthWei);
    return {
      state: 'settled', transactionHash, blockNumber: receipt.blockNumber ?? null,
      payoutTransactionHash: fillTx, payoutDestinationMode: mode, destination,
      ethAmountWei: expected,
      result: { ...priorResult, phase: 'native_eth_delivered', providerStatus, fillTransactionHash: fillTx },
    };
  }
  if (providerStatus === 'refunded' || providerStatus === 'deposit-failed') {
    if (mode === 'primary') {
      const fallback = resolvePayoutFallbackAddress();
      if (fallback) {
        return {
          state: 'fallback_required',
          reason: `primary_across_delivery_${providerStatus}`,
          payload: { ...payload, destinationMode: 'fallback' },
        };
      }
    }
    throw new Error(`GHOST_WALLET_ACROSS_PAYOUT_TERMINAL_FAILURE:${providerStatus}`);
  }
  if (['expired','auto-refund-pending','refund-failed','manual-refund-required'].includes(providerStatus)) {
    throw new Error(`GHOST_WALLET_ACROSS_RECOVERY_PENDING:${providerStatus}`);
  }
  return { state: 'submitted', transactionHash, result: { ...priorResult, providerStatus }, retryAfterMs: 5_000 };
}

export async function processGhostWalletProfitConversion(input: {
  payload: GhostWalletProfitConversionPayload;
  submittedTransactionHash?: string | null;
  priorResult?: Record<string, unknown>;
  onSubmitted?: (transactionHash: string, result: Record<string, unknown>) => Promise<void>;
}): Promise<GhostWalletPayoutResult> {
  const payload = input.payload;
  const chain = normalizeChain(payload.chain);
  const asset = ethers.utils.getAddress(payload.asset);
  const amount = asBigInt(payload.amountBaseUnits);
  const mode = payload.destinationMode || 'primary';
  payoutDestination(mode);

  if (chain === 'ethereum') {
    if (asset.toLowerCase() === WETH_MAINNET.toLowerCase()) {
      if (input.submittedTransactionHash) {
        const provider = zeroCapitalEngine.providers.get('ethereum' as any);
        const wallet = zeroCapitalEngine.executionWallets.get('ethereum' as any);
        if (!provider || !wallet) throw new Error('GHOST_WALLET_ETHEREUM_RUNTIME_UNAVAILABLE');
        const receipt = await provider.getTransactionReceipt(input.submittedTransactionHash);
        if (!receipt) return { state: 'submitted', transactionHash: input.submittedTransactionHash, result: input.priorResult || {}, retryAfterMs: 1_000 };
        if (receipt.status !== 1 || sumWethWithdrawal(receipt, wallet.address) !== amount) throw new Error('GHOST_WALLET_WETH_UNWRAP_RECONCILIATION_FAILED');
        return {
          state: 'settled', transactionHash: input.submittedTransactionHash,
          blockNumber: receipt.blockNumber ?? null, payoutTransactionHash: input.submittedTransactionHash,
          payoutDestinationMode: mode, destination: payoutDestination(mode), ethAmountWei: amount,
          result: { ...(input.priorResult || {}), phase: 'native_eth_delivered_reconciled' },
        };
      }
      return unwrapWethToEth(payload, input.onSubmitted);
    }
    if (input.submittedTransactionHash) {
      const provider = zeroCapitalEngine.providers.get('ethereum' as any);
      if (!provider) throw new Error('GHOST_WALLET_ETHEREUM_RUNTIME_UNAVAILABLE');
      const receipt = await provider.getTransactionReceipt(input.submittedTransactionHash);
      if (!receipt) return { state: 'submitted', transactionHash: input.submittedTransactionHash, result: input.priorResult || {}, retryAfterMs: 1_000 };
      if (receipt.status !== 1) throw new Error('GHOST_WALLET_ETHEREUM_TOKEN_CONVERSION_REVERTED');
      const acquired = sumTransferTo(receipt, WETH_MAINNET, resolvePrimaryProfitPayoutAddress() || ZERO_ADDRESS);
      if (acquired <= 0n) throw new Error('GHOST_WALLET_WETH_ACQUISITION_RECONCILIATION_FAILED');
      return {
        state: 'settled', transactionHash: input.submittedTransactionHash,
        blockNumber: receipt.blockNumber ?? null, payoutTransactionHash: input.submittedTransactionHash,
        payoutDestinationMode: mode, destination: payoutDestination(mode), ethAmountWei: acquired,
        result: { ...(input.priorResult || {}), phase: 'weth_ready_reconciled', acquiredWethWei: acquired.toString() },
        followUp: {
          sourceTransactionHash: input.submittedTransactionHash,
          sourceBlockNumber: receipt.blockNumber ?? null,
          chain: 'ethereum', asset: WETH_MAINNET, amountBaseUnits: acquired.toString(),
          destinationMode: mode, sourceKind: 'ghost_wallet_weth_unwrap',
        },
      };
    }
    return convertEthereumTokenToWeth(payload, input.onSubmitted);
  }

  if (input.submittedTransactionHash) {
    return reconcileAcrossNativeEthPayout(payload, input.submittedTransactionHash, input.priorResult || {});
  }
  return submitAcrossNativeEthPayout(payload, input.onSubmitted);
}

export const GHOST_WALLET_ETH_PAYOUT_IDENTITY = {
  asset: 'ETH' as const,
  network: 'ethereum' as const,
  primary: 'WALLET_PRIVATE_KEY-derived public Ethereum address' as const,
  fallback: 'resolvePayoutFallbackAddress after confirmed primary delivery failure only' as const,
  arbitrageTreasuryAuthority: false as const,
  arbitrageProfitSplitAuthority: false as const,
};
