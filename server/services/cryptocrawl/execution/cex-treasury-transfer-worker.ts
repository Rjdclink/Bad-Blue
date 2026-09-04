import { createHash, randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { krakenPrivateRequest, okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import { isDatabaseConfigured, pool } from '../runtime/cryptocrawl-runtime-database.js';
import {
  executeCoinbaseToOkxTransfer,
  prepareCoinbaseToOkxTransfer,
  type CoinbaseToOkxPreparedTransfer,
} from './coinbase-treasury-transfer-adapter.js';

const TRANSFERABLE_ASSETS = new Set(['USDC', 'USDT', 'ETH']);
const WORKER_INTERVAL_MS = Math.max(5_000, Math.min(60_000, Number(process.env.CRYPTOCRAWL_TREASURY_TRANSFER_INTERVAL_MS || 15_000)));
const RETRY_AFTER_MS = Math.max(15_000, Math.min(15 * 60_000, Number(process.env.CRYPTOCRAWL_TREASURY_TRANSFER_RETRY_MS || 60_000)));
const SETTLEMENT_TIMEOUT_MS = Math.max(60_000, Math.min(6 * 60 * 60_000, Number(process.env.CRYPTOCRAWL_TREASURY_TRANSFER_SETTLEMENT_TIMEOUT_MS || 60 * 60_000)));
const SETTLEMENT_POLL_MS = Math.max(5_000, Math.min(60_000, Number(process.env.CRYPTOCRAWL_TREASURY_TRANSFER_POLL_MS || 15_000)));

type Venue = 'coinbase' | 'kraken' | 'okx';

type KrakenDestination = {
  venue: 'kraken';
  asset: string;
  method: string;
  address: string;
  okxChain: string;
  okxFeeDecimal: number;
  okxMinDecimal: number;
  okxMaxDecimal: number | null;
};

type OkxDestination = {
  venue: 'okx';
  asset: string;
  address: string;
  chain: string;
  depositAccount: string | null;
  krakenWithdrawalKey: string;
  krakenMethod: string | null;
};

type TransferSettlement = {
  sourceDebitDecimal: number;
  deliveredDecimal: number;
  sourceFeeDecimal: number;
  withdrawalReference: string;
  transactionHash: string;
  destinationReference: string;
  sourceEvidence: Record<string, unknown>;
  destinationEvidence: Record<string, unknown>;
};

type RetainedRow = {
  event_id: string;
  retained_usd: string | number;
  target_venue: Venue;
  source_venue: string | null;
  status: string;
  source_asset: string | null;
  payout_source_asset: string | null;
};

type PayoutFundingRow = {
  event_id: string;
  source_venue: string | null;
  source_asset: string | null;
  payout_target_usd: string | number;
  payout_paid_usd: string | number;
  reserved_asset_amount: string | number;
  remaining_asset_amount: string | number;
  reservation_venue: string;
};

let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;

function finitePositive(raw: unknown): number | null {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function finiteNonNegative(raw: unknown): number | null {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function objectRecord(raw: unknown): Record<string, any> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, any> : {};
}

function canonicalAsset(raw: unknown): string {
  let asset = String(raw || '').trim().toUpperCase().split('.')[0];
  if (asset === 'XETH') return 'ETH';
  if (asset === 'ZUSD') return 'USD';
  if (/^[XZ][A-Z0-9]{3,}$/.test(asset)) asset = asset.slice(1);
  return asset === 'XBT' ? 'BTC' : asset;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ethereumAddress(raw: unknown): string | null {
  const value = String(raw || '').trim();
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? value : null;
}

function ethereumNetwork(raw: unknown): boolean {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return false;
  if (['arbitrum', 'optimism', 'base', 'polygon', 'bsc', 'zksync', 'linea', 'scroll', 'avalanche'].some(item => value.includes(item))) return false;
  return value.includes('erc20') || value.includes('ethereum') || value.includes('eth');
}

function canonicalTxId(raw: unknown): string {
  return String(raw || '').trim().toLowerCase();
}

function deterministicClientId(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 28);
}

function numericString(value: number, decimals = 12): string {
  if (!(value > 0) || !Number.isFinite(value)) throw new Error('treasury transfer requires a finite positive amount');
  return value.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
}

function liveExecutionPosture(): boolean {
  return process.env.NO_EXECUTION !== 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK';
}

function submittedBefore(row: any): boolean {
  return Boolean(row?.submitted_at);
}

function manualReviewError(message: string): boolean {
  return /manual review|approved.*withdrawal key|permission|recipient information|compliance|automatic resubmission forbidden|ambiguous.*cannot be recovered|durable .* differs from|lost or drifted.*reservation/i.test(message);
}

async function assetUsdPrice(asset: string): Promise<{ price: number; observedAt: number }> {
  if (asset === 'USD') return { price: 1, observedAt: Date.now() };
  const prices = await coinGeckoPriceClient.getLiveSymbolPrices([asset]);
  const price = prices.get(asset);
  if (!price || !Number.isFinite(price) || price <= 0) throw new Error(`live USD price unavailable for treasury asset ${asset}`);
  return { price, observedAt: Date.now() };
}

async function resolveKrakenDeposit(asset: string): Promise<KrakenDestination> {
  const currencies = await okxPrivateRequest('/api/v5/asset/currencies', 'GET', { ccy: asset }, { lane: 'account_read' });
  const okxRoutes = currencies.data
    .filter((row: any) => row?.canWd === true || String(row?.canWd || '').toLowerCase() === 'true')
    .filter((row: any) => ethereumNetwork(row?.chain))
    .map((row: any) => ({
      chain: String(row.chain || '').trim(), fee: Number(row.fee), min: Number(row.minWd),
      max: row.maxWd === undefined || row.maxWd === null || String(row.maxWd).trim() === '' ? null : Number(row.maxWd),
    }))
    .filter(route => route.chain && Number.isFinite(route.fee) && route.fee >= 0 && Number.isFinite(route.min) && route.min >= 0);
  if (okxRoutes.length !== 1) throw new Error(`OKX ${asset} does not expose exactly one authenticated Ethereum withdrawal route`);
  const okxRoute = okxRoutes[0];

  const methods = await krakenPrivateRequest('/0/private/DepositMethods', { asset: asset.toLowerCase() });
  const rows = Array.isArray(methods) ? methods : [];
  const candidates: Array<{ method: string; address: string }> = [];
  for (const row of rows) {
    const method = String(row?.method || '').trim();
    if (!method) continue;
    const addresses = await krakenPrivateRequest('/0/private/DepositAddresses', { asset: asset.toLowerCase(), method, new: false });
    for (const addressRow of Array.isArray(addresses) ? addresses : []) {
      const address = ethereumAddress(addressRow?.address);
      if (address) candidates.push({ method, address });
    }
  }
  const unique = [...new Map(candidates.map(row => [`${row.method}:${row.address.toLowerCase()}`, row])).values()];
  const explicitEthereum = unique.filter(row => ethereumNetwork(row.method));
  const eligible = explicitEthereum.length === 1 ? explicitEthereum : unique.length === 1 ? unique : [];
  if (eligible.length !== 1) throw new Error(`Kraken ${asset} Ethereum deposit method/address is not uniquely provable`);
  return {
    venue: 'kraken', asset, method: eligible[0].method, address: eligible[0].address,
    okxChain: okxRoute.chain, okxFeeDecimal: okxRoute.fee, okxMinDecimal: okxRoute.min,
    okxMaxDecimal: okxRoute.max !== null && Number.isFinite(okxRoute.max) ? okxRoute.max : null,
  };
}

async function resolveOkxDeposit(asset: string): Promise<OkxDestination> {
  const currencies = await okxPrivateRequest('/api/v5/asset/currencies', 'GET', { ccy: asset }, { lane: 'account_read' });
  const routes = currencies.data
    .filter((row: any) => row?.canDep === true || String(row?.canDep || '').toLowerCase() === 'true')
    .filter((row: any) => ethereumNetwork(row?.chain));
  if (routes.length !== 1) throw new Error(`OKX ${asset} does not expose exactly one authenticated Ethereum deposit route`);
  const chain = String(routes[0].chain || '').trim();
  const addresses = await okxPrivateRequest('/api/v5/asset/deposit-address', 'GET', { ccy: asset }, { lane: 'account_read' });
  const depositRows = addresses.data.filter((row: any) => String(row?.chain || '').trim() === chain && ethereumAddress(row?.addr));
  if (depositRows.length !== 1) throw new Error(`OKX ${asset} Ethereum deposit address is not uniquely provable`);
  const address = ethereumAddress(depositRows[0].addr)!;
  const depositAccount = String(depositRows[0]?.to || '').trim() || null;

  const approved = await krakenPrivateRequest('/0/private/WithdrawAddresses', { asset: asset.toLowerCase() });
  const matching = (Array.isArray(approved) ? approved : []).filter((row: any) =>
    String(row?.address || '').trim().toLowerCase() === address.toLowerCase() && String(row?.key || '').trim(),
  );
  if (matching.length !== 1) throw new Error(`Kraken has no uniquely approved ${asset} withdrawal key for the authenticated OKX deposit address`);
  return {
    venue: 'okx', asset, address, chain, depositAccount,
    krakenWithdrawalKey: String(matching[0].key).trim(), krakenMethod: String(matching[0].method || '').trim() || null,
  };
}

async function krakenGrossForNet(asset: string, key: string, desiredNet: number): Promise<{ gross: number; fee: number; expectedNet: number; info: any }> {
  let gross = desiredNet;
  let info: any = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    info = await krakenPrivateRequest('/0/private/WithdrawInfo', { asset: asset.toLowerCase(), key, amount: numericString(gross) });
    const fee = finitePositive(info?.fee) ?? 0;
    const net = finitePositive(info?.amount);
    if (net !== null && net + 1e-10 >= desiredNet) return { gross, fee, expectedNet: net, info };
    gross = desiredNet + fee + Math.max(1e-10, desiredNet * 1e-8);
  }
  const fee = finitePositive(info?.fee) ?? 0;
  const net = finitePositive(info?.amount);
  if (net === null || net + 1e-10 < desiredNet) throw new Error(`Kraken withdrawal cannot deliver requested ${asset} amount after authenticated fee`);
  return { gross, fee, expectedNet: net, info };
}

async function recoverKrakenWithdrawal(asset: string, key: string, gross: number, destination: string, createdAt: number): Promise<any | null> {
  const status = await krakenPrivateRequest('/0/private/WithdrawStatus', { asset: asset.toLowerCase() });
  const rows = Array.isArray(status) ? status : [];
  const tolerance = Math.max(1e-9, gross * 1e-8);
  const candidates = rows.filter((row: any) => {
    const amount = Number(row?.amount || 0) + Number(row?.fee || 0);
    const address = String(row?.info || '').trim().toLowerCase();
    const timeMs = Number(row?.time || 0) * 1000;
    return Number.isFinite(amount) && Math.abs(amount - gross) <= tolerance && address === destination.toLowerCase() && timeMs >= createdAt - 120_000;
  });
  if (candidates.length > 1) throw new Error('Multiple Kraken withdrawals match the durable treasury intent; manual review required before any resubmission');
  return candidates[0] || null;
}

async function waitKrakenWithdrawal(asset: string, refid: string): Promise<any> {
  const deadline = Date.now() + SETTLEMENT_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const status = await krakenPrivateRequest('/0/private/WithdrawStatus', { asset: asset.toLowerCase() });
    const row = (Array.isArray(status) ? status : []).find((item: any) => String(item?.refid || '') === refid);
    if (row) {
      const state = String(row.status || '').trim().toLowerCase();
      if (state === 'success') return row;
      if (['failure','failed','canceled','cancelled'].includes(state)) throw new Error(`Kraken withdrawal ${refid} reached terminal ${state}`);
    }
    await sleep(SETTLEMENT_POLL_MS);
  }
  throw new Error(`Kraken withdrawal ${refid} settlement timeout`);
}

async function waitOkxDeposit(asset: string, txId: string, address: string): Promise<any> {
  const deadline = Date.now() + SETTLEMENT_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const history = await okxPrivateRequest('/api/v5/asset/deposit-history', 'GET', { ccy: asset, txId }, { lane: 'account_read' });
    const row = history.data.find((item: any) => canonicalTxId(item?.txId) === canonicalTxId(txId)
      && (!item?.to || String(item.to).trim().toLowerCase() === address.toLowerCase()));
    if (row) {
      const state = String(row.state ?? '').trim();
      if (state === '2') return row;
      if (state.startsWith('-')) throw new Error(`OKX deposit ${txId} reached terminal ${state}`);
    }
    await sleep(SETTLEMENT_POLL_MS);
  }
  throw new Error(`OKX deposit ${txId} settlement timeout`);
}

