import { createHash, randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { resolvePayoutFallbackAddress, resolvePrimaryProfitPayoutAddress } from '../core/wallet-identity.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { cexOrderBookStreams, type StreamOrderBookLevel, type StreamOrderBookQuote } from '../intelligence/cex-order-book-stream.js';
import { krakenPrivateRequest, okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import { isDatabaseConfigured, pool } from '../runtime/cryptocrawl-runtime-database.js';
import { cexInventoryLedger } from './cex-inventory-ledger.js';
import {
  createProductionCexSettlementAdapters,
  type CexOrderReceipt,
  type CexSettlementAdapter,
} from './cex-settlement.js';
import { getSpotProductConstraints, type SpotProductConstraints } from './cex-spot-product-policy.js';
import { getExactSystemCapitalOrderAssetDeltas } from './cex-system-capital-settlement-evidence.js';
import { applyExactCexSystemOwnedSettlement } from './cex-system-owned-lot-ledger.js';

const THRESHOLD_USD = 4_000;
const SWEEP_FRACTION = 0.80;
const WORKER_INTERVAL_MS = Math.max(10_000, Math.min(120_000, Number(process.env.CRYPTOCRAWL_SYSTEM_CAPITAL_SWEEP_INTERVAL_MS || 20_000)));
const RETRY_AFTER_MS = Math.max(15_000, Math.min(15 * 60_000, Number(process.env.CRYPTOCRAWL_SYSTEM_CAPITAL_SWEEP_RETRY_MS || 60_000)));
const ORDER_SETTLEMENT_TIMEOUT_MS = Math.max(5_000, Math.min(120_000, Number(process.env.CRYPTOCRAWL_SYSTEM_CAPITAL_SWEEP_ORDER_TIMEOUT_MS || 30_000)));
const ORDER_POLL_MS = Math.max(250, Math.min(5_000, Number(process.env.CRYPTOCRAWL_SYSTEM_CAPITAL_SWEEP_ORDER_POLL_MS || 1_000)));
const WITHDRAW_SETTLEMENT_TIMEOUT_MS = Math.max(60_000, Math.min(6 * 60 * 60_000, Number(process.env.CRYPTOCRAWL_SYSTEM_CAPITAL_SWEEP_WITHDRAW_TIMEOUT_MS || 60 * 60_000)));
const WITHDRAW_POLL_MS = Math.max(5_000, Math.min(60_000, Number(process.env.CRYPTOCRAWL_SYSTEM_CAPITAL_SWEEP_WITHDRAW_POLL_MS || 15_000)));
const BOOK_MAX_AGE_MS = Math.max(500, Math.min(5_000, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000)));
const SOURCE_CUSHION = 1.0025;
const PRIMARY_DESTINATION = resolvePrimaryProfitPayoutAddress() || '';
const FALLBACK_DESTINATION = resolvePayoutFallbackAddress() || '';
const ETHEREUM_RPC_URL = (
  process.env.ETHEREUM_RPC_URL
  || process.env.ETHEREM_RPC_URL
  || (process.env.ALCHEMY_API_KEY ? `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}` : '')
).trim();

type Venue = 'kraken' | 'okx';
type DestinationMode = 'primary' | 'fallback';

type SweepBatch = {
  batch_id: string;
  venue: Venue;
  measured_system_owned_value_usd: string | number;
  target_sweep_value_usd: string | number;
  reserved_sweep_value_usd: string | number;
  reference_eth_usd: string | number;
  target_wallet_eth: string | number;
  status: string;
  destination_hash: string;
  destination_mode: DestinationMode;
  wallet_transfer_id: string | null;
  withdrawal_client_id: string | null;
  withdrawal_id: string | null;
  withdrawal_fee_eth: string | number | null;
  transaction_hash: string | null;
  attempt_count: number;
  last_attempt_at: string | null;
  created_at: string;
};

type SweepConversion = {
  conversion_id: string;
  batch_id: string;
  venue: Venue;
  source_asset: string;
  target_asset: string;
  symbol: string;
  side: 'buy' | 'sell';
  requested_base_quantity: string | number;
  reserved_source_decimal: string | number;
  limit_price: string | number;
  client_order_id: string;
  exchange_order_id: string | null;
  inventory_reservation_id: string | null;
  status: string;
  submitted_at: string | null;
  created_at: string;
};

type CapitalAsset = { asset: string; amount: number; priceUsd: number; valueUsd: number };

type ConversionPlan = {
  venue: Venue;
  sourceAsset: string;
  targetAsset: string;
  symbol: string;
  exchangeSymbol: string;
  side: 'buy' | 'sell';
  baseQuantity: number;
  sourceReserve: number;
  limitPrice: number;
};

type WithdrawalPlan = {
  venue: Venue;
  destination: string;
  destinationMode: DestinationMode;
  amountEth: number;
  feeEth: number;
  sourceDebitEth: number;
  clientId: string;
  okxChain?: string;
  krakenKey?: string;
  krakenMethod?: string | null;
};

type WithdrawalSettlement = {
  withdrawalId: string;
  transactionHash: string;
  amountEth: number;
  feeEth: number;
  sourceDebitEth: number;
  exchangeEvidence: Record<string, unknown>;
};

class TerminalWithdrawalFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TerminalWithdrawalFailure';
  }
}

let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function finitePositive(raw: unknown): number | null {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function canonicalAsset(raw: unknown): string {
  let asset = String(raw || '').trim().toUpperCase().split('.')[0];
  if (asset === 'XETH') return 'ETH';
  if (asset === 'XXBT' || asset === 'XBT') return 'BTC';
  if (asset === 'ZUSD') return 'USD';
  if (/^[XZ][A-Z0-9]{3,}$/.test(asset)) asset = asset.slice(1);
  return asset === 'XBT' ? 'BTC' : asset;
}

function liveExecutionPosture(): boolean {
  return process.env.NO_EXECUTION !== 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK';
}

function numericString(value: number, decimals = 12): string {
  if (!(value > 0) || !Number.isFinite(value)) throw new Error('system-capital sweep requires a finite positive decimal');
  return value.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
}

function deterministicId(seed: string, length = 32): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, length);
}

function destinationFor(mode: DestinationMode): string {
  return mode === 'fallback' ? FALLBACK_DESTINATION : PRIMARY_DESTINATION;
}

function destinationFingerprint(address: string): string {
  return createHash('sha256').update(address.toLowerCase()).digest('hex').slice(0, 16);
}

function sameAddress(left: unknown, right: unknown): boolean {
  const a = String(left || '').trim().toLowerCase();
  const b = String(right || '').trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(a) && a === b;
}

function ethereumMainnet(raw: unknown): boolean {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return false;
  if (['arbitrum', 'optimism', 'base', 'polygon', 'bsc', 'zksync', 'linea', 'scroll', 'avalanche'].some(name => value.includes(name))) return false;
  return value.includes('erc20') || value.includes('ethereum') || value === 'eth' || value.includes('eth-ethereum');
}

function decimalEthToWei(value: number): bigint {
  const raw = numericString(value, 18);
  const [whole, fraction = ''] = raw.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.slice(0, 18).padEnd(18, '0') || '0');
}

function floorIncrement(value: number, increment: number): number {
  if (!(value > 0) || !(increment > 0)) return 0;
  return Number((Math.floor((value + increment * 1e-9) / increment) * increment).toPrecision(15));
}

