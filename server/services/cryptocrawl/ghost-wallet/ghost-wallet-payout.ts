import { BigNumber, Contract, ethers, providers, Wallet } from 'ethers';
import {
  normalizePrivateKey,
  resolvePayoutFallbackAddress,
  resolvePrimaryProfitPayoutAddress,
  walletFromPrivateKey,
} from '../core/wallet-identity.js';
import { ghostWalletProviderMesh, type GhostWalletChain } from './ghost-wallet-provider-mesh.js';
import {
  reconcileProfitFundedEthereumFallback,
  submitProfitFundedEthereumFallback,
} from './profit-funded-native-payout.js';

const ETHEREUM_CHAIN_ID = 1;
const ZERO_ADDRESS = ethers.constants.AddressZero;
const ZEROEX_NATIVE_TOKEN = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const ERC20_ABI = ['function balanceOf(address account) view returns (uint256)'];

const CHAIN_IDS: Record<GhostWalletChain, number> = {
  ethereum: 1,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  bsc: 56,
  avalanche: 43114,
};

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

interface ZeroExGaslessQuote {
  liquidityAvailable?: boolean;
  buyAmount?: string;
  minBuyAmount?: string;
  sellAmount?: string;
  issues?: { allowance?: { actual?: string; spender?: string } | null };
  approval?: ZeroExGaslessObject | null;
  trade?: ZeroExGaslessObject | null;
  fees?: {
    gasFee?: { amount?: string; token?: string; type?: string } | null;
    zeroExFee?: { amount?: string; token?: string; type?: string } | null;
  };
}

interface AcrossCall {
  to: string;
  data: string;
  value: BigNumber;
  gasLimit: BigNumber;
  gasPrice: BigNumber | null;
  maxFeePerGas: BigNumber | null;
  maxPriorityFeePerGas: BigNumber | null;
}

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

export type GhostWalletPayoutResult = GhostWalletPayoutSubmission | GhostWalletPayoutSettled;

function asBigInt(value: unknown, label = 'GHOST_WALLET_PAYOUT_AMOUNT_INVALID'): bigint {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) throw new Error(label);
  return BigInt(raw);
}

function positiveAmount(value: unknown, label = 'GHOST_WALLET_PAYOUT_AMOUNT_INVALID'): bigint {
  const amount = asBigInt(value, label);
  if (amount <= 0n) throw new Error('GHOST_WALLET_PAYOUT_AMOUNT_MUST_BE_POSITIVE');
  return amount;
}