async function waitOkxWithdrawal(asset: string, wdId: string): Promise<any> {
  const deadline = Date.now() + SETTLEMENT_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const history = await okxPrivateRequest('/api/v5/asset/withdrawal-history', 'GET', { ccy: asset, wdId }, { lane: 'account_read' });
    const row = history.data.find((item: any) => String(item?.wdId || '') === wdId);
    if (row) {
      const state = String(row.state ?? '').trim();
      if (state === '2' && String(row.txId || '').trim()) return row;
      if (state.startsWith('-')) throw new Error(`OKX withdrawal ${wdId} reached terminal ${state}`);
    }
    await sleep(SETTLEMENT_POLL_MS);
  }
  throw new Error(`OKX withdrawal ${wdId} settlement timeout`);
}

async function waitKrakenDeposit(asset: string, method: string, txId: string, address: string): Promise<any> {
  const deadline = Date.now() + SETTLEMENT_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const status = await krakenPrivateRequest('/0/private/DepositStatus', { asset: asset.toLowerCase(), method });
    const row = (Array.isArray(status) ? status : []).find((item: any) => {
      const origins = Array.isArray(item?.originators) ? item.originators.map(canonicalTxId) : [];
      return origins.includes(canonicalTxId(txId)) || (canonicalTxId(item?.txid) === canonicalTxId(txId) && String(item?.info || '').trim().toLowerCase() === address.toLowerCase());
    });
    if (row) {
      const state = String(row.status || '').trim().toLowerCase();
      if (state === 'success') return row;
      if (state === 'failure' || state === 'failed') throw new Error(`Kraken deposit ${txId} reached terminal ${state}`);
    }
    await sleep(SETTLEMENT_POLL_MS);
  }
  throw new Error(`Kraken deposit ${txId} settlement timeout`);
}