function ceilIncrement(value: number, increment: number): number {
  if (!(value > 0) || !(increment > 0)) return 0;
  return Number((Math.ceil((value - increment * 1e-9) / increment) * increment).toPrecision(15));
}

function depthQuantity(levels: readonly StreamOrderBookLevel[]): number {
  return levels.reduce((sum, level) => sum + (Number.isFinite(level.quantity) && level.quantity > 0 ? level.quantity : 0), 0);
}

function depthWorstPrice(levels: readonly StreamOrderBookLevel[], quantity: number): number | null {
  let accumulated = 0;
  for (const level of levels) {
    if (!(level.quantity > 0) || !(level.price > 0)) continue;
    accumulated += level.quantity;
    if (accumulated + 1e-12 >= quantity) return level.price;
  }
  return null;
}

async function assetUsdPrice(asset: string): Promise<{ price: number; observedAt: number }> {
  const normalized = canonicalAsset(asset);
  if (['USD', 'USDC', 'USDT'].includes(normalized)) return { price: 1, observedAt: Date.now() };
  const prices = await coinGeckoPriceClient.getLiveSymbolPrices([normalized]);
  const price = prices.get(normalized);
  if (!price || !Number.isFinite(price) || price <= 0) throw new Error(`live USD price unavailable for system-capital asset ${normalized}`);
  return { price, observedAt: Date.now() };
}

async function ethereumRpc(method: string, params: unknown[]): Promise<any> {
  if (!/^https:\/\//i.test(ETHEREUM_RPC_URL)) throw new Error('Ethereum finalized-recipient confirmation RPC is unavailable');
  const response = await fetch(ETHEREUM_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body: any = await response.json().catch(() => null);
  if (!response.ok || !body || body.error) throw new Error(`Ethereum sweep confirmation RPC ${method} failed`);
  return body.result;
}

async function verifyFinalizedRecipient(transactionHash: string, destination: string, amountEth: number): Promise<{ blockNumber: string } | null> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) return null;
  const [transaction, receipt, finalized] = await Promise.all([
    ethereumRpc('eth_getTransactionByHash', [transactionHash]),
    ethereumRpc('eth_getTransactionReceipt', [transactionHash]),
    ethereumRpc('eth_getBlockByNumber', ['finalized', false]),
  ]);
  if (!transaction || !receipt || !finalized) return null;
  if (String(receipt.status || '').toLowerCase() !== '0x1') throw new Error('system-capital sweep Ethereum transaction failed');
  if (!sameAddress(transaction.to, destination)) throw new Error('system-capital sweep transaction recipient mismatch');
  if (BigInt(String(transaction.value || '0x0')) < decimalEthToWei(amountEth)) throw new Error('system-capital sweep transaction value is below the persisted 80% wallet target');
  const receiptBlock = BigInt(String(receipt.blockNumber || '0x0'));
  const finalizedBlock = BigInt(String(finalized.number || '0x0'));
  if (receiptBlock <= 0n || finalizedBlock < receiptBlock) return null;
  return { blockNumber: String(receipt.blockNumber) };
}

async function measuredSystemOwnedSnapshot(venue: Venue): Promise<{ assets: CapitalAsset[]; totalUsd: number }> {
  const result = await pool.query(
    `SELECT asset, COALESCE(SUM(remaining_decimal),0)::text AS amount
     FROM public.cryptocrawler_cex_system_owned_lots
     WHERE venue=$1 AND status='ACTIVE' AND remaining_decimal > 0
     GROUP BY asset
     ORDER BY asset`,
    [venue],
  );
  const assets: CapitalAsset[] = [];
  for (const row of result.rows) {
    const asset = canonicalAsset(row.asset);
    const amount = Number(row.amount || 0);
    if (!(amount > 0) || !Number.isFinite(amount)) continue;
    const price = await assetUsdPrice(asset);
    assets.push({ asset, amount, priceUsd: price.price, valueUsd: amount * price.price });
  }
  return { assets, totalUsd: assets.reduce((sum, asset) => sum + asset.valueUsd, 0) };
}

async function availableSystemOwnedAssets(venue: Venue): Promise<Array<{ asset: string; amount: number }>> {
  const result = await pool.query(
    `WITH owned AS (
       SELECT asset, SUM(remaining_decimal) AS amount
       FROM public.cryptocrawler_cex_system_owned_lots
       WHERE venue=$1 AND status='ACTIVE' AND remaining_decimal > 0
       GROUP BY asset
     ), transfer_reserved AS (
       SELECT lot.asset, SUM(tl.reserved_decimal) AS amount
       FROM public.cryptocrawler_system_capital_transfer_lots tl
       JOIN public.cryptocrawler_system_capital_transfers t USING (transfer_id)
       JOIN public.cryptocrawler_cex_system_owned_lots lot USING (lot_id)
       WHERE lot.venue=$1
         AND t.status IN ('PREPARED','SUBMITTED','SETTLING','RETRYABLE','MANUAL_REVIEW')
       GROUP BY lot.asset
     ), inventory_reserved AS (
       SELECT asset, SUM(amount) AS amount
       FROM public.cryptocrawler_cex_inventory_reservations_v1
       WHERE venue=$1 AND expires_at > now()
       GROUP BY asset
     )
     SELECT owned.asset,
            greatest(0, owned.amount - COALESCE(transfer_reserved.amount,0) - COALESCE(inventory_reserved.amount,0))::text AS available
     FROM owned
     LEFT JOIN transfer_reserved USING (asset)
     LEFT JOIN inventory_reserved USING (asset)
     WHERE owned.amount > 0`,
    [venue],
  );
  return result.rows
    .map(row => ({ asset: canonicalAsset(row.asset), amount: Number(row.available || 0) }))
    .filter(row => row.asset && Number.isFinite(row.amount) && row.amount > 1e-12);
}

async function loadActiveBatch(): Promise<SweepBatch | null> {
  const result = await pool.query(
    `SELECT * FROM public.cryptocrawler_system_capital_sweep_batches
     WHERE status IN ('PREPARED','CONVERTING','ROUTING','WITHDRAWING','SUBMITTED','RETRYABLE')
     ORDER BY created_at ASC LIMIT 1`,
  );
  return result.rows[0] as SweepBatch | undefined || null;
}