function normalizeChain(value: string): GhostWalletChain {
  const chain = value.trim().toLowerCase() as GhostWalletChain;
  if (!(chain in CHAIN_IDS)) throw new Error(`GHOST_WALLET_PAYOUT_CHAIN_UNSUPPORTED:${value}`);
  return chain;
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function destination(mode: 'primary' | 'fallback'): string {
  const primary = resolvePrimaryProfitPayoutAddress();
  if (!primary) throw new Error('GHOST_WALLET_PRIMARY_PAYOUT_UNAVAILABLE');
  if (mode === 'primary') return ethers.utils.getAddress(primary);
  const fallback = resolvePayoutFallbackAddress();
  if (!fallback) throw new Error('GHOST_WALLET_FALLBACK_PAYOUT_UNAVAILABLE');
  return ethers.utils.getAddress(fallback);
}

function signingWallet(provider: providers.JsonRpcProvider): Wallet {
  const key = normalizePrivateKey(process.env.WALLET_PRIVATE_KEY || process.env.PRIVATE_KEY) || null;
  if (!key) throw new Error('GHOST_WALLET_SIGNING_KEY_UNAVAILABLE');
  const wallet = walletFromPrivateKey(key).connect(provider);
  const primary = destination('primary');
  if (wallet.address.toLowerCase() !== primary.toLowerCase()) {
    throw new Error('GHOST_WALLET_SIGNER_PRIMARY_PAYOUT_MISMATCH');
  }
  return wallet;
}

function zeroExApiKey(): string {
  const key = process.env.GHOST_WALLET_ZEROX_API_KEY?.trim()
    || process.env.ZERO_CAPITAL_ZEROX_API_KEY?.trim()
    || process.env.ZERO_EX_API_KEY?.trim()
    || process.env.ZEROX_API_KEY?.trim()
    || '';
  if (!key) throw new Error('GHOST_WALLET_ZEROX_EXISTING_CREDENTIALS_UNAVAILABLE');
  return key;
}

function acrossCredentials(): { apiKey: string; integratorId: string } {
  const apiKey = process.env.GHOST_WALLET_ACROSS_API_KEY?.trim() || process.env.ACROSS_API_KEY?.trim() || '';
  const integratorId = process.env.GHOST_WALLET_ACROSS_INTEGRATOR_ID?.trim() || process.env.ACROSS_INTEGRATOR_ID?.trim() || '';
  if (!apiKey || !/^0x[a-fA-F0-9]{4}$/.test(integratorId)) {
    throw new Error('GHOST_WALLET_ACROSS_EXISTING_CREDENTIALS_UNAVAILABLE');
  }
  return { apiKey, integratorId };
}

function stripEip712Domain(types: ZeroExTypedData['types']): ZeroExTypedData['types'] {
  const { EIP712Domain: _ignored, ...rest } = types;
  return rest;
}

async function fetchJson(url: string, init: RequestInit, headers: Record<string, string>): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  timer.unref?.();
  try {
    const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) }, signal: controller.signal });
    const text = await response.text();
    let parsed: any = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { throw new Error(`GHOST_WALLET_NON_JSON_RESPONSE:${response.status}`); }
    if (!response.ok) throw new Error(`GHOST_WALLET_HTTP_${response.status}:${String(parsed?.message || parsed?.reason || '').slice(0, 400)}`);
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function zeroExJson(path: string, init: RequestInit): Promise<any> {
  return fetchJson(`https://api.0x.org${path}`, init, {
    accept: 'application/json',
    'Content-Type': 'application/json',
    '0x-api-key': zeroExApiKey(),
    '0x-version': 'v2',
  });
}

async function acrossJson(path: string, init: RequestInit): Promise<any> {
  const { apiKey } = acrossCredentials();
  return fetchJson(`https://app.across.to/api${path}`, init, {
    accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  });
}

function extractTransactionHashes(value: unknown, key = ''): string[] {
  if (typeof value === 'string') {
    return /^(hash|transactionHash|txHash|transaction_hash|tx_hash)$/i.test(key) && validHash(value) ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap(item => extractTransactionHashes(item));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([childKey, child]) => extractTransactionHashes(child, childKey));
}