async function transferKrakenToOkx(input: {
  transferIdentity: string;
  asset: string;
  desiredNet: number;
  createdAt: number;
  durableGrossSourceDebit: number;
  allowSubmission: boolean;
}): Promise<TransferSettlement> {
  const destination = await resolveOkxDeposit(input.asset);
  const gross = input.durableGrossSourceDebit;
  getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: 'cex:kraken', venue: 'kraken' });
  let withdrawal = await recoverKrakenWithdrawal(input.asset, destination.krakenWithdrawalKey, gross, destination.address, input.createdAt);
  let refid = String(withdrawal?.refid || '').trim();
  let currentQuote: Awaited<ReturnType<typeof krakenGrossForNet>> | null = null;
  if (!refid) {
    if (!input.allowSubmission) {
      throw new Error('manual review required: prior Kraken withdrawal is not uniquely recoverable; automatic resubmission forbidden');
    }
    currentQuote = await krakenGrossForNet(input.asset, destination.krakenWithdrawalKey, input.desiredNet);
    const tolerance = Math.max(1e-9, gross * 1e-8);
    if (Math.abs(currentQuote.gross - gross) > tolerance) {
      throw new Error('pre-submission Kraken transfer economics changed from durable source reservation; fresh intent required');
    }
    const submitted = await krakenPrivateRequest('/0/private/Withdraw', { asset: input.asset.toLowerCase(), key: destination.krakenWithdrawalKey, amount: numericString(gross) });
    refid = String(submitted?.refid || '').trim();
    if (!refid) throw new Error('Kraken withdrawal submission returned no durable reference');
  }
  withdrawal = await waitKrakenWithdrawal(input.asset, refid);
  const txId = String(withdrawal?.txid || '').trim();
  if (!txId) throw new Error(`Kraken withdrawal ${refid} reached success without transaction hash`);
  const deposit = await waitOkxDeposit(input.asset, txId, destination.address);
  const delivered = finitePositive(deposit?.amt);
  if (delivered === null) throw new Error('OKX deposit history omitted positive delivered amount');
  const sourceFee = Math.max(0, Number(withdrawal?.fee ?? currentQuote?.fee ?? 0));
  const sourceDebit = Number(withdrawal?.amount || 0) + sourceFee;
  if (!(sourceDebit > 0) || sourceDebit > gross + Math.max(1e-8, gross * 1e-6)) throw new Error('Kraken authenticated withdrawal debit is inconsistent with durable gross request');
  return {
    sourceDebitDecimal: sourceDebit, deliveredDecimal: delivered, sourceFeeDecimal: sourceFee,
    withdrawalReference: refid, transactionHash: txId,
    destinationReference: String(deposit?.depId || deposit?.txId || txId),
    sourceEvidence: { venue: 'kraken', withdrawalStatus: String(withdrawal?.status || ''), withdrawalKey: destination.krakenWithdrawalKey, requestedGrossDecimal: gross, authenticatedNetDecimal: withdrawal?.amount, authenticatedFeeDecimal: sourceFee, reconcileBeforeResubmit: true },
    destinationEvidence: { venue: 'okx', chain: destination.chain, depositAddress: destination.address, depositAccount: destination.depositAccount, exchangeState: String(deposit?.state ?? ''), creditedAmount: delivered, transactionHash: txId },
  };
}

async function transferOkxToKraken(input: {
  transferIdentity: string;
  asset: string;
  desiredNet: number;
  durableSourceDebit: number;
  allowSubmission: boolean;
}): Promise<TransferSettlement> {
  const destination = await resolveKrakenDeposit(input.asset);
  if (input.desiredNet + 1e-12 < destination.okxMinDecimal) throw new Error(`OKX ${input.asset} retained transfer is below authenticated withdrawal minimum`);
  if (destination.okxMaxDecimal !== null && input.desiredNet > destination.okxMaxDecimal + 1e-12) throw new Error(`OKX ${input.asset} retained transfer exceeds authenticated withdrawal maximum`);
  const currentSourceDebit = input.desiredNet + destination.okxFeeDecimal;
  if (currentSourceDebit > input.durableSourceDebit + Math.max(1e-9, input.durableSourceDebit * 1e-8) && input.allowSubmission) {
    throw new Error('pre-submission OKX transfer fee exceeds durable source reservation; fresh intent required');
  }
  const clientId = deterministicClientId(`treasury:${input.transferIdentity}:${input.asset}:${destination.okxChain}:${input.desiredNet}`);
  getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: 'cex:okx', venue: 'okx' });
  let history = await okxPrivateRequest('/api/v5/asset/withdrawal-history', 'GET', { ccy: input.asset, clientId }, { lane: 'account_read' });
  let row = history.data.find((item: any) => String(item?.clientId || '') === clientId);
  let wdId = String(row?.wdId || '').trim();
  if (!wdId) {
    if (!input.allowSubmission) {
      throw new Error('manual review required: prior OKX withdrawal is not recoverable by durable clientId; automatic resubmission forbidden');
    }
    const submission = await okxPrivateRequest('/api/v5/asset/withdrawal', 'POST', {
      ccy: input.asset, amt: numericString(input.desiredNet), dest: '4', toAddr: destination.address,
      fee: numericString(destination.okxFeeDecimal), chain: destination.okxChain, clientId,
    }, { lane: 'order_write' });
    wdId = String(submission.data[0]?.wdId || '').trim();
    if (!wdId) {
      history = await okxPrivateRequest('/api/v5/asset/withdrawal-history', 'GET', { ccy: input.asset, clientId }, { lane: 'account_read' });
      row = history.data.find((item: any) => String(item?.clientId || '') === clientId);
      wdId = String(row?.wdId || '').trim();
    }
    if (!wdId) throw new Error('OKX transfer withdrawal submission is ambiguous and cannot be recovered by clientId');
  }
  row = await waitOkxWithdrawal(input.asset, wdId);
  const txId = String(row?.txId || '').trim();
  if (!txId) throw new Error(`OKX withdrawal ${wdId} reached success without transaction hash`);
  const deposit = await waitKrakenDeposit(input.asset, destination.method, txId, destination.address);
  const delivered = finitePositive(deposit?.amount);
  if (delivered === null) throw new Error('Kraken deposit status omitted positive delivered amount');
  const sourceFee = Math.max(0, Number(row?.fee ?? destination.okxFeeDecimal));
  const sourceDebit = input.desiredNet + sourceFee;
  if (sourceDebit > input.durableSourceDebit + Math.max(1e-9, input.durableSourceDebit * 1e-8)) {
    throw new Error('OKX authenticated withdrawal debit exceeds durable source reservation');
  }
  return {
    sourceDebitDecimal: sourceDebit, deliveredDecimal: delivered, sourceFeeDecimal: sourceFee,
    withdrawalReference: wdId, transactionHash: txId,
    destinationReference: String(deposit?.refid || deposit?.txid || txId),
    sourceEvidence: { venue: 'okx', withdrawalState: String(row?.state ?? ''), clientId, chain: destination.okxChain, requestedNetDecimal: input.desiredNet, authenticatedFeeDecimal: sourceFee, reconcileBeforeResubmit: true },
    destinationEvidence: { venue: 'kraken', method: destination.method, depositAddress: destination.address, depositStatus: String(deposit?.status || ''), creditedAmount: delivered, originators: Array.isArray(deposit?.originators) ? deposit.originators : [], transactionHash: txId },
  };
}