async function createThresholdBatch(): Promise<SweepBatch | null> {
  if (!PRIMARY_DESTINATION || !/^0x[0-9a-fA-F]{40}$/.test(PRIMARY_DESTINATION)) {
    throw new Error('primary payout wallet is unavailable for the $4,000 system-capital sweep');
  }
  const measured = await Promise.all((['kraken', 'okx'] as const).map(async venue => {
    try { return { venue, ...(await measuredSystemOwnedSnapshot(venue)) }; }
    catch (error) {
      logger.warn('[SystemCapitalSweep] Venue valuation deferred until every system-owned asset has a live USD price', {
        component: 'SystemCapitalSweepWorker', venue,
        error: error instanceof Error ? error.message : String(error),
        rawAccountBalanceAuthority: false,
      });
      return null;
    }
  }));
  const candidate = measured
    .filter((row): row is NonNullable<typeof row> => row !== null && row.totalUsd > THRESHOLD_USD + 1e-9)
    .sort((left, right) => right.totalUsd - left.totalUsd)[0];
  if (!candidate) return null;

  const eth = await assetUsdPrice('ETH');
  const targetUsd = candidate.totalUsd * SWEEP_FRACTION;
  const targetEth = targetUsd / eth.price;
  const batchId = randomUUID();
  const destinationHash = destinationFingerprint(PRIMARY_DESTINATION);
  try {
    const inserted = await pool.query(
      `INSERT INTO public.cryptocrawler_system_capital_sweep_batches
        (batch_id, venue, threshold_usd, sweep_fraction, measured_system_owned_value_usd,
         target_sweep_value_usd, reserved_sweep_value_usd, status, destination_hash,
         reference_eth_usd, target_wallet_eth, source_system_owned_snapshot,
         destination_mode, created_at, updated_at)
       SELECT $1,$2,4000,0.80,$3,$4,0,'PREPARED',$5,$6,$7,$8::jsonb,'primary',now(),now()
       WHERE NOT EXISTS (
         SELECT 1 FROM public.cryptocrawler_system_capital_sweep_batches
         WHERE status IN ('PREPARED','CONVERTING','ROUTING','WITHDRAWING','SUBMITTED','RETRYABLE')
       )
       RETURNING *`,
      [batchId, candidate.venue, candidate.totalUsd, targetUsd, destinationHash, eth.price, targetEth, JSON.stringify(candidate.assets)],
    );
    return inserted.rows[0] as SweepBatch | undefined || null;
  } catch (error: any) {
    if (String(error?.code || '') === '23505') return loadActiveBatch();
    throw error;
  }
}

async function freshBook(venue: Venue, symbol: string): Promise<StreamOrderBookQuote> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const book = await cexOrderBookStreams.getQuote(venue, symbol, BOOK_MAX_AGE_MS).catch(() => null);
    if (book) return book;
    await sleep(250);
  }
  throw new Error(`${venue} ${symbol} has no fresh executable order book for system-capital conversion`);
}

async function tryConstraints(venue: Venue, symbol: string): Promise<SpotProductConstraints | null> {
  try { return await getSpotProductConstraints(venue, symbol, true); }
  catch { return null; }
}

function sizeWithinConstraints(constraints: SpotProductConstraints, quantity: number, price: number): boolean {
  if (!(quantity >= constraints.baseMinSize - 1e-12)) return false;
  if (constraints.baseMaxSize !== null && quantity > constraints.baseMaxSize + 1e-12) return false;
  const quote = quantity * price;
  if (constraints.quoteMinSize !== null && quote + 1e-12 < constraints.quoteMinSize) return false;
  if (constraints.quoteMaxSize !== null && quote > constraints.quoteMaxSize + 1e-12) return false;
  return true;
}

async function buildOneHopPlan(input: {
  venue: Venue;
  sourceAsset: string;
  targetAsset: string;
  sourceAvailable: number;
  desiredTargetUsd: number;
}): Promise<ConversionPlan | null> {
  const orientations = [
    { symbol: `${input.sourceAsset}${input.targetAsset}`, expectedSide: 'sell' as const },
    { symbol: `${input.targetAsset}${input.sourceAsset}`, expectedSide: 'buy' as const },
  ];
  for (const orientation of orientations) {
    const constraints = await tryConstraints(input.venue, orientation.symbol);
    if (!constraints) continue;
    const sourceIsBase = constraints.baseAsset === input.sourceAsset && constraints.quoteAsset === input.targetAsset;
    const sourceIsQuote = constraints.baseAsset === input.targetAsset && constraints.quoteAsset === input.sourceAsset;
    if ((orientation.expectedSide === 'sell' && !sourceIsBase) || (orientation.expectedSide === 'buy' && !sourceIsQuote)) continue;

    const book = await freshBook(input.venue, constraints.symbol);
    if (orientation.expectedSide === 'sell') {
      const sourcePrice = await assetUsdPrice(input.sourceAsset);
      const desiredSource = Math.min(input.sourceAvailable / SOURCE_CUSHION, input.desiredTargetUsd / sourcePrice.price * 1.03);
      const depthCap = depthQuantity(book.depth.bids);
      let quantity = floorIncrement(Math.min(desiredSource, depthCap), constraints.baseIncrement);
      if (!(quantity > 0)) continue;
      let worst = depthWorstPrice(book.depth.bids, quantity);
      if (!worst) continue;
      const limitPrice = floorIncrement(worst, constraints.priceIncrement);
      if (!(limitPrice > 0) || !sizeWithinConstraints(constraints, quantity, limitPrice)) continue;
      const reserve = Math.min(input.sourceAvailable, quantity * SOURCE_CUSHION);
      return {
        venue: input.venue, sourceAsset: input.sourceAsset, targetAsset: input.targetAsset,
        symbol: constraints.symbol, exchangeSymbol: constraints.exchangeSymbol, side: 'sell',
        baseQuantity: quantity, sourceReserve: reserve, limitPrice,
      };
    }

    const targetPrice = await assetUsdPrice(input.targetAsset);
    const desiredBase = input.desiredTargetUsd / targetPrice.price * 1.03;
    const depthCap = depthQuantity(book.depth.asks);
    let quantity = floorIncrement(Math.min(desiredBase, depthCap), constraints.baseIncrement);
    if (!(quantity > 0)) continue;
    let worst = depthWorstPrice(book.depth.asks, quantity);
    if (!worst) continue;
    let limitPrice = ceilIncrement(worst, constraints.priceIncrement);
    let affordable = input.sourceAvailable / Math.max(1e-12, limitPrice * SOURCE_CUSHION);
    quantity = floorIncrement(Math.min(quantity, affordable), constraints.baseIncrement);
    if (!(quantity > 0)) continue;
    worst = depthWorstPrice(book.depth.asks, quantity);
    if (!worst) continue;
    limitPrice = ceilIncrement(worst, constraints.priceIncrement);
    affordable = input.sourceAvailable / Math.max(1e-12, limitPrice * SOURCE_CUSHION);
    quantity = floorIncrement(Math.min(quantity, affordable), constraints.baseIncrement);
    if (!(quantity > 0) || !sizeWithinConstraints(constraints, quantity, limitPrice)) continue;
    const reserve = quantity * limitPrice * SOURCE_CUSHION;
    if (reserve > input.sourceAvailable + 1e-10) continue;
    return {
      venue: input.venue, sourceAsset: input.sourceAsset, targetAsset: input.targetAsset,
      symbol: constraints.symbol, exchangeSymbol: constraints.exchangeSymbol, side: 'buy',
      baseQuantity: quantity, sourceReserve: reserve, limitPrice,
    };
  }
  return null;
}

async function ethRouteExists(venue: Venue, bridgeAsset: string): Promise<boolean> {
  return Boolean(
    await tryConstraints(venue, `ETH${bridgeAsset}`)
    || await tryConstraints(venue, `${bridgeAsset}ETH`),
  );
}

async function chooseConversionPlan(batch: SweepBatch, ethShortage: number): Promise<ConversionPlan | null> {
  const available = await availableSystemOwnedAssets(batch.venue);
  const valued: CapitalAsset[] = [];
  for (const row of available) {
    if (row.asset === 'ETH') continue;
    try {
      const price = await assetUsdPrice(row.asset);
      valued.push({ asset: row.asset, amount: row.amount, priceUsd: price.price, valueUsd: row.amount * price.price });
    } catch { /* another owned asset may be convertible */ }
  }
  valued.sort((left, right) => right.valueUsd - left.valueUsd);
  const ethPrice = await assetUsdPrice('ETH');
  const desiredUsd = ethShortage * ethPrice.price * 1.03;

  for (const source of valued) {
    const direct = await buildOneHopPlan({
      venue: batch.venue, sourceAsset: source.asset, targetAsset: 'ETH',
      sourceAvailable: source.amount, desiredTargetUsd: Math.min(desiredUsd, source.valueUsd),
    });
    if (direct) return direct;

    for (const bridgeAsset of ['USDT', 'USDC', 'USD']) {
      if (source.asset === bridgeAsset || !await ethRouteExists(batch.venue, bridgeAsset)) continue;
      const intermediate = await buildOneHopPlan({
        venue: batch.venue, sourceAsset: source.asset, targetAsset: bridgeAsset,
        sourceAvailable: source.amount, desiredTargetUsd: Math.min(desiredUsd, source.valueUsd),
      });
      if (intermediate) return intermediate;
    }
  }
  return null;
}