async function signZeroExObject(wallet: Wallet, object: ZeroExGaslessObject): Promise<Record<string, unknown>> {
  if (!object.eip712?.primaryType || !object.eip712.domain || !object.eip712.message || !object.eip712.types) {
    throw new Error('GHOST_WALLET_ZEROX_EIP712_INCOMPLETE');
  }
  const signatureHex = await wallet._signTypedData(
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

async function submitZeroExGasless(input: {
  chain: GhostWalletChain;
  asset: string;
  amount: bigint;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  mode: 'primary' | 'fallback';
  onSubmitted?: (transactionHash: string, result: Record<string, unknown>) => Promise<void>;
}): Promise<GhostWalletPayoutSubmission> {
  const chainId = CHAIN_IDS[input.chain];
  const token = new Contract(input.asset, ERC20_ABI, input.provider);
  const [tokenBeforeRaw, nativeBeforeRaw] = await Promise.all([
    token.balanceOf(input.wallet.address),
    input.provider.getBalance(input.wallet.address),
  ]);
  const tokenBefore = BigInt(tokenBeforeRaw.toString());
  if (tokenBefore < input.amount) throw new Error('GHOST_WALLET_PROFIT_TOKEN_BALANCE_BELOW_SETTLEMENT_AMOUNT');

  const params = new URLSearchParams({
    chainId: String(chainId),
    sellToken: input.asset,
    buyToken: ZEROEX_NATIVE_TOKEN,
    sellAmount: input.amount.toString(),
    taker: input.wallet.address,
  });
  const quote = await zeroExJson(`/gasless/quote?${params.toString()}`, { method: 'GET' }) as ZeroExGaslessQuote;
  if (!quote.liquidityAvailable || !quote.trade) throw new Error('GHOST_WALLET_ZEROX_GASLESS_LIQUIDITY_UNAVAILABLE');
  const expectedOut = positiveAmount(quote.buyAmount, 'GHOST_WALLET_ZEROX_EXPECTED_NATIVE_INVALID');
  const minimumOut = quote.minBuyAmount ? positiveAmount(quote.minBuyAmount) : expectedOut;
  if (quote.issues?.allowance != null && !quote.approval) {
    throw new Error('GHOST_WALLET_ZEROX_GASLESS_APPROVAL_UNAVAILABLE');
  }
  const trade = await signZeroExObject(input.wallet, quote.trade);
  const approval = quote.approval ? await signZeroExObject(input.wallet, quote.approval) : undefined;
  const submitted = await zeroExJson('/gasless/submit', {
    method: 'POST',
    body: JSON.stringify({ trade, chainId, ...(approval ? { approval } : {}) }),
  });
  const tradeHash = String(submitted?.tradeHash || '');
  if (!validHash(tradeHash)) throw new Error('GHOST_WALLET_ZEROX_TRADE_HASH_INVALID');
  const result: Record<string, unknown> = {
    phase: 'zeroex_gasless_submitted',
    chain: input.chain,
    chainId,
    asset: input.asset,
    amountBaseUnits: input.amount.toString(),
    tokenBalanceBefore: tokenBefore.toString(),
    nativeBalanceBeforeWei: nativeBeforeRaw.toString(),
    expectedNativeWei: expectedOut.toString(),
    minimumNativeWei: minimumOut.toString(),
    destinationMode: input.mode,
    zeroOperatorNativeGas: true,
    gasPaymentAuthority: '0x_gasless_from_trade_economics',
    alchemyDependency: false,
  };
  if (input.onSubmitted) await input.onSubmitted(tradeHash, result);
  return { state: 'submitted', transactionHash: tradeHash, result, retryAfterMs: 1_000 };
}

async function reconcileZeroExGasless(input: {
  tradeHash: string;
  result: Record<string, unknown>;
  onSubmitted?: (transactionHash: string, result: Record<string, unknown>) => Promise<void>;
}): Promise<GhostWalletPayoutResult> {
  const chain = normalizeChain(String(input.result.chain || ''));
  const chainId = CHAIN_IDS[chain];
  const provider = await ghostWalletProviderMesh.getProvider(chain);
  if (!provider) throw new Error(`GHOST_WALLET_RPC_UNAVAILABLE:${chain}`);
  const wallet = signingWallet(provider);
  const status = await zeroExJson(`/gasless/status/${input.tradeHash}?chainId=${chainId}`, { method: 'GET' });
  const statusName = String(status?.status || '').toLowerCase();
  if (['failed', 'reverted', 'cancelled', 'canceled', 'expired'].includes(statusName)) {
    throw new Error(`GHOST_WALLET_ZEROX_TERMINAL_FAILURE:${statusName}`);
  }

  let receipt: providers.TransactionReceipt | null = null;
  let receiptHash: string | null = null;
  for (const hash of Array.from(new Set(extractTransactionHashes(status)))) {
    const candidate = await provider.getTransactionReceipt(hash).catch(() => null);
    if (candidate?.status === 0) throw new Error('GHOST_WALLET_ZEROX_TRANSACTION_REVERTED');
    if (candidate?.status === 1) { receipt = candidate; receiptHash = hash; break; }
  }
  if (!receipt || !receiptHash) {
    return { state: 'submitted', transactionHash: input.tradeHash, result: { ...input.result, zeroExStatus: statusName }, retryAfterMs: 1_500 };
  }

  const asset = ethers.utils.getAddress(String(input.result.asset));
  const token = new Contract(asset, ERC20_ABI, provider);
  const [tokenAfterRaw, nativeAfterRaw] = await Promise.all([
    token.balanceOf(wallet.address),
    provider.getBalance(wallet.address),
  ]);
  const tokenBefore = asBigInt(input.result.tokenBalanceBefore);
  const nativeBefore = asBigInt(input.result.nativeBalanceBeforeWei);
  const tokenAfter = BigInt(tokenAfterRaw.toString());
  const nativeAfter = BigInt(nativeAfterRaw.toString());
  const soldAmount = asBigInt(input.result.amountBaseUnits);
  const minimumNative = positiveAmount(input.result.minimumNativeWei);
  if (tokenAfter > tokenBefore || tokenBefore - tokenAfter < soldAmount) {
    throw new Error('GHOST_WALLET_ZEROX_SOURCE_PROFIT_SPEND_NOT_VERIFIED');
  }
  if (nativeAfter <= nativeBefore || nativeAfter - nativeBefore < minimumNative) {
    throw new Error('GHOST_WALLET_ZEROX_NATIVE_DELIVERY_NOT_VERIFIED');
  }
  const acquiredNative = nativeAfter - nativeBefore;
  const mode = input.result.destinationMode === 'fallback' ? 'fallback' : 'primary';

  if (chain === 'ethereum') {
    if (mode === 'fallback') {
      const payoutDestination = destination('fallback');
      const fallback = await submitProfitFundedEthereumFallback({
        provider,
        wallet,
        destination: payoutDestination,
        acquiredProfitWei: acquiredNative,
        sourceNativeBaselineWei: nativeBefore,
        onSubmitted: input.onSubmitted,
      });
      return {
        state: 'submitted',
        transactionHash: fallback.transactionHash,
        result: {
          ...fallback.result,
          zeroExTradeHash: input.tradeHash,
          zeroExSettlementTransactionHash: receiptHash,
        },
        retryAfterMs: 1_000,
      };
    }
    return {
      state: 'settled',
      transactionHash: receiptHash,
      blockNumber: receipt.blockNumber ?? null,
      payoutTransactionHash: receiptHash,
      payoutDestinationMode: 'primary',
      destination: destination('primary'),
      ethAmountWei: acquiredNative,
      result: {
        ...input.result,
        phase: 'native_eth_delivered',
        zeroExTradeHash: input.tradeHash,
        settlementTransactionHash: receiptHash,
        acquiredNativeWei: acquiredNative.toString(),
        zeroOperatorNativeGas: true,
        payoutTerminallyVerified: true,
      },
    };
  }

  return submitProfitFundedAcrossBridge({
    chain,
    acquiredNative,
    sourceNativeBaseline: nativeBefore,
    provider,
    wallet,
    mode,
    zeroExReceiptHash: receiptHash,
    onSubmitted: input.onSubmitted,
  });
}

function parseAcrossCall(value: any, expectedChainId: number): AcrossCall {
  if (!value || Number(value.chainId) !== expectedChainId) throw new Error('GHOST_WALLET_ACROSS_CHAIN_MISMATCH');
  const to = String(value.to || '');
  const data = String(value.data || '0x');
  if (!ethers.utils.isAddress(to) || !ethers.utils.isHexString(data)) throw new Error('GHOST_WALLET_ACROSS_CALL_INVALID');
  const gasLimit = BigNumber.from(String(value.gas || value.gasLimit || '0'));
  if (gasLimit.lte(0)) throw new Error('GHOST_WALLET_ACROSS_GAS_LIMIT_INVALID');
  const maxFeePerGas = value.maxFeePerGas ? BigNumber.from(String(value.maxFeePerGas)) : null;
  const maxPriorityFeePerGas = value.maxPriorityFeePerGas ? BigNumber.from(String(value.maxPriorityFeePerGas)) : null;
  const gasPrice = value.gasPrice ? BigNumber.from(String(value.gasPrice)) : null;
  if (!maxFeePerGas && !gasPrice) throw new Error('GHOST_WALLET_ACROSS_GAS_PRICE_INVALID');
  return {
    to: ethers.utils.getAddress(to),
    data,
    value: BigNumber.from(String(value.value || '0')),
    gasLimit,
    gasPrice,
    maxFeePerGas,
    maxPriorityFeePerGas,
  };
}

function acrossMaximumOriginSpend(call: AcrossCall): bigint {
  const gasPrice = call.maxFeePerGas || call.gasPrice;
  if (!gasPrice) throw new Error('GHOST_WALLET_ACROSS_GAS_PRICE_INVALID');
  return BigInt(call.value.toString()) + BigInt(call.gasLimit.mul(gasPrice).toString());
}

async function getAcrossNativeQuote(input: {
  chain: GhostWalletChain;
  wallet: string;
  recipient: string;
  amount: bigint;
}): Promise<{ raw: any; call: AcrossCall; expected: bigint; minimum: bigint }> {
  const { integratorId } = acrossCredentials();
  const params = new URLSearchParams({
    tradeType: 'exactInput',
    amount: input.amount.toString(),
    inputToken: ZERO_ADDRESS,
    outputToken: ZERO_ADDRESS,
    originChainId: String(CHAIN_IDS[input.chain]),
    destinationChainId: String(ETHEREUM_CHAIN_ID),
    depositor: input.wallet,
    recipient: input.recipient,
    refundAddress: input.wallet,
    refundOnOrigin: 'true',
    integratorId,
  });
  const raw = await acrossJson(`/swap/approval?${params.toString()}`, { method: 'GET' });
  const approvals = Array.isArray(raw?.approvalTxns) ? raw.approvalTxns : [];
  if (approvals.length !== 0) throw new Error('GHOST_WALLET_ACROSS_NATIVE_ROUTE_UNEXPECTED_APPROVAL');
  if (raw?.swapTx?.simulationSuccess !== true) throw new Error('GHOST_WALLET_ACROSS_SWAP_NOT_SIMULATION_VERIFIED');
  const call = parseAcrossCall(raw.swapTx, CHAIN_IDS[input.chain]);
  const expected = positiveAmount(raw?.expectedOutputAmount, 'GHOST_WALLET_ACROSS_EXPECTED_ETH_INVALID');
  const minimum = raw?.minOutputAmount ? positiveAmount(raw.minOutputAmount) : expected;
  return { raw, call, expected, minimum };
}

async function affordableAcrossQuote(input: {
  chain: GhostWalletChain;
  wallet: string;
  recipient: string;
  acquiredNative: bigint;
}): Promise<{ raw: any; call: AcrossCall; expected: bigint; minimum: bigint; maxSpend: bigint }> {
  let bridgeAmount = input.acquiredNative;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (bridgeAmount <= 0n) break;
    const quote = await getAcrossNativeQuote({ ...input, amount: bridgeAmount });
    const maxSpend = acrossMaximumOriginSpend(quote.call);
    if (maxSpend <= input.acquiredNative) return { ...quote, maxSpend };
    const gasOnly = maxSpend - BigInt(quote.call.value.toString());
    if (gasOnly >= input.acquiredNative) break;
    const next = input.acquiredNative - gasOnly;
    if (next >= bridgeAmount) break;
    bridgeAmount = next;
  }
  throw new Error('GHOST_WALLET_PROFIT_TOO_SMALL_FOR_SELF_FUNDED_ETH_BRIDGE');
}

async function submitProfitFundedAcrossBridge(input: {
  chain: GhostWalletChain;
  acquiredNative: bigint;
  sourceNativeBaseline: bigint;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  mode: 'primary' | 'fallback';
  zeroExReceiptHash: string;
  onSubmitted?: (transactionHash: string, result: Record<string, unknown>) => Promise<void>;
}): Promise<GhostWalletPayoutSubmission> {
  const payoutDestination = destination(input.mode);
  const ethereumProvider = await ghostWalletProviderMesh.getProvider('ethereum');
  if (!ethereumProvider) throw new Error('GHOST_WALLET_ETHEREUM_RPC_UNAVAILABLE');
  const destinationBalanceBefore = await ethereumProvider.getBalance(payoutDestination);
  const quote = await affordableAcrossQuote({
    chain: input.chain,
    wallet: input.wallet.address,
    recipient: payoutDestination,
    acquiredNative: input.acquiredNative,
  });
  const currentNative = BigInt((await input.provider.getBalance(input.wallet.address)).toString());
  if (currentNative < input.sourceNativeBaseline + input.acquiredNative) {
    throw new Error('GHOST_WALLET_SOURCE_NATIVE_PROFIT_NO_LONGER_AVAILABLE');
  }
  if (quote.maxSpend > input.acquiredNative) {
    throw new Error('GHOST_WALLET_ACROSS_WOULD_SPEND_PREEXISTING_OPERATOR_NATIVE');
  }

  const txRequest: providers.TransactionRequest = {
    to: quote.call.to,
    data: quote.call.data,
    value: quote.call.value,
    gasLimit: quote.call.gasLimit,
  };
  if (quote.call.maxFeePerGas) {
    txRequest.maxFeePerGas = quote.call.maxFeePerGas;
    if (quote.call.maxPriorityFeePerGas) txRequest.maxPriorityFeePerGas = quote.call.maxPriorityFeePerGas;
    txRequest.type = 2;
  } else if (quote.call.gasPrice) {
    txRequest.gasPrice = quote.call.gasPrice;
  }
  const sent = await input.wallet.sendTransaction(txRequest);
  const result: Record<string, unknown> = {
    phase: 'across_profit_funded_native_bridge_submitted',
    chain: input.chain,
    originChainId: CHAIN_IDS[input.chain],
    destinationChainId: ETHEREUM_CHAIN_ID,
    destination: payoutDestination,
    destinationMode: input.mode,
    sourceNativeProfitWei: input.acquiredNative.toString(),
    sourceNativeBaselineWei: input.sourceNativeBaseline.toString(),
    maximumOriginSpendWei: quote.maxSpend.toString(),
    bridgeValueWei: quote.call.value.toString(),
    expectedEthWei: quote.expected.toString(),
    minimumEthWei: quote.minimum.toString(),
    destinationBalanceBeforeWei: destinationBalanceBefore.toString(),
    zeroExConversionReceipt: input.zeroExReceiptHash,
    quoteId: typeof quote.raw?.id === 'string' ? quote.raw.id : null,
    expectedFillTimeSec: Number(quote.raw?.expectedFillTime || 0),
    operatorMonetaryInputRequired: false,
    originGasFunding: 'realized_ghost_profit_only',
    alchemyDependency: false,
  };
  if (input.onSubmitted) await input.onSubmitted(sent.hash, result);
  return {
    state: 'submitted',
    transactionHash: sent.hash,
    result,
    retryAfterMs: Math.max(1_000, Math.min(15_000, Number(quote.raw?.expectedFillTime || 2) * 1_000)),
  };
}

async function reconcileAcrossBridge(input: {
  transactionHash: string;
  result: Record<string, unknown>;
  onSubmitted?: (transactionHash: string, result: Record<string, unknown>) => Promise<void>;
}): Promise<GhostWalletPayoutResult> {
  if (!validHash(input.transactionHash)) throw new Error('GHOST_WALLET_ACROSS_DEPOSIT_TX_INVALID');
  const mode = input.result.destinationMode === 'fallback' ? 'fallback' : 'primary';
  const payoutDestination = destination(mode);
  const { integratorId } = acrossCredentials();
  const params = new URLSearchParams({ depositTxnRef: input.transactionHash, integratorId });
  const status = await acrossJson(`/deposit/status?${params.toString()}`, { method: 'GET' });
  const state = String(status?.status || '').toLowerCase();
  if (state === 'filled') {
    if (Number(status?.destinationChainId) !== ETHEREUM_CHAIN_ID) throw new Error('GHOST_WALLET_ACROSS_DESTINATION_CHAIN_MISMATCH');
    const fillHash = String(status?.fillTxnRef || status?.fillTx || '');
    if (!validHash(fillHash)) throw new Error('GHOST_WALLET_ACROSS_FILL_RECEIPT_UNAVAILABLE');
    const provider = await ghostWalletProviderMesh.getProvider('ethereum');
    if (!provider) throw new Error('GHOST_WALLET_ETHEREUM_RPC_UNAVAILABLE');
    const receipt = await provider.getTransactionReceipt(fillHash);
    if (!receipt || receipt.status !== 1) throw new Error('GHOST_WALLET_ACROSS_FILL_NOT_TERMINALLY_VERIFIED');
    if (status?.actionsSucceeded === false) throw new Error('GHOST_WALLET_ACROSS_DESTINATION_ACTION_FAILED');
    const before = asBigInt(input.result.destinationBalanceBeforeWei);
    const minimum = positiveAmount(input.result.minimumEthWei);
    const after = BigInt((await provider.getBalance(payoutDestination)).toString());
    if (after < before + minimum) throw new Error('GHOST_WALLET_ACROSS_ETH_BALANCE_DELTA_NOT_VERIFIED');
    const delivered = after - before;
    return {
      state: 'settled',
      transactionHash: input.transactionHash,
      blockNumber: receipt.blockNumber ?? null,
      payoutTransactionHash: fillHash,
      payoutDestinationMode: mode,
      destination: payoutDestination,
      ethAmountWei: delivered,
      result: {
        ...input.result,
        phase: 'native_eth_delivered',
        providerStatus: state,
        fillTransactionHash: fillHash,
        deliveredEthWei: delivered.toString(),
        payoutTerminallyVerified: true,
        operatorMonetaryInputRequired: false,
      },
    };
  }

  const originChain = normalizeChain(String(input.result.chain || ''));
  const originProvider = await ghostWalletProviderMesh.getProvider(originChain);
  if (!originProvider) throw new Error(`GHOST_WALLET_RPC_UNAVAILABLE:${originChain}`);
  const wallet = signingWallet(originProvider);
  const baseline = asBigInt(input.result.sourceNativeBaselineWei, 'GHOST_WALLET_ACROSS_SOURCE_BASELINE_INVALID');
  const originalProfit = positiveAmount(input.result.sourceNativeProfitWei, 'GHOST_WALLET_ACROSS_SOURCE_PROFIT_INVALID');
  const current = BigInt((await originProvider.getBalance(wallet.address)).toString());
  const balanceAboveBaseline = current > baseline ? current - baseline : 0n;
  const recovered = balanceAboveBaseline > originalProfit ? originalProfit : balanceAboveBaseline;

  const submitFallbackFromRecovered = async (reason: string, proof: string): Promise<GhostWalletPayoutSubmission> => {
    if (mode !== 'primary' || !resolvePayoutFallbackAddress()) {
      throw new Error(`GHOST_WALLET_ACROSS_TERMINAL_FAILURE:${state}`);
    }
    if (recovered <= 0n) {
      return {
        state: 'submitted',
        transactionHash: input.transactionHash,
        result: {
          ...input.result,
          providerStatus: state,
          awaitingRecoveredOriginBalance: true,
          recoveryProof: proof,
        },
        retryAfterMs: 60_000,
      };
    }
    const fallback = await submitProfitFundedAcrossBridge({
      chain: originChain,
      acquiredNative: recovered,
      sourceNativeBaseline: baseline,
      provider: originProvider,
      wallet,
      mode: 'fallback',
      zeroExReceiptHash: String(input.result.zeroExConversionReceipt || input.transactionHash),
      onSubmitted: input.onSubmitted,
    });
    return {
      ...fallback,
      result: {
        ...fallback.result,
        fallbackFromPrimaryTransactionHash: input.transactionHash,
        fallbackReason: reason,
        primaryPayoutTerminallyConfirmed: false,
        recoveredNativeProfitWei: recovered.toString(),
        recoveryProof: proof,
      },
    };
  };

  if (state === 'refunded') {
    // Across defines `refunded` as the point at which the refund has executed
    // on-chain and returned funds to refundAddress. Require both that provider
    // state and a bounded origin-wallet balance delta before retargeting.
    return submitFallbackFromRecovered(
      'across_refunded',
      'across_deposit_status_refunded_plus_origin_balance_delta',
    );
  }

  if (state === 'deposit-failed') {
    // A provider label alone is not proof that principal is back. Only a reverted
    // origin receipt proves the deposit never transferred funds; otherwise keep
    // the same durable job pending until the status/receipt converges.
    const originReceipt = await originProvider.getTransactionReceipt(input.transactionHash).catch(() => null);
    if (!originReceipt) {
      return {
        state: 'submitted',
        transactionHash: input.transactionHash,
        result: { ...input.result, providerStatus: state, awaitingOriginDepositReceipt: true },
        retryAfterMs: 5_000,
      };
    }
    if (originReceipt.status === 0) {
      return submitFallbackFromRecovered(
        'across_deposit_transaction_reverted',
        'origin_deposit_receipt_status_zero_plus_origin_balance_delta',
      );
    }
    return {
      state: 'submitted',
      transactionHash: input.transactionHash,
      result: {
        ...input.result,
        providerStatus: state,
        originDepositReceiptStatus: originReceipt.status,
        awaitingAcrossStatusConvergence: true,
      },
      retryAfterMs: 60_000,
    };
  }

  if (state === 'expired') {
    // Across documents expiry as refund-in-progress, not terminal loss. Refund
    // settlement can take hours; use the provider-recommended minute-scale poll.
    return {
      state: 'submitted',
      transactionHash: input.transactionHash,
      result: { ...input.result, providerStatus: state, awaitingAcrossRefund: true },
      retryAfterMs: 60_000,
    };
  }

  if (['refund-failed', 'manual-refund-required'].includes(state)) {
    throw new Error(`GHOST_WALLET_ACROSS_RECOVERY_PENDING:${state}`);
  }
  return {
    state: 'submitted',
    transactionHash: input.transactionHash,
    result: { ...input.result, providerStatus: state },
    retryAfterMs: 5_000,
  };
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
  const amount = positiveAmount(payload.amountBaseUnits);
  const mode = payload.destinationMode === 'fallback' ? 'fallback' : 'primary';
  destination(mode);

  if (input.submittedTransactionHash) {
    const phase = String(input.priorResult?.phase || '');
    if (phase === 'zeroex_gasless_submitted') {
      return reconcileZeroExGasless({
        tradeHash: input.submittedTransactionHash,
        result: input.priorResult || {},
        onSubmitted: input.onSubmitted,
      });
    }
    if (phase === 'across_profit_funded_native_bridge_submitted') {
      return reconcileAcrossBridge({
        transactionHash: input.submittedTransactionHash,
        result: input.priorResult || {},
        onSubmitted: input.onSubmitted,
      });
    }
    if (phase === 'ethereum_profit_funded_fallback_submitted') {
      const provider = await ghostWalletProviderMesh.getProvider('ethereum');
      if (!provider) throw new Error('GHOST_WALLET_ETHEREUM_RPC_UNAVAILABLE');
      const wallet = signingWallet(provider);
      const reconciliation = await reconcileProfitFundedEthereumFallback({
        provider,
        wallet,
        transactionHash: input.submittedTransactionHash,
        result: input.priorResult || {},
      });
      if (reconciliation.pending) {
        return {
          state: 'submitted',
          transactionHash: input.submittedTransactionHash,
          result: input.priorResult || {},
          retryAfterMs: 1_500,
        };
      }
      return {
        state: 'settled',
        transactionHash: input.submittedTransactionHash,
        blockNumber: reconciliation.blockNumber,
        payoutTransactionHash: input.submittedTransactionHash,
        payoutDestinationMode: 'fallback',
        destination: reconciliation.destination,
        ethAmountWei: reconciliation.deliveredWei,
        result: reconciliation.result,
      };
    }
    throw new Error('GHOST_WALLET_PAYOUT_SUBMITTED_STATE_UNKNOWN');
  }

  const provider = await ghostWalletProviderMesh.getProvider(chain);
  if (!provider) throw new Error(`GHOST_WALLET_RPC_UNAVAILABLE:${chain}`);
  const wallet = signingWallet(provider);
  return submitZeroExGasless({
    chain,
    asset,
    amount,
    provider,
    wallet,
    mode,
    onSubmitted: input.onSubmitted,
  });
}

export const GHOST_WALLET_PAYOUT_POLICY = {
  targetAsset: 'native_ETH',
  targetNetwork: 'ethereum',
  percentOfRealizedGhostNet: 90,
  arbitrageTreasuryAuthority: false,
  retainedCapitalSplit: true,
  retainedCapitalPercent: 10,
  alchemyAllowed: false,
  providerSponsoredGasAllowed: false,
  operatorNativeGasAllowed: false,
  sameChainConversion: '0x_gasless_then_recipient_bound_profit_funded_fallback_if_requested',
  crossChainConversion: '0x_gasless_source_native_then_across_profit_funded',
  crossChainOriginGasSource: 'realized_ghost_profit_only',
  canonicalVariableFallbacks: true,
  primaryAcrossRefundFallback: 'same_durable_job_retargets_only_after_origin_refund_is_proven',
  terminalProof: 'source_spend_plus_receipt_plus_destination_native_balance_delta',
} as const;