async function transferBetweenVenues(input: {
  identity: string;
  sourceVenue: Venue;
  targetVenue: Venue;
  asset: string;
  desiredNet: number;
  durableSourceDebit: number;
  createdAt: number;
  allowSubmission: boolean;
}): Promise<TransferSettlement> {
  if (input.sourceVenue === input.targetVenue) throw new Error('treasury CEX transfer requires distinct venues');
  if (!TRANSFERABLE_ASSETS.has(input.asset)) throw new Error(`treasury CEX transfer does not have settlement-safe network handling for ${input.asset}`);
  if (input.sourceVenue === 'coinbase' && input.targetVenue === 'okx') {
    const prepared = await prepareCoinbaseToOkxTransfer(input.asset, input.desiredNet);
    if (input.allowSubmission && prepared.sourceReservationCeiling > input.durableSourceDebit + Math.max(1e-9, input.durableSourceDebit * 1e-8)) {
      throw new Error('pre-submission Coinbase transfer cost ceiling exceeds durable source reservation; fresh intent required');
    }
    // Coinbase Transfer API uses the transfer identity as deterministic idem. A
    // repeated call with the same idem recovers the prior transaction rather than
    // granting a second transfer identity.
    return executeCoinbaseToOkxTransfer({ transferIdentity: input.identity, prepared });
  }
  if (input.sourceVenue === 'kraken' && input.targetVenue === 'okx') {
    return transferKrakenToOkx({
      transferIdentity: input.identity,
      asset: input.asset,
      desiredNet: input.desiredNet,
      createdAt: input.createdAt,
      durableGrossSourceDebit: input.durableSourceDebit,
      allowSubmission: input.allowSubmission,
    });
  }
  if (input.sourceVenue === 'okx' && input.targetVenue === 'kraken') {
    return transferOkxToKraken({
      transferIdentity: input.identity,
      asset: input.asset,
      desiredNet: input.desiredNet,
      durableSourceDebit: input.durableSourceDebit,
      allowSubmission: input.allowSubmission,
    });
  }
  throw new Error(`treasury CEX transfer route ${input.sourceVenue}->${input.targetVenue} is not yet settlement-proven; no alternate submission is allowed`);
}

async function persistTransferSettlementIdentity(transferId: string, settlement: TransferSettlement): Promise<void> {
  await pool.query(
    `UPDATE public.cryptocrawler_system_capital_transfers
     SET source_reference=COALESCE(NULLIF(source_reference,''),$2),
         transaction_hash=COALESCE(NULLIF(transaction_hash,''),$3),
         source_evidence=COALESCE(source_evidence,'{}'::jsonb)
           || jsonb_build_object('withdrawalReference',$2,'terminalSourceEvidence',$4::jsonb),
         destination_evidence=COALESCE(destination_evidence,'{}'::jsonb)
           || jsonb_build_object('terminalDestinationEvidence',$5::jsonb),
         updated_at=now()
     WHERE transfer_id=$1::uuid AND status<>'CONFIRMED'`,
    [transferId, settlement.withdrawalReference, settlement.transactionHash, JSON.stringify(settlement.sourceEvidence), JSON.stringify(settlement.destinationEvidence)],
  );
}

function settlementFromConfirmedSystemTransfer(row: any): TransferSettlement | null {
  if (String(row?.status || '') !== 'CONFIRMED') return null;
  const deliveredDecimal = finitePositive(row?.delivered_destination_decimal);
  const sourceFeeDecimal = finiteNonNegative(row?.source_fee_decimal);
  const sourceEvidenceRoot = objectRecord(row?.source_evidence);
  const destinationEvidenceRoot = objectRecord(row?.destination_evidence);
  const sourceEvidence = objectRecord(sourceEvidenceRoot.terminalSourceEvidence || destinationEvidenceRoot.source || sourceEvidenceRoot);
  const destinationEvidence = objectRecord(destinationEvidenceRoot.terminalDestinationEvidence || destinationEvidenceRoot.destination || destinationEvidenceRoot);
  const withdrawalReference = String(row?.source_reference || sourceEvidenceRoot.withdrawalReference || sourceEvidence.withdrawalReference || '').trim();
  const transactionHash = String(row?.transaction_hash || '').trim();
  const destinationReference = String(row?.destination_reference || '').trim();
  if (deliveredDecimal === null || sourceFeeDecimal === null || !withdrawalReference || !transactionHash || !destinationReference) return null;
  const sourceDebitDecimal = finitePositive(sourceEvidence.authenticatedSourceDebitDecimal || sourceEvidence.sourceDebitDecimal || row?.requested_source_decimal);
  if (sourceDebitDecimal === null) return null;
  return { sourceDebitDecimal, deliveredDecimal, sourceFeeDecimal, withdrawalReference, transactionHash, destinationReference, sourceEvidence, destinationEvidence };
}

async function finalizePayoutFromConfirmedSystemTransfer(eventId: string, systemTransfer: any): Promise<boolean> {
  const settlement = settlementFromConfirmedSystemTransfer(systemTransfer);
  if (!settlement) {
    throw new Error('manual review required: confirmed payout-funding ownership transfer lacks persisted terminal evidence required to finish payout state without resubmission');
  }
  await pool.query(
    `UPDATE public.cryptocrawler_payout_funding_transfers
     SET status='SETTLING', updated_at=now(), last_error=NULL
     WHERE event_id=$1 AND status IN ('PREPARED','RETRYABLE','SUBMITTED','SETTLING')`,
    [eventId],
  );
  const confirmed = await pool.query(
    `SELECT public.cryptocrawler_confirm_payout_funding_transfer($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) AS confirmed`,
    [eventId, settlement.deliveredDecimal, settlement.sourceFeeDecimal, settlement.withdrawalReference, settlement.transactionHash, settlement.destinationReference, JSON.stringify(settlement.sourceEvidence), JSON.stringify(settlement.destinationEvidence)],
  );
  return confirmed.rows[0]?.confirmed === true;
}

async function claimRetainedCandidate(): Promise<RetainedRow | null> {
  const result = await pool.query(
    `WITH candidate AS (
       SELECT r.event_id FROM public.cryptocrawler_retained_exchange_allocations r
       LEFT JOIN public.cryptocrawler_profit_payout_jobs j USING (event_id)
       WHERE r.status IN ('IN_PLACE','TRANSFER_REQUIRED','RETRYABLE')
         AND (r.last_attempt_at IS NULL OR r.last_attempt_at <= now() - make_interval(secs => $1))
       ORDER BY r.created_at FOR UPDATE OF r SKIP LOCKED LIMIT 1
     )
     UPDATE public.cryptocrawler_retained_exchange_allocations r
     SET last_attempt_at=now(), attempt_count=r.attempt_count+1, updated_at=now()
     FROM candidate, public.cryptocrawler_profit_payout_jobs j
     WHERE r.event_id=candidate.event_id AND j.event_id=r.event_id
     RETURNING r.event_id, r.retained_usd, r.target_venue, r.source_venue, r.status,
               r.source_asset, j.source_asset AS payout_source_asset`,
    [Math.ceil(RETRY_AFTER_MS / 1000)],
  );
  return result.rows[0] as RetainedRow | undefined || null;
}

