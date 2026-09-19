import logger from '../../../logger.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { cexInventoryLedger } from '../execution/cex-inventory-ledger.js';
import { inventoryRebalancer } from '../execution/inventory-rebalancer.js';
import { krakenPrivateRequest, okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import { isCryptoCrawlerDatabaseAccessAllowed } from '../runtime/manual-power-state.js';

const REFRESH_MS = boundedInt(process.env.CRYPTOCRAWL_REBALANCE_ROUTE_EVIDENCE_REFRESH_MS, 60_000, 15_000, 15 * 60_000);
const EVIDENCE_TTL_MS = boundedInt(process.env.CRYPTOCRAWL_REBALANCE_ROUTE_EVIDENCE_TTL_MS, 120_000, 30_000, 30 * 60_000);
const MAX_ASSETS_PER_SCAN = boundedInt(process.env.CRYPTOCRAWL_REBALANCE_ROUTE_EVIDENCE_ASSETS, 8, 1, 24);
const MEMO_FREE_NETWORKS = new Set([
  'ethereum', 'arbitrum', 'optimism', 'base', 'polygon', 'zksync', 'linea', 'scroll',
  'avalanche', 'bsc', 'solana', 'tron', 'bitcoin',
]);

let installed = false;
let timer: NodeJS.Timeout | null = null;
let refreshInFlight: Promise<void> | null = null;
let lastRefreshAt: number | null = null;
let lastSuccessAt: number | null = null;
let lastError: string | null = null;
let generation = 0;

function activeGeneration(runGeneration: number): boolean {
  return installed && generation === runGeneration && isCryptoCrawlerDatabaseAccessAllowed();
}

function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function finiteNonNegative(raw: unknown): number | null {
  if (raw === null || raw === undefined || typeof raw === 'boolean' || (typeof raw === 'string' && raw.trim() === '')) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function finitePositive(raw: unknown): number | null {
  const parsed = finiteNonNegative(raw);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function canonicalAsset(raw: unknown): string {
  let value = String(raw || '').trim().toUpperCase().split('.')[0];
  if (value === 'XXBT' || value === 'XBT') return 'BTC';
  if (value === 'XETH') return 'ETH';
  if (value === 'ZUSD') return 'USD';
  if (/^[XZ][A-Z0-9]{3,}$/.test(value)) value = value.slice(1);
  return value === 'XBT' ? 'BTC' : value;
}

function networkKey(raw: unknown): string | null {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return null;
  if (value.includes('lightning')) return 'bitcoin_lightning';
  if (value.includes('arbitrum')) return 'arbitrum';
  if (value.includes('optimism')) return 'optimism';
  if (/(^|[^a-z])base([^a-z]|$)/.test(value)) return 'base';
  if (value.includes('polygon') || value.includes('matic')) return 'polygon';
  if (value.includes('zksync')) return 'zksync';
  if (value.includes('linea')) return 'linea';
  if (value.includes('scroll')) return 'scroll';
  if (value.includes('avalanche') || value.includes('avax')) return 'avalanche';
  if (value.includes('bsc') || value.includes('bep20') || value.includes('binance smart')) return 'bsc';
  if (value.includes('solana') || value === 'sol') return 'solana';
  if (value.includes('tron') || value.includes('trc20')) return 'tron';
  if (value.includes('bitcoin') || value === 'btc') return 'bitcoin';
  if (value.includes('ethereum') || value.includes('erc20') || value === 'eth') return 'ethereum';
  return value.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || null;
}

function memoFreeNetwork(network: string | null): network is string {
  return network !== null && MEMO_FREE_NETWORKS.has(network);
}

function addressEqual(leftRaw: unknown, rightRaw: unknown): boolean {
  const left = String(leftRaw || '').trim();
  const right = String(rightRaw || '').trim();
  if (!left || !right) return false;
  if (/^0x[0-9a-f]+$/i.test(left) && /^0x[0-9a-f]+$/i.test(right)) return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

function bool(raw: unknown): boolean {
  return raw === true || String(raw || '').trim().toLowerCase() === 'true';
}

async function usdValue(amount: number, currencyRaw: unknown): Promise<number | null> {
  const currency = canonicalAsset(currencyRaw);
  if (!(amount >= 0) || !currency) return null;
  if (currency === 'USD') return amount;
  const prices = await coinGeckoPriceClient.getLiveSymbolPrices([currency]).catch(() => null);
  const price = prices?.get(currency);
  return price && Number.isFinite(price) && price > 0 ? amount * price : null;
}

function desiredAmount(asset: string, sourceVenue: 'kraken' | 'okx', destinationVenue: 'kraken' | 'okx'): number | null {
  const recommendations = cexInventoryLedger.getRebalanceRecommendations();
  const source = recommendations.find(row => row.venue === sourceVenue && row.asset === asset && row.action === 'reduce');
  const destination = recommendations.find(row => row.venue === destinationVenue && row.asset === asset && row.action === 'fund');
  if (!source || !destination) return null;
  const amount = Math.min(source.delta, destination.delta);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

async function recordOkxToKraken(asset: string, amount: number, runGeneration: number): Promise<number> {
  if (!activeGeneration(runGeneration)) return 0;
  const [okxCurrencies, krakenDepositMethods] = await Promise.all([
    okxPrivateRequest('/api/v5/asset/currencies', 'GET', { ccy: asset }, { lane: 'account_read' }),
    krakenPrivateRequest('/0/private/DepositMethods', { asset }),
  ]);
  if (!activeGeneration(runGeneration)) return 0;
  const deposits = (Array.isArray(krakenDepositMethods) ? krakenDepositMethods : [])
    .map((row: any) => ({
      method: String(row?.method || '').trim(),
      network: networkKey(row?.method),
      minimum: finiteNonNegative(row?.minimum) ?? 0,
    }))
    .filter(row => row.method && memoFreeNetwork(row.network));
  let recorded = 0;
  for (const row of Array.isArray(okxCurrencies?.data) ? okxCurrencies.data : []) {
    if (!activeGeneration(runGeneration)) return recorded;
    if (!bool(row?.canWd) || bool(row?.needTag)) continue;
    const network = networkKey(row?.chain);
    if (!memoFreeNetwork(network)) continue;
    const destination = deposits.find(deposit => deposit.network === network);
    if (!destination) continue;
    const burningFeeRate = finiteNonNegative(row?.burningFeeRate) ?? 0;
    // A percentage burn cannot be represented as a fixed route fee without an
    // exact amount/currency treatment. Skip it rather than understate costs.
    if (burningFeeRate > 0) continue;
    const fee = finiteNonNegative(row?.fee);
    const feeCurrency = canonicalAsset(row?.feeCcy || asset);
    const minWd = finiteNonNegative(row?.minWd) ?? 0;
    const maxWd = finitePositive(row?.maxWd);
    const minimumAmount = Math.max(minWd, destination.minimum);
    if (fee === null || !feeCurrency || amount + 1e-12 < minimumAmount || (maxWd !== null && amount > maxWd + 1e-12)) continue;
    const feeUsd = await usdValue(fee, feeCurrency);
    if (!activeGeneration(runGeneration)) return recorded;
    if (feeUsd === null) continue;
    const observedAt = Date.now();
    inventoryRebalancer.recordMeasuredRouteEvidence({
      sourceVenue: 'okx',
      destinationVenue: 'kraken',
      asset,
      network,
      withdrawalFeeAsset: fee,
      withdrawalFeeCurrency: feeCurrency,
      estimatedFeeUsd: feeUsd,
      estimatedLatencyMs: null,
      minimumAmount,
      maximumAmount: maxWd,
      withdrawalSupported: true,
      depositSupported: true,
      statusTrackingSupported: true,
      observedAt,
      expiresAt: observedAt + EVIDENCE_TTL_MS,
      provenance: [
        'okx_authenticated:/api/v5/asset/currencies',
        'kraken_authenticated:/0/private/DepositMethods',
        `okx_chain:${String(row?.chain || '')}`,
        `kraken_deposit_method:${destination.method}`,
        'withdrawal_fee:authenticated_current',
        'destination_deposit_method:authenticated_current',
        'memo_or_tag_route:false',
        'transfer_execution_authority:false',
      ],
    });
    recorded += 1;
  }
  return recorded;
}

async function recordKrakenToOkx(asset: string, amount: number, runGeneration: number): Promise<number> {
  if (!activeGeneration(runGeneration)) return 0;
  const [withdrawMethodsRaw, withdrawAddressesRaw, okxCurrencies, okxDepositAddresses] = await Promise.all([
    krakenPrivateRequest('/0/private/WithdrawMethods', { asset }),
    krakenPrivateRequest('/0/private/WithdrawAddresses', { asset, verified: true }),
    okxPrivateRequest('/api/v5/asset/currencies', 'GET', { ccy: asset }, { lane: 'account_read' }),
    okxPrivateRequest('/api/v5/asset/deposit-address', 'GET', { ccy: asset }, { lane: 'account_read' }),
  ]);
  if (!activeGeneration(runGeneration)) return 0;
  const methods = (Array.isArray(withdrawMethodsRaw) ? withdrawMethodsRaw : [])
    .map((row: any) => ({
      method: String(row?.method || '').trim(),
      network: networkKey(row?.network || row?.method),
      minimum: finiteNonNegative(row?.minimum) ?? 0,
    }))
    .filter(row => row.method && memoFreeNetwork(row.network));
  const okxCapabilities = (Array.isArray(okxCurrencies?.data) ? okxCurrencies.data : [])
    .filter((row: any) => bool(row?.canDep) && !bool(row?.needTag))
    .map((row: any) => ({
      network: networkKey(row?.chain),
      minDep: finiteNonNegative(row?.minDep) ?? 0,
      rawChain: String(row?.chain || ''),
    }))
    .filter(row => memoFreeNetwork(row.network));
  const okxDeposits = (Array.isArray(okxDepositAddresses?.data) ? okxDepositAddresses.data : [])
    .map((row: any) => ({ address: String(row?.addr || '').trim(), network: networkKey(row?.chain), rawChain: String(row?.chain || '') }))
    .filter(row => row.address && memoFreeNetwork(row.network));
  const addresses = Array.isArray(withdrawAddressesRaw) ? withdrawAddressesRaw : [];
  let recorded = 0;

  for (const method of methods) {
    if (!activeGeneration(runGeneration)) return recorded;
    const capability = okxCapabilities.find(row => row.network === method.network);
    if (!capability) continue;
    const minimumAmount = Math.max(method.minimum, capability.minDep);
    if (amount + 1e-12 < minimumAmount) continue;
    const destinationRows = okxDeposits.filter(row => row.network === method.network);
    const matching = addresses.filter((row: any) => {
      if (row?.verified === false || String(row?.verified || '').trim().toLowerCase() === 'false') return false;
      const rowNetwork = networkKey(row?.method || row?.network);
      if (rowNetwork !== method.network || !String(row?.key || '').trim()) return false;
      return destinationRows.some(destination => addressEqual(row?.address, destination.address));
    });
    if (matching.length !== 1) continue;
    const key = String(matching[0]?.key || '').trim();
    const info = await krakenPrivateRequest('/0/private/WithdrawInfo', { asset, key, amount: String(amount) }).catch(() => null);
    if (!activeGeneration(runGeneration)) return recorded;
    const fee = finiteNonNegative(info?.fee);
    if (fee === null) continue;
    const feeUsd = await usdValue(fee, asset);
    if (!activeGeneration(runGeneration)) return recorded;
    if (feeUsd === null) continue;
    const observedAt = Date.now();
    inventoryRebalancer.recordMeasuredRouteEvidence({
      sourceVenue: 'kraken',
      destinationVenue: 'okx',
      asset,
      network: method.network,
      withdrawalFeeAsset: fee,
      withdrawalFeeCurrency: asset,
      estimatedFeeUsd: feeUsd,
      estimatedLatencyMs: null,
      minimumAmount,
      maximumAmount: null,
      withdrawalSupported: true,
      depositSupported: true,
      statusTrackingSupported: true,
      observedAt,
      expiresAt: observedAt + EVIDENCE_TTL_MS,
      provenance: [
        'kraken_authenticated:/0/private/WithdrawMethods',
        'kraken_authenticated:/0/private/WithdrawAddresses',
        'kraken_authenticated:/0/private/WithdrawInfo',
        'okx_authenticated:/api/v5/asset/currencies',
        'okx_authenticated:/api/v5/asset/deposit-address',
        `okx_chain:${capability.rawChain}`,
        'destination_address:exact_verified_match',
        'withdrawal_fee:authenticated_amount_specific',
        'memo_or_tag_route:false',
        'transfer_execution_authority:false',
      ],
    });
    recorded += 1;
  }
  return recorded;
}

async function refreshOnce(): Promise<void> {
  if (!installed || !isCryptoCrawlerDatabaseAccessAllowed()) return;
  if (refreshInFlight) return refreshInFlight;
  const runGeneration = generation;
  refreshInFlight = (async () => {
    if (!activeGeneration(runGeneration)) return;
    lastRefreshAt = Date.now();
    const recommendations = cexInventoryLedger.getRebalanceRecommendations();
    const assets = [...new Set(recommendations
      .filter(row => row.venue === 'kraken' || row.venue === 'okx')
      .map(row => canonicalAsset(row.asset))
      .filter(Boolean))]
      .slice(0, MAX_ASSETS_PER_SCAN);
    if (assets.length === 0) {
      lastSuccessAt = Date.now();
      lastError = null;
      return;
    }

    let recorded = 0;
    let failedLanes = 0;
    for (const asset of assets) {
      if (!activeGeneration(runGeneration)) return;
      const okxToKrakenAmount = desiredAmount(asset, 'okx', 'kraken');
      if (okxToKrakenAmount !== null) {
        try { recorded += await recordOkxToKraken(asset, okxToKrakenAmount, runGeneration); }
        catch { failedLanes += 1; }
      }
      const krakenToOkxAmount = desiredAmount(asset, 'kraken', 'okx');
      if (krakenToOkxAmount !== null) {
        try { recorded += await recordKrakenToOkx(asset, krakenToOkxAmount, runGeneration); }
        catch { failedLanes += 1; }
      }
    }
    lastSuccessAt = Date.now();
    lastError = null;
    logger.info('[BPS Rebalance] Fresh authenticated route-cost evidence refreshed', {
      component: 'MeasuredRebalanceRouteEvidenceWiring',
      assetsConsidered: assets.length,
      routeEvidenceRecorded: recorded,
      failedLanes,
      liveMeasuredRoutes: inventoryRebalancer.getStatus().measuredRoutes,
      liveTransferExecutionEnabled: false,
      syntheticFeeEvidenceAllowed: false,
      syntheticLatencyEconomicsAllowed: false,
      memoOrTagRoutesAdmitted: false,
      operatorBalanceAuthorityGranted: false,
      executionAuthority: false,
    });
  })().catch(error => {
    lastError = error instanceof Error ? error.message : String(error);
    throw error;
  }).finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

function scheduleNext(): void {
  if (!installed || !isCryptoCrawlerDatabaseAccessAllowed() || process.env.NO_INTERVALS === 'true' || timer) return;
  timer = setTimeout(async () => {
    timer = null;
    if (!installed || !isCryptoCrawlerDatabaseAccessAllowed()) return;
    await refreshOnce().catch(error => {
      logger.debug('[BPS Rebalance] Route-evidence refresh deferred without changing execution authority', {
        component: 'MeasuredRebalanceRouteEvidenceWiring',
        error: error instanceof Error ? error.message : String(error),
        executionAuthority: false,
      });
    });
    if (installed && isCryptoCrawlerDatabaseAccessAllowed()) scheduleNext();
  }, REFRESH_MS);
  timer.unref?.();
}

export function ensureMeasuredRebalanceRouteEvidenceWiring(): void {
  if (installed) return;
  if (!isCryptoCrawlerDatabaseAccessAllowed()) throw new Error('CRYPTOCRAWLER_MASTER_POWER_OFF');
  installed = true;
  generation += 1;
  void refreshOnce().catch(() => undefined).finally(() => {
    if (installed && isCryptoCrawlerDatabaseAccessAllowed()) scheduleNext();
  });
}

export function stopMeasuredRebalanceRouteEvidenceWiring(): void {
  installed = false;
  generation += 1;
  if (timer) clearTimeout(timer);
  timer = null;
}

export function getMeasuredRebalanceRouteEvidenceWiringStatus() {
  return {
    observedAt: Date.now(),
    installed,
    refreshInFlight: Boolean(refreshInFlight),
    lastRefreshAt,
    lastSuccessAt,
    lastError,
    refreshMs: REFRESH_MS,
    evidenceTtlMs: EVIDENCE_TTL_MS,
    maxAssetsPerScan: MAX_ASSETS_PER_SCAN,
    rebalancer: inventoryRebalancer.getStatus(),
    executionAuthority: false as const,
    transferExecutionAuthority: false as const,
    syntheticFeeEvidenceAllowed: false as const,
    syntheticLatencyEconomicsAllowed: false as const,
    memoOrTagRoutesAdmitted: false as const,
  };
}