async function loadActiveConversion(batchId: string): Promise<SweepConversion | null> {
  const result = await pool.query(
    `SELECT * FROM public.cryptocrawler_system_capital_sweep_conversions
     WHERE batch_id=$1 AND status IN ('PREPARED','SUBMITTED','SETTLING','RETRYABLE')
     ORDER BY created_at ASC LIMIT 1`,
    [batchId],
  );
  return result.rows[0] as SweepConversion | undefined || null;
}

async function createConversion(batch: SweepBatch, plan: ConversionPlan): Promise<SweepConversion | null> {
  const conversionId = randomUUID();
  const clientOrderId = deterministicId(`system-sweep:${batch.batch_id}:${conversionId}:${plan.venue}:${plan.symbol}:${plan.side}`, 32);
  try {
    const result = await pool.query(
      `INSERT INTO public.cryptocrawler_system_capital_sweep_conversions
        (conversion_id, batch_id, venue, source_asset, target_asset, symbol, side,
         requested_base_quantity, reserved_source_decimal, limit_price, client_order_id,
         status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PREPARED',now(),now())
       RETURNING *`,
      [conversionId, batch.batch_id, plan.venue, plan.sourceAsset, plan.targetAsset,
        plan.symbol, plan.side, plan.baseQuantity, plan.sourceReserve, plan.limitPrice, clientOrderId],
    );
    return result.rows[0] as SweepConversion;
  } catch (error: any) {
    if (String(error?.code || '') === '23505') return loadActiveConversion(batch.batch_id);
    throw error;
  }
}

async function ensureConversionReservation(row: SweepConversion): Promise<string> {
  if (row.inventory_reservation_id) {
    const existing = await pool.query(
      `SELECT reservation_id FROM public.cryptocrawler_cex_inventory_reservations_v1
       WHERE reservation_id=$1 AND venue=$2 AND asset=$3 AND expires_at > now()`,
      [row.inventory_reservation_id, row.venue, row.source_asset],
    );
    if (existing.rowCount === 1) return String(row.inventory_reservation_id);
  }

  const adapter = createProductionCexSettlementAdapters()[row.venue];
  const balances = await adapter.getBalances?.();
  if (!balances) throw new Error(`${row.venue} authenticated balance reconciliation is unavailable for sweep conversion`);
  await cexInventoryLedger.reconcile(row.venue, balances);
  const reservation = await cexInventoryLedger.reserve(`system-sweep:${row.batch_id}:${row.conversion_id}`, [{
    venue: row.venue, asset: row.source_asset, amount: Number(row.reserved_source_decimal),
  }]);
  if (!reservation) throw new Error(`canonical inventory/system-owned reservation rejected ${row.venue}:${row.source_asset} sweep conversion`);
  await pool.query(
    `UPDATE public.cryptocrawler_cex_inventory_reservations_v1
     SET expires_at=now()+interval '6 hours'
     WHERE reservation_id=$1`,
    [reservation.reservationId],
  );
  await pool.query(
    `UPDATE public.cryptocrawler_system_capital_sweep_conversions
     SET inventory_reservation_id=$2, updated_at=now(), last_error=NULL
     WHERE conversion_id=$1`,
    [row.conversion_id, reservation.reservationId],
  );
  return reservation.reservationId;
}

async function recoverKrakenOrder(row: SweepConversion): Promise<string | null> {
  const responses = await Promise.all([
    krakenPrivateRequest('/0/private/OpenOrders', { trades: 'true' }),
    krakenPrivateRequest('/0/private/ClosedOrders', { trades: 'true' }),
  ]);
  const matches: string[] = [];
  for (const response of responses) {
    for (const collectionName of ['open', 'closed']) {
      const collection = response?.[collectionName] || {};
      for (const [orderId, value] of Object.entries(collection)) {
        const order: any = value;
        const clientId = String(order?.cl_ord_id || order?.clOrdId || '').replace(/-/g, '').toLowerCase();
        if (clientId && clientId === row.client_order_id.replace(/-/g, '').toLowerCase()) matches.push(orderId);
      }
    }
  }
  const unique = [...new Set(matches)];
  if (unique.length > 1) throw new Error('multiple Kraken orders match one deterministic sweep conversion client id; manual review required');
  return unique[0] || null;
}

async function recoverOkxOrder(row: SweepConversion, constraints: SpotProductConstraints): Promise<string | null> {
  try {
    const response = await okxPrivateRequest('/api/v5/trade/order', 'GET', {
      instId: constraints.exchangeSymbol, clOrdId: row.client_order_id,
    }, { lane: 'account_read' });
    const order = response.data[0];
    return order?.ordId ? String(order.ordId) : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/51603|order.*does not exist|order.*not exist/i.test(message)) return null;
    throw error;
  }
}

async function submitOrRecoverConversionOrder(row: SweepConversion): Promise<{ orderId: string; submittedAt: number }> {
  const constraints = await getSpotProductConstraints(row.venue, row.symbol, true);
  let orderId = row.exchange_order_id;
  if (!orderId) {
    orderId = row.venue === 'kraken' ? await recoverKrakenOrder(row) : await recoverOkxOrder(row, constraints);
  }
  const submittedAt = row.submitted_at ? new Date(row.submitted_at).getTime() : Date.now();
  if (!orderId) {
    getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: `cex:${row.venue}`, venue: row.venue });
    if (row.venue === 'kraken') {
      const result = await krakenPrivateRequest('/0/private/AddOrder', {
        pair: constraints.exchangeSymbol,
        type: row.side,
        ordertype: 'limit',
        price: numericString(Number(row.limit_price)),
        volume: numericString(Number(row.requested_base_quantity)),
        timeinforce: 'FOK',
        cl_ord_id: row.client_order_id,
      });
      orderId = String(result?.txid?.[0] || '').trim();
    } else {
      const result = await okxPrivateRequest('/api/v5/trade/order', 'POST', {
        instId: constraints.exchangeSymbol,
        tdMode: 'cash', side: row.side, ordType: 'fok',
        px: numericString(Number(row.limit_price)), sz: numericString(Number(row.requested_base_quantity)),
        clOrdId: row.client_order_id,
      }, { lane: 'order_write' });
      orderId = String(result.data[0]?.ordId || '').trim();
    }
    if (!orderId) throw new Error(`${row.venue} sweep FOK submission returned no order id`);
  }
  await pool.query(
    `UPDATE public.cryptocrawler_system_capital_sweep_conversions
     SET exchange_order_id=$2, status='SUBMITTED', submitted_at=COALESCE(submitted_at,now()),
         last_attempt_at=now(), attempt_count=attempt_count+1, updated_at=now(), last_error=NULL
     WHERE conversion_id=$1`,
    [row.conversion_id, orderId],
  );
  return { orderId, submittedAt };
}