async function systemOwnedAvailable(venue: Venue, asset: string): Promise<number> {
  const result = await pool.query(
    `SELECT greatest(0,
       COALESCE((SELECT SUM(remaining_decimal) FROM public.cryptocrawler_cex_system_owned_lots
                 WHERE venue=$1 AND asset=$2 AND status='ACTIVE' AND remaining_decimal>0),0)
       - COALESCE((SELECT SUM(tl.reserved_decimal)
                   FROM public.cryptocrawler_system_capital_transfer_lots tl
                   JOIN public.cryptocrawler_system_capital_transfers t USING (transfer_id)
                   JOIN public.cryptocrawler_cex_system_owned_lots lot USING (lot_id)
                   WHERE lot.venue=$1 AND lot.asset=$2
                     AND t.status IN ('PREPARED','SUBMITTED','SETTLING','RETRYABLE','MANUAL_REVIEW')),0)
     )::text AS available_decimal`, [venue, asset]);
  const value = Number(result.rows[0]?.available_decimal || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function updateRetained(eventId: string, patch: Record<string, unknown>): Promise<void> {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const values = fields.map(field => patch[field]);
  const assignments = fields.map((field, index) => `${field}=$${index + 2}`).join(', ');
  await pool.query(`UPDATE public.cryptocrawler_retained_exchange_allocations SET ${assignments}, updated_at=now() WHERE event_id=$1`, [eventId, ...values]);
}

async function processRetainedCandidate(row: RetainedRow): Promise<void> {
  const sourceVenueRaw = String(row.source_venue || '').trim().toLowerCase();
  const sourceVenue = ['coinbase','kraken','okx'].includes(sourceVenueRaw) ? sourceVenueRaw as Venue : null;
  const targetRaw = String(row.target_venue || '').trim().toLowerCase();
  const targetVenue = ['coinbase','kraken','okx'].includes(targetRaw) ? targetRaw as Venue : null;
  const asset = canonicalAsset(row.source_asset || row.payout_source_asset);
  const retainedUsd = finitePositive(row.retained_usd);
  if (!sourceVenue || !targetVenue || !TRANSFERABLE_ASSETS.has(asset) || retainedUsd === null) {
    await updateRetained(row.event_id, { status: 'BLOCKED', last_error: `retained routing requires a supported Coinbase/Kraken/OKX source/target, transferable asset, and positive terminal retained value; source=${sourceVenueRaw || 'unknown'} target=${targetRaw || 'unknown'} asset=${asset || 'unknown'}` });
    return;
  }

  if (sourceVenue === targetVenue) {
    const price = await assetUsdPrice(asset);
    const desiredAmount = retainedUsd / price.price;
    if (!(desiredAmount > 0) || !Number.isFinite(desiredAmount)) throw new Error('retained target amount could not be derived from live price');
    const available = await systemOwnedAvailable(sourceVenue, asset);
    if (available + 1e-10 < desiredAmount) {
      await updateRetained(row.event_id, {
        status: 'BLOCKED', source_asset: asset, source_unit_price_usd: price.price,
        source_price_observed_at: new Date(price.observedAt), source_amount_decimal: desiredAmount,
        last_error: 'retained profit exists economically but is not backed by enough settlement-derived system-owned CEX lots; operator balance promotion is forbidden',
      });
      return;
    }
    await updateRetained(row.event_id, {
      status: 'PLACED', source_asset: asset, source_unit_price_usd: price.price,
      source_price_observed_at: new Date(price.observedAt), source_amount_decimal: desiredAmount,
      settlement_evidence: JSON.stringify({ mode: 'in_place', venue: sourceVenue, asset, amountDecimal: desiredAmount, unitPriceUsd: price.price, priceObservedAt: new Date(price.observedAt).toISOString(), ownershipAuthority: 'cryptocrawler_cex_system_owned_lots', operatorBalancePromoted: false }),
      last_error: null,
    });
    return;
  }

  if ((sourceVenue === 'coinbase' || targetVenue === 'coinbase') && !(sourceVenue === 'coinbase' && targetVenue === 'okx')) {
    await updateRetained(row.event_id, {
      status: 'BLOCKED', source_asset: asset,
      last_error: `cross-venue retained route ${sourceVenue}->${targetVenue} is not yet settlement-proven; new dynamic Rainbow allocations keep Coinbase capital in place instead of paying unnecessary transfer cost`,
    });
    return;
  }

  let transferRow = (await pool.query(`SELECT * FROM public.cryptocrawler_system_capital_transfers WHERE transfer_kind='RETAINED_ROUTE' AND source_event_id=$1 LIMIT 1`, [row.event_id])).rows[0];
  if (transferRow?.status === 'CONFIRMED') {
    await updateRetained(row.event_id, { status: 'PLACED', transfer_id: transferRow.transfer_id, transfer_reference: transferRow.destination_reference, transaction_hash: transferRow.transaction_hash, settlement_evidence: JSON.stringify(transferRow.destination_evidence || {}), last_error: null });
    return;
  }
  if (transferRow?.status === 'MANUAL_REVIEW') {
    await updateRetained(row.event_id, { status: 'MANUAL_REVIEW', transfer_id: transferRow.transfer_id, last_error: transferRow.last_error || 'treasury transfer requires manual reconciliation' });
    return;
  }

  let desiredAmount: number;
  let maximumSourceDebit: number;
  let price: { price: number; observedAt: number } | null = null;
  let coinbasePrepared: CoinbaseToOkxPreparedTransfer | null = null;

  if (transferRow && transferRow.status !== 'RELEASED') {
    if (String(transferRow.source_venue) !== sourceVenue || String(transferRow.target_venue) !== targetVenue || canonicalAsset(transferRow.asset) !== asset) {
      throw new Error('durable retained transfer route differs from current allocation identity');
    }
    desiredAmount = finitePositive(transferRow.requested_destination_decimal) || 0;
    maximumSourceDebit = finitePositive(transferRow.requested_source_decimal) || 0;
    if (!(desiredAmount > 0) || !(maximumSourceDebit > 0)) throw new Error('durable retained transfer amounts are invalid');
    if (sourceVenue === 'coinbase' && targetVenue === 'okx') coinbasePrepared = await prepareCoinbaseToOkxTransfer(asset, desiredAmount);
  } else {
    price = await assetUsdPrice(asset);
    desiredAmount = retainedUsd / price.price;
    if (!(desiredAmount > 0) || !Number.isFinite(desiredAmount)) throw new Error('retained target amount could not be derived from live price');
    maximumSourceDebit = desiredAmount;
    if (sourceVenue === 'coinbase' && targetVenue === 'okx') {
      coinbasePrepared = await prepareCoinbaseToOkxTransfer(asset, desiredAmount);
      maximumSourceDebit = coinbasePrepared.sourceReservationCeiling;
    } else if (sourceVenue === 'okx') {
      const destination = await resolveKrakenDeposit(asset);
      maximumSourceDebit = desiredAmount + destination.okxFeeDecimal;
    } else {
      const destination = await resolveOkxDeposit(asset);
      maximumSourceDebit = (await krakenGrossForNet(asset, destination.krakenWithdrawalKey, desiredAmount)).gross;
    }
  }

  if (!transferRow) {
    const transferId = randomUUID();
    const inserted = await pool.query(
      `INSERT INTO public.cryptocrawler_system_capital_transfers
        (transfer_id, transfer_kind, source_venue, target_kind, target_venue, asset,
         requested_source_decimal, requested_destination_decimal, status, source_event_id,
         source_evidence, created_at, updated_at)
       VALUES ($1,'RETAINED_ROUTE',$2,'cex',$3,$4,$5,$6,'PREPARED',$7,$8::jsonb,now(),now())
       ON CONFLICT (source_event_id) WHERE transfer_kind='RETAINED_ROUTE' AND source_event_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [transferId, sourceVenue, targetVenue, asset, maximumSourceDebit, desiredAmount, row.event_id,
        JSON.stringify({ retainedUsd, ...(price ? { unitPriceUsd: price.price, priceObservedAt: new Date(price.observedAt).toISOString() } : {}), ...(coinbasePrepared ? { coinbaseSourceReservationCeiling: coinbasePrepared.sourceReservationCeiling, network: coinbasePrepared.network } : {}) })],
    );
    transferRow = inserted.rows[0];
    if (!transferRow) transferRow = (await pool.query(`SELECT * FROM public.cryptocrawler_system_capital_transfers WHERE transfer_kind='RETAINED_ROUTE' AND source_event_id=$1 LIMIT 1`, [row.event_id])).rows[0];
  } else if (transferRow.status === 'RELEASED') {
    await pool.query(
      `UPDATE public.cryptocrawler_system_capital_transfers
       SET status='PREPARED', requested_source_decimal=$2, requested_destination_decimal=$3,
           source_reference=NULL, destination_reference=NULL, transaction_hash=NULL,
           source_evidence=$4::jsonb, destination_evidence='{}'::jsonb,
           submitted_at=NULL, confirmed_at=NULL, last_attempt_at=NULL, attempt_count=0,
           updated_at=now(), last_error=NULL
       WHERE transfer_id=$1 AND status='RELEASED'`,
      [transferRow.transfer_id, maximumSourceDebit, desiredAmount, JSON.stringify({ retainedUsd, ...(price ? { unitPriceUsd: price.price, priceObservedAt: new Date(price.observedAt).toISOString() } : {}), ...(coinbasePrepared ? { coinbaseSourceReservationCeiling: coinbasePrepared.sourceReservationCeiling, network: coinbasePrepared.network } : {}) })],
    );
    transferRow = (await pool.query(`SELECT * FROM public.cryptocrawler_system_capital_transfers WHERE transfer_id=$1`, [transferRow.transfer_id])).rows[0];
  }
  if (!transferRow?.transfer_id) throw new Error('retained transfer intent could not be persisted');

  desiredAmount = finitePositive(transferRow.requested_destination_decimal) || 0;
  maximumSourceDebit = finitePositive(transferRow.requested_source_decimal) || 0;
  if (!(desiredAmount > 0) || !(maximumSourceDebit > 0)) throw new Error('retained transfer durable amounts are unavailable');
  const transferId = String(transferRow.transfer_id);
  const hadSubmissionHistory = submittedBefore(transferRow);

  const reserved = await pool.query(`SELECT public.cryptocrawler_reserve_system_capital_transfer($1::uuid,$2,$3,$4) AS reserved`, [transferId, sourceVenue, asset, maximumSourceDebit]);
  if (Number(reserved.rows[0]?.reserved || 0) + 1e-12 < maximumSourceDebit) {
    if (hadSubmissionHistory) {
      await updateRetained(row.event_id, { status: 'MANUAL_REVIEW', transfer_id: transferId, last_error: 'ambiguous retained transfer reservation could not be proven intact; automatic resubmission forbidden' });
      return;
    }
    await pool.query(`SELECT public.cryptocrawler_release_system_capital_transfer($1::uuid)`, [transferId]).catch(() => undefined);
    await updateRetained(row.event_id, { status: 'BLOCKED', source_asset: asset, source_amount_decimal: desiredAmount, transfer_id: transferId, last_error: 'retained routing refused because settlement-derived system-owned lots are insufficient; operator/account-wide balances cannot satisfy provenance' });
    return;
  }

  await pool.query(`UPDATE public.cryptocrawler_system_capital_transfers SET status='SUBMITTED', submitted_at=COALESCE(submitted_at,now()), last_attempt_at=now(), attempt_count=attempt_count+1, updated_at=now(), last_error=NULL WHERE transfer_id=$1 AND status IN ('PREPARED','RETRYABLE','SUBMITTED','SETTLING')`, [transferId]);
  await updateRetained(row.event_id, { status: 'SUBMITTED', source_asset: asset, source_amount_decimal: desiredAmount, transfer_id: transferId, last_error: null });

  const settlement = await transferBetweenVenues({
    identity: transferId,
    sourceVenue,
    targetVenue,
    asset,
    desiredNet: desiredAmount,
    durableSourceDebit: maximumSourceDebit,
    createdAt: transferRow.created_at ? new Date(transferRow.created_at).getTime() : Date.now(),
    allowSubmission: !hadSubmissionHistory,
  });
  await persistTransferSettlementIdentity(transferId, settlement);
  await pool.query(`UPDATE public.cryptocrawler_system_capital_transfers SET status='SETTLING', updated_at=now() WHERE transfer_id=$1 AND status<>'CONFIRMED'`, [transferId]);
  const confirmed = await pool.query(
    `SELECT public.cryptocrawler_confirm_system_capital_transfer_exact($1::uuid,$2,$3,$4,$5,$6,$7::jsonb) AS confirmed`,
    [transferId, settlement.sourceDebitDecimal, settlement.deliveredDecimal, settlement.sourceFeeDecimal, settlement.destinationReference, settlement.transactionHash, JSON.stringify({ source: settlement.sourceEvidence, destination: settlement.destinationEvidence })],
  );
  if (confirmed.rows[0]?.confirmed !== true) throw new Error('exact retained CEX transfer confirmation was rejected by the ownership ledger');
  await updateRetained(row.event_id, { status: 'PLACED', transfer_reference: settlement.destinationReference, transaction_hash: settlement.transactionHash, settlement_evidence: JSON.stringify({ source: settlement.sourceEvidence, destination: settlement.destinationEvidence }), last_error: null });
}

async function claimPayoutFundingCandidate(): Promise<PayoutFundingRow | null> {
  const result = await pool.query(
    `SELECT j.event_id, j.source_venue, j.source_asset, j.payout_target_usd, j.payout_paid_usd,
            r.reserved_asset_amount, r.remaining_asset_amount, r.venue AS reservation_venue
     FROM public.cryptocrawler_profit_payout_jobs j
     JOIN public.cryptocrawler_payout_asset_reservations r USING (event_id)
     LEFT JOIN public.cryptocrawler_payout_funding_transfers f USING (event_id)
     WHERE lower(COALESCE(j.source_venue,'')) IN ('coinbase','kraken')
       AND lower(r.venue)=lower(j.source_venue)
       AND r.status IN ('HELD','IN_FLIGHT') AND r.remaining_asset_amount > 0
       AND j.status IN ('QUEUED','RETRYABLE')
       AND (f.event_id IS NULL OR f.status IN ('PREPARED','RETRYABLE','SUBMITTED','SETTLING'))
       AND (f.last_attempt_at IS NULL OR f.last_attempt_at <= now() - make_interval(secs => $1))
     ORDER BY j.created_at LIMIT 1`, [Math.ceil(RETRY_AFTER_MS / 1000)]);
  return result.rows[0] as PayoutFundingRow | undefined || null;
}

async function processPayoutFunding(row: PayoutFundingRow): Promise<void> {
  const sourceVenue = String(row.source_venue || '').trim().toLowerCase() as 'coinbase' | 'kraken';
  const asset = canonicalAsset(row.source_asset);
  if (!['coinbase','kraken'].includes(sourceVenue) || !TRANSFERABLE_ASSETS.has(asset)) {
    await pool.query(`UPDATE public.cryptocrawler_profit_payout_jobs SET status='MANUAL_REVIEW', last_error=$2, updated_at=now() WHERE event_id=$1`, [row.event_id, `Payout source ${sourceVenue || 'unknown'}:${asset || 'unknown'} has no settlement-safe route to the canonical OKX ETH payout executor`]);
    return;
  }

  let fundingRow = (await pool.query(`SELECT * FROM public.cryptocrawler_payout_funding_transfers WHERE event_id=$1`, [row.event_id])).rows[0];
  if (fundingRow?.status === 'CONFIRMED') return;

  let systemTransfer = fundingRow?.transfer_id
    ? (await pool.query(`SELECT * FROM public.cryptocrawler_system_capital_transfers WHERE transfer_id=$1::uuid`, [String(fundingRow.transfer_id)])).rows[0]
    : null;

  if (systemTransfer?.status === 'CONFIRMED') {
    if (!await finalizePayoutFromConfirmedSystemTransfer(row.event_id, systemTransfer)) {
      throw new Error(`${sourceVenue} payout funding could not finalize from already-confirmed ownership transfer`);
    }
    return;
  }

  if (systemTransfer?.status === 'MANUAL_REVIEW') {
    await pool.query(`UPDATE public.cryptocrawler_payout_funding_transfers SET status='MANUAL_REVIEW', last_error=COALESCE(last_error,$2), updated_at=now() WHERE event_id=$1 AND status<>'CONFIRMED'`, [row.event_id, systemTransfer.last_error || 'payout funding ownership transfer requires manual reconciliation']);
    return;
  }

  let desiredNet: number;
  let requestedSource: number;
  let withdrawalKey: string | null = null;
  let coinbasePrepared: CoinbaseToOkxPreparedTransfer | null = null;

  if (fundingRow) {
    if (String(fundingRow.source_venue) !== sourceVenue || canonicalAsset(fundingRow.asset) !== asset || String(fundingRow.target_venue) !== 'okx') {
      throw new Error('durable payout funding route differs from current payout reservation identity');
    }
    desiredNet = finitePositive(fundingRow.expected_destination_decimal) || 0;
    requestedSource = finitePositive(fundingRow.requested_source_decimal) || 0;
    withdrawalKey = String(fundingRow.withdrawal_key || '').trim() || null;
    if (!(desiredNet > 0) || !(requestedSource > 0)) throw new Error('durable payout funding amounts are invalid');
    if (sourceVenue === 'coinbase') coinbasePrepared = await prepareCoinbaseToOkxTransfer(asset, desiredNet);
  } else {
    desiredNet = finitePositive(row.remaining_asset_amount) || 0;
    if (!(desiredNet > 0)) return;
    if (sourceVenue === 'coinbase') {
      coinbasePrepared = await prepareCoinbaseToOkxTransfer(asset, desiredNet);
      requestedSource = coinbasePrepared.sourceReservationCeiling;
    } else {
      const destination = await resolveOkxDeposit(asset);
      const quote = await krakenGrossForNet(asset, destination.krakenWithdrawalKey, desiredNet);
      requestedSource = quote.gross;
      withdrawalKey = destination.krakenWithdrawalKey;
    }

    const transferId = randomUUID();
    const inserted = await pool.query(
      `INSERT INTO public.cryptocrawler_payout_funding_transfers
        (event_id, transfer_id, source_venue, target_venue, asset,
         requested_source_decimal, expected_destination_decimal, status, withdrawal_key,
         source_evidence, created_at, updated_at)
       VALUES ($1,$2,$3,'okx',$4,$5,$6,'PREPARED',$7,$8::jsonb,now(),now())
       ON CONFLICT (event_id) DO NOTHING RETURNING *`,
      [row.event_id, transferId, sourceVenue, asset, requestedSource, desiredNet, withdrawalKey,
        JSON.stringify({ reservationVenue: row.reservation_venue, durablePayoutReservation: row.remaining_asset_amount, ...(coinbasePrepared ? { coinbaseSourceReservationCeiling: coinbasePrepared.sourceReservationCeiling, network: coinbasePrepared.network } : {}) })],
    );
    fundingRow = inserted.rows[0];
    if (!fundingRow) fundingRow = (await pool.query(`SELECT * FROM public.cryptocrawler_payout_funding_transfers WHERE event_id=$1`, [row.event_id])).rows[0];
  }

  if (!fundingRow) throw new Error(`${sourceVenue} payout funding intent could not be persisted`);
  if (fundingRow.status === 'CONFIRMED') return;
  desiredNet = finitePositive(fundingRow.expected_destination_decimal) || 0;
  requestedSource = finitePositive(fundingRow.requested_source_decimal) || 0;
  if (!(desiredNet > 0) || !(requestedSource > 0)) throw new Error('payout funding durable amounts are unavailable');

  const shadowTransferId = String(fundingRow.transfer_id);
  if (!systemTransfer) {
    if (submittedBefore(fundingRow)) {
      throw new Error('manual review required: submitted payout funding lost its provenance transfer row; automatic resubmission forbidden');
    }
    await pool.query(
      `INSERT INTO public.cryptocrawler_system_capital_transfers
        (transfer_id, transfer_kind, source_venue, target_kind, target_venue, asset,
         requested_source_decimal, requested_destination_decimal, status, payout_event_id,
         source_evidence, created_at, updated_at)
       VALUES ($1::uuid,'PAYOUT_FUNDING',$2,'cex','okx',$3,$4,$5,'PREPARED',$6,$7::jsonb,now(),now())
       ON CONFLICT (transfer_id) DO NOTHING`,
      [shadowTransferId, sourceVenue, asset, requestedSource, desiredNet, row.event_id, JSON.stringify({ payoutFundingTable: true })],
    );
    systemTransfer = (await pool.query(`SELECT * FROM public.cryptocrawler_system_capital_transfers WHERE transfer_id=$1::uuid`, [shadowTransferId])).rows[0];
  }
  if (!systemTransfer) throw new Error('payout funding provenance transfer could not be persisted');
  if (systemTransfer.status === 'CONFIRMED') {
    if (!await finalizePayoutFromConfirmedSystemTransfer(row.event_id, systemTransfer)) throw new Error('confirmed ownership transfer could not finalize payout funding state');
    return;
  }
  if (String(systemTransfer.source_venue) !== sourceVenue || canonicalAsset(systemTransfer.asset) !== asset || String(systemTransfer.target_venue) !== 'okx') {
    throw new Error('durable payout system-transfer route differs from payout funding identity');
  }
  if (Math.abs(Number(systemTransfer.requested_source_decimal) - requestedSource) > Math.max(1e-12, requestedSource * 1e-10)
      || Math.abs(Number(systemTransfer.requested_destination_decimal) - desiredNet) > Math.max(1e-12, desiredNet * 1e-10)) {
    throw new Error('durable payout system-transfer amounts differ from payout funding identity');
  }

  const hadSubmissionHistory = submittedBefore(systemTransfer) || submittedBefore(fundingRow);
  const reserved = await pool.query(`SELECT public.cryptocrawler_reserve_system_capital_transfer($1::uuid,$2,$3,$4) AS reserved`, [shadowTransferId, sourceVenue, asset, requestedSource]);
  if (Number(reserved.rows[0]?.reserved || 0) + 1e-12 < requestedSource) {
    if (hadSubmissionHistory) throw new Error('manual review required: submitted payout-funding reservation is not intact; automatic resubmission forbidden');
    throw new Error(`${sourceVenue} payout funding lacks provenance-backed source units including transfer-cost ceiling`);
  }

  await pool.query(`UPDATE public.cryptocrawler_payout_funding_transfers SET status='SUBMITTED', submitted_at=COALESCE(submitted_at,now()), last_attempt_at=now(), attempt_count=attempt_count+1, updated_at=now(), last_error=NULL WHERE event_id=$1 AND status IN ('PREPARED','RETRYABLE','SUBMITTED','SETTLING')`, [row.event_id]);
  await pool.query(`UPDATE public.cryptocrawler_system_capital_transfers SET status='SUBMITTED', submitted_at=COALESCE(submitted_at,now()), last_attempt_at=now(), attempt_count=attempt_count+1, updated_at=now(), last_error=NULL WHERE transfer_id=$1::uuid AND status IN ('PREPARED','RETRYABLE','SUBMITTED','SETTLING')`, [shadowTransferId]);

  const settlement = await transferBetweenVenues({
    identity: shadowTransferId,
    sourceVenue,
    targetVenue: 'okx',
    asset,
    desiredNet,
    durableSourceDebit: requestedSource,
    createdAt: fundingRow.created_at ? new Date(fundingRow.created_at).getTime() : Date.now(),
    allowSubmission: !hadSubmissionHistory,
  });
  await persistTransferSettlementIdentity(shadowTransferId, settlement);
  await pool.query(`UPDATE public.cryptocrawler_payout_funding_transfers SET status='SETTLING', updated_at=now() WHERE event_id=$1 AND status<>'CONFIRMED'`, [row.event_id]);
  await pool.query(`UPDATE public.cryptocrawler_system_capital_transfers SET status='SETTLING', updated_at=now() WHERE transfer_id=$1::uuid AND status<>'CONFIRMED'`, [shadowTransferId]);

  const ownershipConfirmed = await pool.query(
    `SELECT public.cryptocrawler_confirm_system_capital_transfer_exact($1::uuid,$2,$3,$4,$5,$6,$7::jsonb) AS confirmed`,
    [shadowTransferId, settlement.sourceDebitDecimal, settlement.deliveredDecimal, settlement.sourceFeeDecimal, settlement.destinationReference, settlement.transactionHash, JSON.stringify({ source: settlement.sourceEvidence, destination: settlement.destinationEvidence })],
  );
  if (ownershipConfirmed.rows[0]?.confirmed !== true) throw new Error(`${sourceVenue} payout funding ownership transfer confirmation was rejected`);

  const confirmed = await pool.query(
    `SELECT public.cryptocrawler_confirm_payout_funding_transfer($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) AS confirmed`,
    [row.event_id, settlement.deliveredDecimal, settlement.sourceFeeDecimal, settlement.withdrawalReference, settlement.transactionHash, settlement.destinationReference, JSON.stringify(settlement.sourceEvidence), JSON.stringify(settlement.destinationEvidence)],
  );
  if (confirmed.rows[0]?.confirmed !== true) throw new Error(`${sourceVenue} payout funding transfer confirmation was rejected`);
}

async function recordFailure(table: 'retained' | 'payout', key: string, error: unknown): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  const manual = manualReviewError(message);
  if (table === 'retained') {
    const transfer = (await pool.query(`SELECT transfer_id, status, submitted_at FROM public.cryptocrawler_system_capital_transfers WHERE transfer_kind='RETAINED_ROUTE' AND source_event_id=$1 LIMIT 1`, [key]).catch(() => ({ rows: [] as any[] }))).rows[0];
    if (transfer && transfer.status !== 'CONFIRMED') {
      if (!submittedBefore(transfer) && !manual) {
        await pool.query(`SELECT public.cryptocrawler_release_system_capital_transfer($1::uuid)`, [transfer.transfer_id]).catch(() => undefined);
      } else {
        await pool.query(`UPDATE public.cryptocrawler_system_capital_transfers SET status=$2, last_error=$3, updated_at=now() WHERE transfer_id=$1::uuid AND status<>'CONFIRMED'`, [transfer.transfer_id, manual ? 'MANUAL_REVIEW' : 'RETRYABLE', message]).catch(() => undefined);
      }
    }
    await pool.query(`UPDATE public.cryptocrawler_retained_exchange_allocations SET status=$2, last_error=$3, updated_at=now() WHERE event_id=$1 AND status<>'PLACED'`, [key, manual ? 'MANUAL_REVIEW' : 'RETRYABLE', message]).catch(() => undefined);
  } else {
    const funding = (await pool.query(`SELECT transfer_id FROM public.cryptocrawler_payout_funding_transfers WHERE event_id=$1 LIMIT 1`, [key]).catch(() => ({ rows: [] as any[] }))).rows[0];
    const transfer = funding?.transfer_id
      ? (await pool.query(`SELECT transfer_id, status, submitted_at FROM public.cryptocrawler_system_capital_transfers WHERE transfer_id=$1::uuid`, [funding.transfer_id]).catch(() => ({ rows: [] as any[] }))).rows[0]
      : null;
    if (transfer && transfer.status !== 'CONFIRMED') {
      if (!submittedBefore(transfer) && !manual) {
        await pool.query(`SELECT public.cryptocrawler_release_system_capital_transfer($1::uuid)`, [transfer.transfer_id]).catch(() => undefined);
      } else {
        await pool.query(`UPDATE public.cryptocrawler_system_capital_transfers SET status=$2, last_error=$3, updated_at=now() WHERE transfer_id=$1::uuid AND status<>'CONFIRMED'`, [transfer.transfer_id, manual ? 'MANUAL_REVIEW' : 'RETRYABLE', message]).catch(() => undefined);
      }
    }
    await pool.query(`UPDATE public.cryptocrawler_payout_funding_transfers SET status=$2, last_error=$3, updated_at=now() WHERE event_id=$1 AND status<>'CONFIRMED'`, [key, manual ? 'MANUAL_REVIEW' : 'RETRYABLE', message]).catch(() => undefined);
  }
  logger.warn('[TreasuryTransfer] CEX treasury transfer deferred', {
    component: 'CexTreasuryTransferWorker', kind: table, key, error: message,
    reconcileBeforeResubmitRequired: true, duplicateSubmissionAllowed: false,
    operatorBalanceAuthorityGranted: false,
  });
}

async function processOnce(): Promise<void> {
  if (!isDatabaseConfigured || !liveExecutionPosture()) return;
  const payout = await claimPayoutFundingCandidate();
  if (payout) {
    try { await processPayoutFunding(payout); } catch (error) { await recordFailure('payout', payout.event_id, error); }
    return;
  }
  const retained = await claimRetainedCandidate();
  if (retained) {
    try { await processRetainedCandidate(retained); } catch (error) { await recordFailure('retained', retained.event_id, error); }
  }
}

export async function runCexTreasuryTransferOnce(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = processOnce().finally(() => { inFlight = null; });
  return inFlight;
}

export function ensureCexTreasuryTransferWorker(): void {
  if (timer || process.env.NO_INTERVALS === 'true') return;
  timer = setInterval(() => void runCexTreasuryTransferOnce(), WORKER_INTERVAL_MS);
  timer.unref?.();
  void runCexTreasuryTransferOnce();
  logger.info('[TreasuryTransfer] Settlement-proven Coinbase/Kraken/OKX treasury transfer worker online', {
    component: 'CexTreasuryTransferWorker', intervalMs: WORKER_INTERVAL_MS,
    retainedRouting: 'system_owned_lots_only', payoutFunding: 'terminal_profit_reservation_only',
    coinbaseWithdrawalRecovery: 'uuid_idempotency+terminal_transaction_poll',
    krakenWithdrawalRecovery: 'durable_amount_status_match_before_resubmit',
    okxWithdrawalRecovery: 'durable_client_id',
    payoutConfirmedOwnershipCrashRecovery: true,
    targetDepositConfirmationRequired: true, rawAccountBalanceAuthority: false,
  });
}

export function stopCexTreasuryTransferWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