async function waitOrderTerminal(adapter: CexSettlementAdapter, receipt: CexOrderReceipt) {
  const deadline = Date.now() + ORDER_SETTLEMENT_TIMEOUT_MS;
  let last = await adapter.query(receipt);
  while (!last.terminal && Date.now() < deadline) {
    await sleep(ORDER_POLL_MS);
    last = await adapter.query(receipt);
  }
  return last;
}

async function processConversion(batch: SweepBatch, row: SweepConversion): Promise<void> {
  const reservationId = await ensureConversionReservation(row);
  const order = await submitOrRecoverConversionOrder({ ...row, inventory_reservation_id: reservationId });
  const adapter = createProductionCexSettlementAdapters()[row.venue];
  const settlement = await waitOrderTerminal(adapter, {
    venue: row.venue,
    orderId: order.orderId,
    symbol: row.symbol,
    side: row.side,
    requestedQuantity: Number(row.requested_base_quantity),
    submittedAt: order.submittedAt,
  });
  if (!settlement.terminal) {
    await pool.query(
      `UPDATE public.cryptocrawler_system_capital_sweep_conversions
       SET status='SETTLING', last_error='FOK order settlement is not terminal yet', updated_at=now()
       WHERE conversion_id=$1`, [row.conversion_id],
    );
    return;
  }

  const filled = Number(settlement.filledQuantity || 0);
  if (!(filled > 0)) {
    await pool.query(`DELETE FROM public.cryptocrawler_cex_inventory_reservations_v1 WHERE reservation_id=$1`, [reservationId]);
    await pool.query(
      `UPDATE public.cryptocrawler_system_capital_sweep_conversions
       SET status='RELEASED', confirmed_at=now(), last_error='fresh FOK conversion ended without a fill; no ownership changed', updated_at=now()
       WHERE conversion_id=$1`, [row.conversion_id],
    );
    await pool.query(
      `UPDATE public.cryptocrawler_system_capital_sweep_batches
       SET status='RETRYABLE', last_error='FOK sweep conversion did not fill; fresh conversion will be rebuilt', updated_at=now()
       WHERE batch_id=$1`, [batch.batch_id],
    );
    return;
  }

  const evidence = await getExactSystemCapitalOrderAssetDeltas(settlement);
  const sourceDelta = Number(evidence.assetDeltas[row.source_asset] || 0);
  const targetDelta = Number(evidence.assetDeltas[row.target_asset] || 0);
  if (!(sourceDelta < 0) || !(targetDelta > 0)) {
    throw new Error(`authenticated sweep conversion deltas do not transform ${row.source_asset} into ${row.target_asset}`);
  }
  await applyExactCexSystemOwnedSettlement({
    evidence,
    opportunityId: `system-sweep:${batch.batch_id}`,
    strategy: 'system_capital_threshold_sweep',
    authority: {
      treasuryAuthority: 'operator_strategy',
      notionalAuthority: 'system_owned_sweep_target',
      executionAuthority: 'system_capital_sweep_worker',
      governanceAdmitted: true,
      reference: `sweep-conversion:${row.conversion_id}`,
      batchId: batch.batch_id,
      thresholdUsd: THRESHOLD_USD,
      sweepFraction: SWEEP_FRACTION,
      fillOrKill: true,
      canonicalEconomicsAdmissionAuthorityChanged: false,
    },
  });
  await pool.query(`DELETE FROM public.cryptocrawler_cex_inventory_reservations_v1 WHERE reservation_id=$1`, [reservationId]);
  await pool.query(
    `UPDATE public.cryptocrawler_system_capital_sweep_conversions
     SET status='CONFIRMED', source_debit_decimal=$2, target_credit_decimal=$3,
         settlement_reference=$4, settlement_evidence=$5::jsonb,
         confirmed_at=now(), last_error=NULL, updated_at=now()
     WHERE conversion_id=$1`,
    [row.conversion_id, -sourceDelta, targetDelta, evidence.settlementReference, JSON.stringify(evidence)],
  );
  await pool.query(
    `UPDATE public.cryptocrawler_system_capital_sweep_batches
     SET status='PREPARED', last_error=NULL, updated_at=now() WHERE batch_id=$1`, [batch.batch_id],
  );
}

async function resolveOkxWithdrawalPlan(batch: SweepBatch, destination: string): Promise<WithdrawalPlan> {
  const currencies = await okxPrivateRequest('/api/v5/asset/currencies', 'GET', { ccy: 'ETH' }, { lane: 'account_read' });
  const routes = currencies.data
    .filter((row: any) => row?.canWd === true || String(row?.canWd || '').toLowerCase() === 'true')
    .filter((row: any) => ethereumMainnet(row?.chain))
    .map((row: any) => ({ chain: String(row.chain || ''), fee: Number(row.fee), min: Number(row.minWd), max: Number(row.maxWd || 0) }))
    .filter(route => route.chain && Number.isFinite(route.fee) && route.fee >= 0 && Number.isFinite(route.min) && route.min >= 0)
    .sort((left, right) => left.fee - right.fee);
  const route = routes[0];
  if (!route) throw new Error('OKX exposes no authenticated Ethereum-mainnet ETH withdrawal route');
  const amountEth = Number(batch.target_wallet_eth);
  if (!(amountEth > 0) || amountEth + 1e-12 < route.min) throw new Error('80% system-capital sweep target is below current OKX ETH withdrawal minimum');
  if (route.max > 0 && amountEth > route.max + 1e-12) throw new Error('80% system-capital sweep target exceeds current OKX ETH withdrawal maximum');
  return {
    venue: 'okx', destination, destinationMode: batch.destination_mode,
    amountEth, feeEth: route.fee, sourceDebitEth: amountEth + route.fee,
    clientId: deterministicId(`system-sweep:${batch.batch_id}:${batch.destination_mode}:okx:${destination.toLowerCase()}`, 28),
    okxChain: route.chain,
  };
}

async function resolveKrakenWithdrawalPlan(batch: SweepBatch, destination: string): Promise<WithdrawalPlan> {
  const addresses = await krakenPrivateRequest('/0/private/WithdrawAddresses', { asset: 'eth' });
  const matching = (Array.isArray(addresses) ? addresses : []).filter((row: any) =>
    sameAddress(row?.address, destination) && String(row?.key || '').trim(),
  );
  const explicitEthereum = matching.filter((row: any) => ethereumMainnet(row?.method));
  const eligible = explicitEthereum.length === 1 ? explicitEthereum : matching.length === 1 ? matching : [];
  if (eligible.length !== 1) throw new Error('Kraken has no uniquely approved Ethereum withdrawal key for the active sweep wallet');
  const key = String(eligible[0].key).trim();
  const method = String(eligible[0].method || '').trim() || null;
  const target = Number(batch.target_wallet_eth);
  let gross = target;
  let info: any = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    info = await krakenPrivateRequest('/0/private/WithdrawInfo', { asset: 'eth', key, amount: numericString(gross, 18) });
    const fee = Math.max(0, Number(info?.fee || 0));
    const net = Number(info?.amount || 0);
    if (Number.isFinite(net) && net + 1e-12 >= target) {
      return {
        venue: 'kraken', destination, destinationMode: batch.destination_mode,
        amountEth: target, feeEth: fee, sourceDebitEth: gross,
        clientId: deterministicId(`system-sweep:${batch.batch_id}:${batch.destination_mode}:kraken:${destination.toLowerCase()}`, 18),
        krakenKey: key, krakenMethod: method,
      };
    }
    gross = target + fee + Math.max(1e-12, target * 1e-9);
  }
  throw new Error('Kraken authenticated withdrawal quote cannot deliver the persisted 80% ETH target');
}

async function resolveWithdrawalPlan(batch: SweepBatch): Promise<WithdrawalPlan> {
  const destination = destinationFor(batch.destination_mode);
  if (!/^0x[0-9a-fA-F]{40}$/.test(destination)) throw new Error(`${batch.destination_mode} system-capital sweep wallet is unavailable`);
  return batch.venue === 'okx'
    ? resolveOkxWithdrawalPlan(batch, destination)
    : resolveKrakenWithdrawalPlan(batch, destination);
}

async function availableSystemOwned(venue: Venue, asset: string): Promise<number> {
  const rows = await availableSystemOwnedAssets(venue);
  return rows.find(row => row.asset === canonicalAsset(asset))?.amount || 0;
}

async function ensureWalletTransfer(batch: SweepBatch, plan: WithdrawalPlan): Promise<string> {
  let result = await pool.query(
    `SELECT * FROM public.cryptocrawler_system_capital_transfers
     WHERE sweep_batch_id=$1 AND transfer_kind='CAPITAL_SWEEP' AND target_kind='wallet'
     LIMIT 1`, [batch.batch_id],
  );
  let row = result.rows[0];
  if (!row) {
    const transferId = randomUUID();
    const inserted = await pool.query(
      `INSERT INTO public.cryptocrawler_system_capital_transfers
        (transfer_id, transfer_kind, source_venue, target_kind, target_venue, asset,
         requested_source_decimal, requested_destination_decimal, status, sweep_batch_id,
         source_evidence, created_at, updated_at)
       VALUES ($1,'CAPITAL_SWEEP',$2,'wallet',NULL,'ETH',$3,$4,'PREPARED',$5,$6::jsonb,now(),now())
       ON CONFLICT DO NOTHING RETURNING *`,
      [transferId, batch.venue, plan.sourceDebitEth, plan.amountEth, batch.batch_id,
        JSON.stringify({ destinationMode: plan.destinationMode, destinationHash: destinationFingerprint(plan.destination), feeEth: plan.feeEth })],
    );
    row = inserted.rows[0];
    if (!row) {
      result = await pool.query(
        `SELECT * FROM public.cryptocrawler_system_capital_transfers
         WHERE sweep_batch_id=$1 AND transfer_kind='CAPITAL_SWEEP' AND target_kind='wallet' LIMIT 1`, [batch.batch_id],
      );
      row = result.rows[0];
    }
  }
  if (!row) throw new Error('system-capital wallet transfer intent could not be persisted');
  const transferId = String(row.transfer_id);
  if (String(row.status) === 'RELEASED') {
    await pool.query(
      `UPDATE public.cryptocrawler_system_capital_transfers
       SET status='PREPARED', requested_source_decimal=$2, requested_destination_decimal=$3,
           source_evidence=source_evidence || $4::jsonb, updated_at=now(), last_error=NULL
       WHERE transfer_id=$1`,
      [transferId, plan.sourceDebitEth, plan.amountEth,
        JSON.stringify({ destinationMode: plan.destinationMode, destinationHash: destinationFingerprint(plan.destination), feeEth: plan.feeEth })],
    );
  }
  if (!['SUBMITTED', 'SETTLING', 'CONFIRMED'].includes(String(row.status))) {
    const reserved = await pool.query(
      `SELECT public.cryptocrawler_reserve_system_capital_transfer($1::uuid,$2,'ETH',$3) AS reserved`,
      [transferId, batch.venue, plan.sourceDebitEth],
    );
    if (Number(reserved.rows[0]?.reserved || 0) + 1e-12 < plan.sourceDebitEth) {
      throw new Error(`${batch.venue} does not yet have enough unreserved system-owned ETH for the persisted 80% wallet target plus authenticated withdrawal fee`);
    }
  }
  await pool.query(
    `UPDATE public.cryptocrawler_system_capital_sweep_batches
     SET wallet_transfer_id=$2::uuid, withdrawal_client_id=$3, withdrawal_fee_eth=$4,
         destination_hash=$5, status=CASE WHEN status='SUBMITTED' THEN status ELSE 'WITHDRAWING' END,
         last_error=NULL, updated_at=now()
     WHERE batch_id=$1`,
    [batch.batch_id, transferId, plan.clientId, plan.feeEth, destinationFingerprint(plan.destination)],
  );
  return transferId;
}

async function recoverOkxWithdrawal(plan: WithdrawalPlan, batch: SweepBatch): Promise<any | null> {
  const parameters = batch.withdrawal_id
    ? { ccy: 'ETH', wdId: batch.withdrawal_id }
    : { ccy: 'ETH', clientId: plan.clientId };
  const history = await okxPrivateRequest('/api/v5/asset/withdrawal-history', 'GET', parameters, { lane: 'account_read' });
  return history.data.find((row: any) => batch.withdrawal_id
    ? String(row?.wdId || '') === batch.withdrawal_id
    : String(row?.clientId || '') === plan.clientId) || null;
}

async function waitOkxWithdrawal(plan: WithdrawalPlan, wdId: string): Promise<any> {
  const deadline = Date.now() + WITHDRAW_SETTLEMENT_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const history = await okxPrivateRequest('/api/v5/asset/withdrawal-history', 'GET', { ccy: 'ETH', wdId }, { lane: 'account_read' });
    const row = history.data.find((item: any) => String(item?.wdId || '') === wdId);
    if (row) {
      const state = String(row.state ?? '').trim();
      if (state === '2' && String(row.txId || '').trim()) return row;
      if (state.startsWith('-')) throw new TerminalWithdrawalFailure(`OKX primary/fallback sweep withdrawal ${wdId} reached terminal ${state}`);
    }
    await sleep(WITHDRAW_POLL_MS);
  }
  throw new Error(`OKX sweep withdrawal ${wdId} settlement timeout`);
}

async function executeOkxWithdrawal(batch: SweepBatch, plan: WithdrawalPlan): Promise<WithdrawalSettlement> {
  let row = await recoverOkxWithdrawal(plan, batch);
  let wdId = String(row?.wdId || batch.withdrawal_id || '').trim();
  if (!wdId) {
    getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: 'cex:okx', venue: 'okx' });
    const submitted = await okxPrivateRequest('/api/v5/asset/withdrawal', 'POST', {
      ccy: 'ETH', amt: numericString(plan.amountEth, 18), dest: '4',
      toAddr: plan.destination, fee: numericString(plan.feeEth, 18),
      chain: String(plan.okxChain || ''), clientId: plan.clientId,
    }, { lane: 'order_write' });
    wdId = String(submitted.data[0]?.wdId || '').trim();
    if (!wdId) {
      row = await recoverOkxWithdrawal(plan, batch);
      wdId = String(row?.wdId || '').trim();
    }
    if (!wdId) throw new Error('OKX sweep withdrawal submission outcome is ambiguous; duplicate submission remains forbidden');
  }
  await pool.query(
    `UPDATE public.cryptocrawler_system_capital_sweep_batches
     SET status='SUBMITTED', withdrawal_id=$2, submitted_at=COALESCE(submitted_at,now()),
         last_attempt_at=now(), attempt_count=attempt_count+1, updated_at=now(), last_error=NULL
     WHERE batch_id=$1`, [batch.batch_id, wdId],
  );
  row = await waitOkxWithdrawal(plan, wdId);
  const txId = String(row?.txId || '').trim();
  if (!txId) throw new Error('OKX sweep withdrawal reached success without Ethereum transaction hash');
  if (String(row?.ccy || '').toUpperCase() !== 'ETH' || !ethereumMainnet(row?.chain) || !sameAddress(row?.to, plan.destination)) {
    throw new Error('OKX sweep withdrawal terminal evidence conflicts with ETH/Ethereum/recipient intent');
  }
  const delivered = Number(row?.amt || 0);
  if (!Number.isFinite(delivered) || Math.abs(delivered - plan.amountEth) > Math.max(1e-12, plan.amountEth * 1e-9)) {
    throw new Error('OKX sweep withdrawal amount differs from the persisted 80% wallet target');
  }
  return {
    withdrawalId: wdId, transactionHash: txId, amountEth: plan.amountEth,
    feeEth: plan.feeEth, sourceDebitEth: plan.sourceDebitEth,
    exchangeEvidence: { venue: 'okx', state: String(row.state ?? ''), chain: row.chain, to: row.to, amt: row.amt, fee: row.fee, clientId: plan.clientId },
  };
}

async function recoverKrakenWithdrawal(plan: WithdrawalPlan, batch: SweepBatch): Promise<any | null> {
  const status = await krakenPrivateRequest('/0/private/WithdrawStatus', { asset: 'eth' });
  const rows = Array.isArray(status) ? status : [];
  if (batch.withdrawal_id) return rows.find((row: any) => String(row?.refid || '') === batch.withdrawal_id) || null;
  const createdAt = new Date(batch.created_at).getTime();
  const tolerance = Math.max(1e-10, plan.sourceDebitEth * 1e-8);
  const matches = rows.filter((row: any) => {
    const debit = Number(row?.amount || 0) + Number(row?.fee || 0);
    const timeMs = Number(row?.time || 0) * 1000;
    return Number.isFinite(debit) && Math.abs(debit - plan.sourceDebitEth) <= tolerance
      && (!row?.info || sameAddress(row.info, plan.destination))
      && timeMs >= createdAt - 120_000;
  });
  if (matches.length > 1) throw new Error('multiple Kraken withdrawals match one sweep intent; manual review required before resubmission');
  return matches[0] || null;
}

async function waitKrakenWithdrawal(refid: string): Promise<any> {
  const deadline = Date.now() + WITHDRAW_SETTLEMENT_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const status = await krakenPrivateRequest('/0/private/WithdrawStatus', { asset: 'eth' });
    const row = (Array.isArray(status) ? status : []).find((item: any) => String(item?.refid || '') === refid);
    if (row) {
      const state = String(row.status || '').trim().toLowerCase();
      if (state === 'success') return row;
      if (['failure', 'failed', 'canceled', 'cancelled'].includes(state)) {
        throw new TerminalWithdrawalFailure(`Kraken primary/fallback sweep withdrawal ${refid} reached terminal ${state}`);
      }
    }
    await sleep(WITHDRAW_POLL_MS);
  }
  throw new Error(`Kraken sweep withdrawal ${refid} settlement timeout`);
}

async function executeKrakenWithdrawal(batch: SweepBatch, plan: WithdrawalPlan): Promise<WithdrawalSettlement> {
  let row = await recoverKrakenWithdrawal(plan, batch);
  let refid = String(row?.refid || batch.withdrawal_id || '').trim();
  if (!refid) {
    getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: 'cex:kraken', venue: 'kraken' });
    const submitted = await krakenPrivateRequest('/0/private/Withdraw', {
      asset: 'eth', key: String(plan.krakenKey || ''), amount: numericString(plan.sourceDebitEth, 18),
    });
    refid = String(submitted?.refid || '').trim();
    if (!refid) {
      row = await recoverKrakenWithdrawal(plan, batch);
      refid = String(row?.refid || '').trim();
    }
    if (!refid) throw new Error('Kraken sweep withdrawal submission outcome is ambiguous; duplicate submission remains forbidden');
  }
  await pool.query(
    `UPDATE public.cryptocrawler_system_capital_sweep_batches
     SET status='SUBMITTED', withdrawal_id=$2, submitted_at=COALESCE(submitted_at,now()),
         last_attempt_at=now(), attempt_count=attempt_count+1, updated_at=now(), last_error=NULL
     WHERE batch_id=$1`, [batch.batch_id, refid],
  );
  row = await waitKrakenWithdrawal(refid);
  const txId = String(row?.txid || '').trim();
  if (!txId) throw new Error('Kraken sweep withdrawal reached success without Ethereum transaction hash');
  const net = Number(row?.amount || 0);
  if (!Number.isFinite(net) || net + 1e-12 < plan.amountEth) {
    throw new Error('Kraken sweep withdrawal delivered less than the persisted 80% wallet target');
  }
  return {
    withdrawalId: refid, transactionHash: txId, amountEth: plan.amountEth,
    feeEth: Math.max(0, Number(row?.fee || plan.feeEth)), sourceDebitEth: Number(row?.amount || 0) + Math.max(0, Number(row?.fee || plan.feeEth)),
    exchangeEvidence: { venue: 'kraken', status: row?.status, amount: row?.amount, fee: row?.fee, method: plan.krakenMethod, key: plan.krakenKey },
  };
}

async function executeWalletWithdrawal(batch: SweepBatch, plan: WithdrawalPlan): Promise<WithdrawalSettlement> {
  return plan.venue === 'okx' ? executeOkxWithdrawal(batch, plan) : executeKrakenWithdrawal(batch, plan);
}

async function finalizeSweep(batch: SweepBatch, plan: WithdrawalPlan, transferId: string, settlement: WithdrawalSettlement): Promise<void> {
  const proof = await verifyFinalizedRecipient(settlement.transactionHash, plan.destination, plan.amountEth);
  if (!proof) {
    await pool.query(
      `UPDATE public.cryptocrawler_system_capital_sweep_batches
       SET status='SUBMITTED', transaction_hash=$2, last_error='Ethereum recipient transaction is not finalized yet', updated_at=now()
       WHERE batch_id=$1`, [batch.batch_id, settlement.transactionHash],
    );
    return;
  }
  await pool.query(`UPDATE public.cryptocrawler_system_capital_transfers SET status='SETTLING', updated_at=now() WHERE transfer_id=$1`, [transferId]);
  const confirmed = await pool.query(
    `SELECT public.cryptocrawler_confirm_system_capital_transfer_exact($1::uuid,$2,$3,$4,$5,$6,$7::jsonb) AS confirmed`,
    [transferId, settlement.sourceDebitEth, settlement.amountEth, settlement.feeEth,
      `wallet:${settlement.transactionHash}`, settlement.transactionHash,
      JSON.stringify({ exchange: settlement.exchangeEvidence, ethereumFinalizedBlock: proof.blockNumber, destination: plan.destination })],
  );
  if (confirmed.rows[0]?.confirmed !== true) throw new Error('system-capital wallet transfer confirmation was rejected by the provenance ledger');
  const destinationHash = destinationFingerprint(plan.destination);
  await pool.query(
    `UPDATE public.cryptocrawler_system_capital_sweep_batches
     SET status='CONFIRMED', reserved_sweep_value_usd=target_sweep_value_usd,
         transaction_hash=$2, recipient_confirmation_source='exchange_withdrawal_history+ethereum_finalized_rpc',
         recipient_confirmed_at=now(), recipient_confirmed_destination_hash=$3,
         recipient_confirmed_amount_eth=$4, recipient_confirmed_transaction_hash=$2,
         recipient_confirmed_block_number=$5, last_error=NULL, updated_at=now()
     WHERE batch_id=$1`,
    [batch.batch_id, settlement.transactionHash, destinationHash, settlement.amountEth, proof.blockNumber],
  );
  logger.info('[SystemCapitalSweep] 80% threshold sweep independently confirmed at wallet', {
    component: 'SystemCapitalSweepWorker', batchId: batch.batch_id, venue: batch.venue,
    measuredSystemOwnedValueUsd: Number(batch.measured_system_owned_value_usd),
    thresholdUsd: THRESHOLD_USD, sweepFraction: SWEEP_FRACTION,
    targetSweepValueUsd: Number(batch.target_sweep_value_usd), amountEth: settlement.amountEth,
    destinationMode: plan.destinationMode, transactionHash: `${settlement.transactionHash.slice(0, 10)}...`,
    systemOwnedLotsOnly: true, operatorBalanceAuthority: false, ethereumFinalized: true,
  });
}

async function armFallback(batch: SweepBatch, transferId: string, error: TerminalWithdrawalFailure): Promise<void> {
  if (batch.destination_mode === 'fallback' || !FALLBACK_DESTINATION || sameAddress(FALLBACK_DESTINATION, PRIMARY_DESTINATION)) {
    await pool.query(
      `UPDATE public.cryptocrawler_system_capital_sweep_batches
       SET status='MANUAL_REVIEW', last_error=$2, updated_at=now() WHERE batch_id=$1`,
      [batch.batch_id, `system-capital sweep withdrawal failed terminally and fallback is unavailable/exhausted: ${error.message}`],
    );
    return;
  }
  await pool.query(`UPDATE public.cryptocrawler_system_capital_transfers SET status='RETRYABLE', last_error=$2, updated_at=now() WHERE transfer_id=$1`, [transferId, error.message]);
  await pool.query(`SELECT public.cryptocrawler_release_system_capital_transfer($1::uuid)`, [transferId]);
  await pool.query(
    `UPDATE public.cryptocrawler_system_capital_sweep_batches
     SET status='RETRYABLE', destination_mode='fallback', destination_hash=$2,
         withdrawal_id=NULL, withdrawal_client_id=NULL, transaction_hash=NULL,
         submitted_at=NULL, last_error=$3, updated_at=now()
     WHERE batch_id=$1`,
    [batch.batch_id, destinationFingerprint(FALLBACK_DESTINATION), `primary withdrawal terminally failed; fallback armed: ${error.message}`],
  );
}

async function markBatchFailure(batch: SweepBatch, error: unknown): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  const manual = /recipient mismatch|transaction recipient mismatch|transaction value|multiple .* match|permission|compliance|manual review/i.test(message);
  await pool.query(
    `UPDATE public.cryptocrawler_system_capital_sweep_batches
     SET status=$2, last_error=$3, last_attempt_at=now(), attempt_count=attempt_count+1, updated_at=now()
     WHERE batch_id=$1 AND status<>'CONFIRMED'`,
    [batch.batch_id, manual ? 'MANUAL_REVIEW' : 'RETRYABLE', message],
  ).catch(() => undefined);
  logger.warn('[SystemCapitalSweep] Threshold sweep deferred', {
    component: 'SystemCapitalSweepWorker', batchId: batch.batch_id, venue: batch.venue,
    error: message, operatorBalanceAuthority: false, duplicateWithdrawalAllowed: false,
  });
}

async function processBatch(batch: SweepBatch): Promise<void> {
  if (batch.status === 'SUBMITTED' && batch.wallet_transfer_id) {
    const plan = await resolveWithdrawalPlan(batch);
    const settlement = await executeWalletWithdrawal(batch, plan);
    await finalizeSweep(batch, plan, batch.wallet_transfer_id, settlement);
    return;
  }

  const activeConversion = await loadActiveConversion(batch.batch_id);
  if (activeConversion) {
    await processConversion(batch, activeConversion);
    return;
  }

  const plan = await resolveWithdrawalPlan(batch);
  const ethAvailable = await availableSystemOwned(batch.venue, 'ETH');
  if (ethAvailable + 1e-12 < plan.sourceDebitEth) {
    const conversion = await chooseConversionPlan(batch, plan.sourceDebitEth - ethAvailable);
    if (!conversion) {
      throw new Error(`${batch.venue} system-owned capital exceeds $4,000 but no fresh settlement-safe conversion path can currently transform the 80% target into ETH`);
    }
    const row = await createConversion(batch, conversion);
    if (!row) return;
    await pool.query(`UPDATE public.cryptocrawler_system_capital_sweep_batches SET status='CONVERTING', updated_at=now() WHERE batch_id=$1`, [batch.batch_id]);
    await processConversion(batch, row);
    return;
  }

  const transferId = await ensureWalletTransfer(batch, plan);
  try {
    await pool.query(
      `UPDATE public.cryptocrawler_system_capital_transfers
       SET status='SUBMITTED', submitted_at=COALESCE(submitted_at,now()), last_attempt_at=now(),
           attempt_count=attempt_count+1, updated_at=now(), last_error=NULL
       WHERE transfer_id=$1 AND status IN ('PREPARED','RETRYABLE')`, [transferId],
    );
    const settlement = await executeWalletWithdrawal(batch, plan);
    await finalizeSweep(batch, plan, transferId, settlement);
  } catch (error) {
    if (error instanceof TerminalWithdrawalFailure) {
      await armFallback(batch, transferId, error);
      return;
    }
    throw error;
  }
}

async function processOnce(): Promise<void> {
  if (!isDatabaseConfigured || !liveExecutionPosture()) return;
  let batch = await loadActiveBatch();
  if (!batch) batch = await createThresholdBatch();
  if (!batch) return;
  if (batch.last_attempt_at) {
    const last = new Date(batch.last_attempt_at).getTime();
    if (Number.isFinite(last) && Date.now() - last < RETRY_AFTER_MS && batch.status === 'RETRYABLE') return;
  }
  try { await processBatch(batch); }
  catch (error) { await markBatchFailure(batch, error); }
}

export async function runSystemCapitalSweepOnce(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = processOnce().finally(() => { inFlight = null; });
  return inFlight;
}

export function ensureSystemCapitalSweepWorker(): void {
  if (timer || process.env.NO_INTERVALS === 'true') return;
  timer = setInterval(() => void runSystemCapitalSweepOnce(), WORKER_INTERVAL_MS);
  timer.unref?.();
  void runSystemCapitalSweepOnce();
  logger.info('[SystemCapitalSweep] Provenance-backed $4,000/80% threshold worker online', {
    component: 'SystemCapitalSweepWorker', thresholdUsd: THRESHOLD_USD, sweepFraction: SWEEP_FRACTION,
    venueScope: ['kraken', 'okx'], walletAsset: 'ETH', walletNetwork: 'ethereum_mainnet',
    conversionTimeInForce: 'FOK', rawAccountBalanceAuthority: false,
    systemOwnedLotAuthority: true, recipientFinalityRequired: true,
    primaryDestinationConfigured: Boolean(PRIMARY_DESTINATION), fallbackDestinationConfigured: Boolean(FALLBACK_DESTINATION),
  });
}

export function stopSystemCapitalSweepWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
