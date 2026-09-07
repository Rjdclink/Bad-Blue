import logger from '../../../logger.js';
import { getLastOrderedMarketUniverseSymbols } from './market-universe-controller.js';
import { measuredCandidateRegistry } from './measured-candidate-registry.js';
import { discoverFundingRates, type FundingRateObservation } from './funding-rate-discovery.js';
import { evaluateFundingArbitrage } from './funding-arbitrage-policy.js';
import { resolveCexFeeEvidence } from '../intelligence/cex-fee-resolver.js';
import { okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import { resolveOkxAccountFeeRates } from '../intelligence/okx-account-fee-authority.js';
import { getKalshiMarginAccountReadiness } from '../intelligence/kalshi-perps-market-authority.js';
import { getExactSystemOwnedCexInventory } from '../execution/cex-system-owned-lot-ledger.js';
import { measureOkxFundingExecutionEvidence, type OkxFundingExecutionEvidence } from '../execution/okx-funding-evidence.js';
import {
  hydrateKalshiFundingCapitalReadiness,
  measureKalshiFundingExecutionEvidence,
  type KalshiFundingExecutionEvidence,
} from '../execution/kalshi-funding-evidence.js';
import {
  ensureKalshiFundingLifecycleAdapterRegistered,
  rememberPreparedKalshiFundingPlan,
  type KalshiFundingExecutionPlan,
} from '../execution/kalshi-funding-lifecycle-adapter.js';
import { getKalshiSystemMarginSnapshot } from '../execution/kalshi-system-owned-margin-ledger.js';
import {
  ensureOkxFundingLifecycleAdapterRegistered,
  rememberPreparedOkxFundingPlan,
  type OkxFundingExecutionPlan,
} from '../execution/okx-funding-lifecycle-adapter.js';

interface OkxSwapCapability {
  feeBps: number | null;
  instrumentVisible: boolean;
  accountModeVisible: boolean;
  reason: string;
}

interface OkxSwapAccountContext {
  instruments: any[];
  accountModeVisible: boolean;
  observedAt: number;
}

interface KalshiCapitalAdmission {
  ready: boolean;
  requiredMarginUsd: number;
  requiredHedgeUsd: number;
  systemOwnedMarginUsd: number;
  usableMarginUsd: number;
  systemOwnedHedgeUsd: number;
  accountEquityUsd: number | null;
  unexplainedAccountEquityUsd: number | null;
  reasons: string[];
}

const FALLBACK_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT',
  'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'LTCUSDT', 'BCHUSDT', 'UNIUSDT',
];

const OKX_SWAP_CONTEXT_TTL_MS = Math.max(10_000, Number(process.env.CRYPTOCRAWL_OKX_SWAP_CONTEXT_TTL_MS || 60_000));
let okxSwapContextCache: OkxSwapAccountContext | null = null;
let okxSwapContextInFlight: Promise<OkxSwapAccountContext> | null = null;
const okxSwapCapabilityCache = new Map<string, { expiresAt: number; value: OkxSwapCapability }>();
const okxSwapCapabilityInFlight = new Map<string, Promise<OkxSwapCapability>>();

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function feeCostBps(value: unknown): number | null {
  const parsed = finite(value);
  if (parsed === null) return null;
  return parsed < 0 ? Math.abs(parsed) * 10_000 : 0;
}

async function getOkxSwapAccountContext(): Promise<OkxSwapAccountContext> {
  if (okxSwapContextCache && Date.now() - okxSwapContextCache.observedAt <= OKX_SWAP_CONTEXT_TTL_MS) return okxSwapContextCache;
  if (okxSwapContextInFlight) return okxSwapContextInFlight;
  okxSwapContextInFlight = (async () => {
    const [instrumentsResponse, configResponse] = await Promise.all([
      okxPrivateRequest('/api/v5/account/instruments', 'GET', { instType: 'SWAP' }, { lane: 'account_read' }),
      okxPrivateRequest('/api/v5/account/config', 'GET', {}, { lane: 'account_read' }),
    ]);
    const config = configResponse.data?.[0] || null;
    const context: OkxSwapAccountContext = {
      instruments: Array.isArray(instrumentsResponse.data) ? instrumentsResponse.data : [],
      accountModeVisible: !!config && String(config?.acctLv || '').trim().length > 0,
      observedAt: Date.now(),
    };
    okxSwapContextCache = context;
    return context;
  })().finally(() => { okxSwapContextInFlight = null; });
  return okxSwapContextInFlight;
}

async function getOkxSwapCapability(observation: FundingRateObservation): Promise<OkxSwapCapability> {
  if (observation.venue !== 'okx') return { feeBps: null, instrumentVisible: false, accountModeVisible: false, reason: 'not_okx' };
  const cacheKey = observation.instrumentId.toUpperCase();
  const cached = okxSwapCapabilityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const inFlight = okxSwapCapabilityInFlight.get(cacheKey);
  if (inFlight) return inFlight;
  const promise = (async (): Promise<OkxSwapCapability> => {
    try {
      const accountContext = await getOkxSwapAccountContext();
      const instrument = accountContext.instruments.find((row: any) => String(row?.instId || '').toUpperCase() === observation.instrumentId.toUpperCase());
      const state = String(instrument?.state || '').toLowerCase();
      const instrumentVisible = !!instrument && (!state || state === 'live' || state === 'post_only');
      if (!instrumentVisible) {
        const unavailable: OkxSwapCapability = { feeBps: null, instrumentVisible: false, accountModeVisible: accountContext.accountModeVisible, reason: 'Existing OKX credentials did not expose this SWAP instrument as live' };
        okxSwapCapabilityCache.set(cacheKey, { expiresAt: Date.now() + OKX_SWAP_CONTEXT_TTL_MS, value: unavailable });
        return unavailable;
      }
      const groupId = String(instrument?.groupId || '').trim();
      const family = observation.instrumentId.replace(/-SWAP$/i, '');
      const feeRates = await resolveOkxAccountFeeRates({ instType: 'SWAP', ...(groupId ? { groupId, expectedGroupId: groupId } : { instFamily: family }) });
      const value: OkxSwapCapability = {
        feeBps: feeCostBps(feeRates.taker),
        instrumentVisible,
        accountModeVisible: accountContext.accountModeVisible,
        reason: accountContext.accountModeVisible
          ? 'OKX SWAP instrument/account/fee capability is authenticated; exact execution depth, sizing and lifecycle are measured separately before promotion'
          : 'Existing OKX credentials did not prove the derivatives account mode',
      };
      okxSwapCapabilityCache.set(cacheKey, { expiresAt: Date.now() + OKX_SWAP_CONTEXT_TTL_MS, value });
      return value;
    } catch (error) {
      return { feeBps: null, instrumentVisible: false, accountModeVisible: false, reason: `OKX SWAP capability probe unavailable: ${error instanceof Error ? error.message : String(error)}` };
    }
  })().finally(() => { okxSwapCapabilityInFlight.delete(cacheKey); });
  okxSwapCapabilityInFlight.set(cacheKey, promise);
  return promise;
}

function quotedAsset(symbol: string): string[] {
  const match = symbol.match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  return match ? [match[1], match[2]] : [symbol];
}

function entryWindow(observation: FundingRateObservation): { eligible: boolean; expiresAt: number; reason: string } {
  const now = Date.now();
  const fundingAt = observation.fundingTime ?? null;
  const supportedVenue = observation.venue === 'okx' || observation.venue === 'kalshi_perps';
  if (!supportedVenue || fundingAt === null || !Number.isFinite(fundingAt)) {
    return { eligible: false, expiresAt: now, reason: 'future_funding_timestamp_unavailable' };
  }
  if (observation.fundingRateLocked) {
    return { eligible: false, expiresAt: now, reason: 'settlement_already_processing_new_position_not_assumed_eligible' };
  }
  const minLeadMs = Math.max(2_000, Math.min(120_000, Number(process.env.CRYPTOCRAWL_FUNDING_MIN_ENTRY_LEAD_MS || 10_000)));
  const maxLeadMs = Math.max(minLeadMs, Math.min(30 * 60_000, Number(process.env.CRYPTOCRAWL_FUNDING_MAX_ENTRY_LEAD_MS || 180_000)));
  const leadMs = fundingAt - now;
  if (leadMs < minLeadMs) return { eligible: false, expiresAt: now, reason: 'funding_entry_window_too_late' };
  if (leadMs > maxLeadMs) return { eligible: false, expiresAt: now, reason: 'funding_entry_window_not_yet_open' };
  const evidenceTtlMs = Math.max(1_000, Math.min(30_000, Number(process.env.CRYPTOCRAWL_FUNDING_ENTRY_EVIDENCE_TTL_MS || 5_000)));
  return { eligible: true, expiresAt: Math.min(fundingAt - 1, now + evidenceTtlMs), reason: 'pre_settlement_entry_window_open' };
}

function fundingEnrichmentPriority(observation: FundingRateObservation): [number, number, number] {
  const positiveSupportedDirection = observation.fundingRate > 0 ? 1 : 0;
  const windowOpen = entryWindow(observation).eligible ? 1 : 0;
  return [positiveSupportedDirection, windowOpen, Math.abs(observation.fundingRate)];
}

function compareFundingEnrichmentPriority(left: FundingRateObservation, right: FundingRateObservation): number {
  const a = fundingEnrichmentPriority(left);
  const b = fundingEnrichmentPriority(right);
  return b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
}

async function kalshiCapitalAdmission(
  evidence: KalshiFundingExecutionEvidence,
  expectedEntryCostUsd: number,
  expectedExitCostUsd: number,
): Promise<KalshiCapitalAdmission> {
  const hydrated = await hydrateKalshiFundingCapitalReadiness(evidence).catch(() => null);
  const [snapshot, readiness, hedgeOwnedRaw] = await Promise.all([
    getKalshiSystemMarginSnapshot(true).catch(() => null),
    getKalshiMarginAccountReadiness(true, true).catch(() => null),
    getExactSystemOwnedCexInventory(evidence.hedgeVenue, evidence.quoteAsset).catch(() => '0'),
  ]);
  const requiredMarginUsd = evidence.measuredNotionalUsd
    + Math.max(0, expectedEntryCostUsd)
    + Math.max(0, expectedExitCostUsd)
    + Math.max(1, evidence.measuredNotionalUsd * 0.01);
  const requiredHedgeUsd = evidence.spotEntryLimit * evidence.baseQuantity
    * (1 + evidence.hedgeTakerFeeBps / 10_000 + 0.0025);
  const hedgeOwned = Number(hedgeOwnedRaw);
  const equity = finite(readiness?.accountEquityUsd);
  const systemOwnedMarginUsd = snapshot?.ownedUsd ?? 0;
  const usableMarginUsd = snapshot?.usableUsd ?? 0;
  const unexplained = equity === null ? null : Math.max(0, equity - systemOwnedMarginUsd);
  const equityTolerance = equity === null ? 0 : Math.max(0.01, equity * 1e-6);
  const reasons: string[] = [];
  if (!hydrated || hydrated.authenticatedMarginAvailableComputed !== true) reasons.push('required:kalshi_authenticated_computed_margin_available');
  if (!snapshot?.authenticatedCapacity || usableMarginUsd + 1e-9 < requiredMarginUsd) reasons.push('required:kalshi_system_owned_margin_capital_provenance');
  if (equity === null || unexplained === null || unexplained > equityTolerance) reasons.push('required:kalshi_margin_account_exclusive_system_ownership');
  if (!Number.isFinite(hedgeOwned) || hedgeOwned + 1e-9 < requiredHedgeUsd) reasons.push(`required:${evidence.hedgeVenue}_system_owned_usd_hedge_inventory`);
  return {
    ready: reasons.length === 0,
    requiredMarginUsd,
    requiredHedgeUsd,
    systemOwnedMarginUsd,
    usableMarginUsd,
    systemOwnedHedgeUsd: Number.isFinite(hedgeOwned) ? Math.max(0, hedgeOwned) : 0,
    accountEquityUsd: equity,
    unexplainedAccountEquityUsd: unexplained,
    reasons,
  };
}

class FundingRateMonitor {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private cycles = 0;
  private lastCycleAt: number | null = null;
  private lastError: string | null = null;

  start(): void {
    if (this.timer) return;
    const intervalMs = Math.max(10_000, Number(process.env.CRYPTOCRAWL_FUNDING_SCAN_INTERVAL_MS || 30_000));
    const cycle = (): void => {
      void this.scanOnce().finally(() => {
        if (this.timer) this.timer = setTimeout(cycle, intervalMs);
        this.timer?.unref?.();
      });
    };
    this.timer = setTimeout(cycle, 0);
    this.timer.unref?.();
    logger.info('[FundingMonitor] Public funding-rate monitor started', {
      component: 'FundingRateMonitor', intervalMs, venues: ['okx', 'kraken_futures', 'binance_futures', 'kalshi_perps'],
      okxPrivateAccountContextTtlMs: OKX_SWAP_CONTEXT_TTL_MS, newKeysRequiredForDiscovery: false,
      durableFundingLifecycleImplemented: true,
      executionAuthority: 'funding_position_lifecycle_for_bounded_positive_pre_settlement_okx_and_kalshi_carry',
      kalshiExecutionAuthority: 'funding_position_lifecycle_fail_closed_on_system_owned_capital',
      kalshiExecutionStatus: 'registered_and_promotable_only_with_exclusive_system_owned_margin_plus_system_owned_direct_usd_hedge_inventory',
      projectedProfitIsDeterministicProfit: false,
      measurableProjectedBpsOutsideEntryWindow: true,
      firstPassPrivateEvidenceForAllOkxRoutes: true,
      firstPassMeasuredEvidenceForSupportedKalshiRoutes: true,
    });
  }

  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }

  async scanOnce(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runScan().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  getStats(): { running: boolean; cycles: number; lastCycleAt: number | null; lastError: string | null } {
    return { running: this.timer !== null, cycles: this.cycles, lastCycleAt: this.lastCycleAt, lastError: this.lastError };
  }

  private async runScan(): Promise<void> {
    const universe = getLastOrderedMarketUniverseSymbols();
    const symbols = [...new Set([...(universe.length ? universe : FALLBACK_SYMBOLS), ...FALLBACK_SYMBOLS])];
    try {
      ensureOkxFundingLifecycleAdapterRegistered();
      ensureKalshiFundingLifecycleAdapterRegistered();
      const batch = await discoverFundingRates(symbols);
      const notionalUsd = Math.max(1, Number(process.env.CRYPTOCRAWL_FUNDING_REFERENCE_NOTIONAL_USD || 250));
      const ttlMs = Math.max(5_000, Number(process.env.CRYPTOCRAWL_FUNDING_CANDIDATE_TTL_MS || 45_000));
      let projectedPositive = 0;
      let eligible = 0;
      let kalshiEligible = 0;

      const okxCapabilityTargets = batch.observations
        .filter(observation => observation.venue === 'okx')
        .sort(compareFundingEnrichmentPriority)
        .filter((observation, index, all) => all.findIndex(candidate => candidate.instrumentId === observation.instrumentId) === index);
      const okxTargetIds = new Set(okxCapabilityTargets.map(observation => observation.instrumentId));
      const okxEnrichment = new Map<string, {
        spotFee: Awaited<ReturnType<typeof resolveCexFeeEvidence>>;
        swapCapability: OkxSwapCapability;
        executionEvidence: OkxFundingExecutionEvidence | null;
      }>();
      await Promise.all(okxCapabilityTargets.map(async observation => {
        const [spotFee, swapCapability, executionEvidence] = await Promise.all([
          resolveCexFeeEvidence('okx', observation.symbol).catch(() => null),
          getOkxSwapCapability(observation),
          observation.fundingRate > 0
            ? measureOkxFundingExecutionEvidence({ symbol: observation.symbol, swapInstId: observation.instrumentId, targetNotionalUsd: notionalUsd }).catch(() => null)
            : Promise.resolve(null),
        ]);
        okxEnrichment.set(observation.instrumentId, { spotFee, swapCapability, executionEvidence });
      }));

      const kalshiTargets = batch.observations
        .filter(observation => observation.venue === 'kalshi_perps' && observation.fundingRate > 0)
        .sort(compareFundingEnrichmentPriority)
        .filter((observation, index, all) => all.findIndex(candidate => candidate.instrumentId === observation.instrumentId) === index);
      const kalshiEnrichment = new Map<string, KalshiFundingExecutionEvidence | null>();
      await Promise.all(kalshiTargets.map(async observation => {
        const evidence = await measureKalshiFundingExecutionEvidence({
          ticker: observation.instrumentId,
          targetNotionalUsd: notionalUsd,
        }).catch(() => null);
        kalshiEnrichment.set(observation.instrumentId, evidence);
      }));

      for (const observation of batch.observations) {
        const enrichment = observation.venue === 'okx' ? okxEnrichment.get(observation.instrumentId) : null;
        const spotFee = enrichment?.spotFee || null;
        const swapCapability = observation.venue === 'okx'
          ? enrichment?.swapCapability || { feeBps: null, instrumentVisible: false, accountModeVisible: false, reason: 'OKX first-pass private enrichment returned no capability evidence' }
          : { feeBps: null, instrumentVisible: false, accountModeVisible: false, reason: 'not_okx' };
        const executionEvidence = enrichment?.executionEvidence ?? null;
        const kalshiEvidence = observation.venue === 'kalshi_perps'
          ? kalshiEnrichment.get(observation.instrumentId) ?? null
          : null;
        const window = entryWindow(observation);
        const measuredNotionalUsd = kalshiEvidence?.measuredNotionalUsd ?? notionalUsd;
        const decision = evaluateFundingArbitrage({
          fundingRate: kalshiEvidence?.fundingRate ?? observation.fundingRate,
          notionalUsd: measuredNotionalUsd,
          spotEntryFeeBps: kalshiEvidence?.hedgeTakerFeeBps ?? spotFee?.takerFeeBps ?? null,
          spotExitFeeBps: kalshiEvidence?.hedgeTakerFeeBps ?? spotFee?.takerFeeBps ?? null,
          perpEntryFeeBps: kalshiEvidence?.kalshiTakerFeeBps ?? swapCapability.feeBps,
          perpExitFeeBps: kalshiEvidence?.kalshiTakerFeeBps ?? swapCapability.feeBps,
          entryBasisBps: kalshiEvidence?.entryBasisBps ?? executionEvidence?.entryBasisBps ?? observation.entryBasisBps,
          exitBasisReserveBps: kalshiEvidence?.exitBasisReserveBps ?? executionEvidence?.exitBasisReserveBps ?? null,
          expectedSlippageBps: kalshiEvidence?.expectedSlippageBps ?? executionEvidence?.expectedSlippageBps ?? null,
          borrowCostUsd: observation.fundingRate < 0 ? null : 0,
          fundingRateLocked: false,
          shortSpotCapability: false,
        });
        const projectedNet = decision.projectedNetProfitUsd;
        if (projectedNet !== null && projectedNet > 0) projectedPositive++;

        const fees = Math.max(0, decision.expectedTradingFeesUsd ?? 0);
        const basis = Math.max(0, decision.expectedBasisAndSlippageUsd ?? 0);
        const okxExecutionCapable = observation.venue === 'okx'
          && observation.fundingRate > 0
          && projectedNet !== null
          && projectedNet > 0
          && window.eligible
          && executionEvidence !== null
          && executionEvidence.expiresAt > Date.now()
          && swapCapability.instrumentVisible
          && swapCapability.accountModeVisible;

        const kalshiCapital = observation.venue === 'kalshi_perps'
          && kalshiEvidence
          && projectedNet !== null
          && projectedNet > 0
          && window.eligible
          ? await kalshiCapitalAdmission(kalshiEvidence, fees / 2 + basis / 2, fees / 2 + basis / 2).catch(() => null)
          : null;
        const kalshiExecutionCapable = observation.venue === 'kalshi_perps'
          && observation.fundingRate > 0
          && projectedNet !== null
          && projectedNet > 0
          && window.eligible
          && kalshiEvidence !== null
          && kalshiEvidence.expiresAt > Date.now()
          && kalshiCapital?.ready === true;
        const executionCapable = okxExecutionCapable || kalshiExecutionCapable;
        const opportunityId = `funding:${observation.venue}:${observation.instrumentId}:${observation.symbol}`;
        const exactEvidenceExpiry = kalshiEvidence?.expiresAt ?? executionEvidence?.expiresAt ?? Number.POSITIVE_INFINITY;
        const expiresAt = executionCapable
          ? Math.min(observation.observedAt + ttlMs, exactEvidenceExpiry, window.expiresAt)
          : kalshiEvidence
            ? Math.min(observation.observedAt + ttlMs, kalshiEvidence.expiresAt)
            : observation.observedAt + ttlMs;

        if (okxExecutionCapable) {
          const marginFraction = Math.max(0.02, Math.min(0.50, Number(process.env.CRYPTOCRAWL_FUNDING_MARGIN_BUFFER_FRACTION || 0.10)));
          const plan: OkxFundingExecutionPlan = {
            opportunityId,
            venue: 'okx',
            symbol: observation.symbol,
            notionalUsd,
            expectedNetProfitUsd: projectedNet!,
            expectedEntryCostUsd: fees / 2 + basis / 2,
            expectedExitCostUsd: fees / 2 + basis / 2,
            expectedFundingUsd: decision.expectedFundingUsd ?? 0,
            marginBufferUsd: notionalUsd * marginFraction,
            fundingTimestamp: observation.fundingTime!,
            expiresAt,
            provenance: [
              ...observation.provenance,
              ...executionEvidence!.provenance,
              'funding_profit_authority:projected_expected_value_until_terminal_bill',
              'funding_entry:before_settlement_assessment',
              'funding_entry_exit_depth:measured',
              'funding_lifecycle:okx_registered',
            ],
            okx: {
              spotInstId: executionEvidence!.spotInstId,
              swapInstId: executionEvidence!.swapInstId,
              baseAsset: executionEvidence!.baseAsset,
              quoteAsset: executionEvidence!.quoteAsset,
              contracts: executionEvidence!.contracts,
              baseQuantity: executionEvidence!.baseQuantity,
              lockedFundingRate: observation.fundingRate,
              evidenceMeasuredAt: executionEvidence!.measuredAt,
              evidenceExpiresAt: executionEvidence!.expiresAt,
              entry: { spotEntryLimit: executionEvidence!.spotEntryLimit, perpEntryLimit: executionEvidence!.perpEntryLimit },
            },
          };
          rememberPreparedOkxFundingPlan(plan);
          eligible++;
        }

        if (kalshiExecutionCapable && kalshiEvidence && kalshiCapital) {
          const plan: KalshiFundingExecutionPlan = {
            opportunityId,
            venue: 'kalshi_perps',
            symbol: observation.symbol,
            notionalUsd: kalshiEvidence.measuredNotionalUsd,
            expectedNetProfitUsd: projectedNet!,
            expectedEntryCostUsd: fees / 2 + basis / 2,
            expectedExitCostUsd: fees / 2 + basis / 2,
            expectedFundingUsd: decision.expectedFundingUsd ?? 0,
            marginBufferUsd: kalshiCapital.requiredMarginUsd,
            fundingTimestamp: kalshiEvidence.nextFundingTime,
            expiresAt,
            provenance: [
              ...observation.provenance,
              ...kalshiEvidence.provenance,
              'funding_profit_authority:projected_expected_value_until_terminal_fills_and_funding_history',
              'funding_entry:before_settlement_assessment',
              'funding_entry_exit_depth:kalshi_perps_plus_direct_usd_cex_measured',
              'funding_lifecycle:kalshi_registered',
              'kalshi_margin:exclusive_system_owned_capital_provenance_proven',
              `${kalshiEvidence.hedgeVenue}_usd_hedge:system_owned_inventory_proven`,
            ],
            kalshi: {
              ticker: kalshiEvidence.ticker,
              baseAsset: kalshiEvidence.baseAsset,
              quoteAsset: kalshiEvidence.quoteAsset,
              hedgeVenue: kalshiEvidence.hedgeVenue,
              hedgeSymbol: kalshiEvidence.hedgeSymbol,
              contracts: kalshiEvidence.contracts,
              contractSize: kalshiEvidence.contractSize,
              baseQuantity: kalshiEvidence.baseQuantity,
              fundingRate: kalshiEvidence.fundingRate,
              evidenceMeasuredAt: kalshiEvidence.measuredAt,
              evidenceExpiresAt: kalshiEvidence.expiresAt,
              kalshiTakerFeeBps: kalshiEvidence.kalshiTakerFeeBps,
              hedgeTakerFeeBps: kalshiEvidence.hedgeTakerFeeBps,
              entry: {
                kalshiEntryLimit: kalshiEvidence.kalshiEntryLimit,
                spotEntryLimit: kalshiEvidence.spotEntryLimit,
              },
            },
          };
          rememberPreparedKalshiFundingPlan(plan);
          eligible++;
          kalshiEligible++;
        }

        const missingInformation = [
          ...decision.missingInformation,
          ...(observation.venue === 'okx' && observation.fundingRate > 0 && !executionEvidence ? ['required:measured_entry_exit_depth_margin_capacity'] : []),
          ...(observation.venue === 'kalshi_perps' && observation.fundingRate > 0 && !kalshiEvidence ? ['required:kalshi_exact_perps_and_direct_usd_spot_hedge_evidence'] : []),
          ...(observation.venue === 'kalshi_perps' && kalshiEvidence && kalshiCapital ? kalshiCapital.reasons : []),
          ...(observation.venue === 'kalshi_perps' && kalshiEvidence && !kalshiCapital && projectedNet !== null && projectedNet > 0 && window.eligible ? ['required:kalshi_system_capital_readiness_evidence'] : []),
          ...(!window.eligible && (observation.venue === 'okx' || observation.venue === 'kalshi_perps') ? [`advisory:${window.reason}`] : []),
          ...(observation.venue === 'kraken_futures' ? ['required:kraken_derivatives_execution_credentials'] : []),
          ...(observation.venue === 'binance_futures' ? ['required:binance_execution_capability_intentionally_disabled'] : []),
          ...(observation.venue === 'okx' && !swapCapability.instrumentVisible ? ['required:okx_swap_instrument_capability'] : []),
          ...(observation.venue === 'okx' && !swapCapability.accountModeVisible ? ['required:okx_derivatives_account_mode'] : []),
        ];

        const exactDepthMeasured = executionEvidence !== null || kalshiEvidence !== null;
        const exactProvenance = [
          ...(executionEvidence?.provenance ?? []),
          ...(kalshiEvidence?.provenance ?? []),
          ...(kalshiCapital ? [
            `kalshi_system_owned_margin_usd:${kalshiCapital.systemOwnedMarginUsd}`,
            `kalshi_usable_margin_usd:${kalshiCapital.usableMarginUsd}`,
            `kalshi_required_margin_usd:${kalshiCapital.requiredMarginUsd}`,
            `kalshi_system_owned_hedge_usd:${kalshiCapital.systemOwnedHedgeUsd}`,
            `kalshi_required_hedge_usd:${kalshiCapital.requiredHedgeUsd}`,
            `kalshi_unexplained_account_equity_usd:${kalshiCapital.unexplainedAccountEquityUsd ?? 'unknown'}`,
          ] : []),
        ];
        const quotePrice = kalshiEvidence?.kalshiEntryVwap ?? observation.perpReferencePrice;
        const candidateAssets = kalshiEvidence ? [kalshiEvidence.baseAsset, 'USD'] : quotedAsset(observation.symbol);
        const candidateVenues = kalshiEvidence ? [observation.venue, kalshiEvidence.hedgeVenue] : [observation.venue];

        measuredCandidateRegistry.record({
          opportunityId,
          topology: 'FUNDING_ARBITRAGE',
          observedAt: observation.observedAt,
          expiresAt,
          status: executionCapable ? 'eligible' : 'enriched',
          assets: candidateAssets,
          venues: candidateVenues,
          chains: ['cex'],
          rawQuotes: [{
            source: `${observation.venue}:funding_rate`, venue: observation.venue, symbol: observation.symbol,
            observedAt: observation.observedAt, price: quotePrice, executable: executionCapable,
            provenance: [
              ...observation.provenance,
              `funding_rate:${kalshiEvidence?.fundingRate ?? observation.fundingRate}`,
              `funding_rate_kind:${observation.fundingRateKind}`,
              `funding_rate_locked:${observation.fundingRateLocked}`,
              ...(observation.fundingTime ? [`funding_time:${observation.fundingTime}`] : []),
              ...(observation.nextFundingTime ? [`next_funding_time:${observation.nextFundingTime}`] : []),
              ...exactProvenance,
            ],
          }],
          depth: exactDepthMeasured
            ? {
                status: 'measured',
                detail: kalshiEvidence
                  ? `Kalshi perps and ${kalshiEvidence.hedgeVenue} direct-USD spot entry/exit depth measured at the exact hedged contract/base quantity with authenticated fees`
                  : 'OKX spot and SWAP entry/exit VWAP depth measured at exact contract/base quantities with authenticated contract sizing and max-size capacity',
              }
            : {
                status: 'unavailable',
                detail: observation.venue === 'kalshi_perps'
                  ? 'Kalshi positive-funding routes are sent through exact perps plus direct-USD Kraken/OKX hedge depth/fee acquisition; missing exact evidence stays explicit'
                  : 'All supported positive-direction OKX routes are sent through exact private depth/sizing evidence acquisition in their first discovery cycle; unavailable evidence remains explicit rather than budget-deferred',
              },
          economics: {
            grossProfitUsd: decision.expectedFundingUsd,
            deterministicNetProfitUsd: null,
            feeUsd: decision.expectedTradingFeesUsd,
            gasUsd: 0,
            bridgeUsd: 0,
            expectedSlippageBps: kalshiEvidence?.expectedSlippageBps ?? executionEvidence?.expectedSlippageBps ?? null,
            expectedPriceImpactBps: kalshiEvidence?.exitBasisReserveBps ?? executionEvidence?.exitBasisReserveBps ?? null,
            notionalUsd: measuredNotionalUsd,
            netProfitBps: projectedNet !== null ? projectedNet / measuredNotionalUsd * 10_000 : null,
          },
          quoteAgeMs: Math.max(0, Date.now() - observation.observedAt),
          executableCapability: executionCapable,
          executionCapabilityReason: executionCapable
            ? kalshiExecutionCapable
              ? `Kalshi positive projected carry is inside the pre-settlement entry window with authenticated effective fees, exact Kalshi-perps/${kalshiEvidence!.hedgeVenue}-USD depth, exclusive system-owned Kalshi margin, system-owned hedge inventory, deterministic FOK recovery, margin monitoring and terminal funding/fill accounting`
              : 'OKX positive projected carry is inside the pre-settlement entry window with authenticated fees, measured SPOT/SWAP depth, exact contract sizing, system-capital-aware lifecycle capability, FOK entry/close, margin monitoring, authenticated funding bills and terminal realized accounting'
            : observation.venue === 'kalshi_perps' && kalshiEvidence
              ? `Kalshi positive carry has authenticated effective fees and exact Kalshi-perps/${kalshiEvidence.hedgeVenue}-USD hedge depth with measured projected all-in BPS; live execution remains fail-closed on the listed system-capital evidence only`
              : observation.venue === 'kalshi_perps'
                ? 'Kalshi public funding is visible, but exact perps/direct-USD hedge execution evidence is incomplete and no economics are fabricated'
                : observation.venue === 'okx' && projectedNet !== null
                  ? `${swapCapability.reason}; projected all-in BPS is measured independently of entry-window timing; ${window.reason}`
                  : observation.venue === 'okx' ? `${swapCapability.reason}; ${window.reason}`
                    : observation.venue === 'kraken_futures'
                      ? 'Kraken Futures public funding is visible without authentication, but Kraken Spot credentials are not Derivatives execution credentials'
                      : 'Binance Futures is public discovery only; Binance live execution remains intentionally disabled in CryptoCrawler',
          missingInformation: [...new Set(missingInformation)],
          provenance: [
            ...observation.provenance,
            ...exactProvenance,
            'funding_arbitrage_policy:all_in_projected_costs_required',
            'funding_projected_profit_is_not_deterministic_profit',
            'funding_measured_bps:not_gated_by_entry_window',
            observation.venue === 'kalshi_perps'
              ? 'funding_private_enrichment:kalshi_authenticated_fee_and_market_entitlement_plus_exact_direct_usd_hedge'
              : 'funding_private_enrichment:all_supported_okx_routes_first_pass',
            'funding_private_evidence:budget_defer_removed',
            'durable_funding_lifecycle:migration_owned_nonblocking',
            ...(observation.venue === 'okx' ? ['okx_funding_lifecycle:authenticated_fills_and_bills'] : []),
            ...(observation.venue === 'kalshi_perps' ? [
              'kalshi_funding_lifecycle:registered_nonblocking',
              'kalshi_margin_balance:capacity_only_not_ownership',
              kalshiCapital?.ready === true ? 'kalshi_system_capital:execution_proven' : 'kalshi_system_capital:missing_nonpromoting',
            ] : []),
            'unknown_cost_is_not_zero',
            executionCapable ? 'execution_promoted_from_projected_carry_and_minimum_sufficient_execution_evidence' : 'execution_not_promoted_without_required_execution_evidence',
          ],
        });
      }

      this.cycles++;
      this.lastCycleAt = Date.now();
      this.lastError = null;
      logger.info('[FundingMonitor] Funding discovery cycle completed', {
        component: 'FundingRateMonitor', requestedSymbols: batch.requestedSymbols, observations: batch.observations.length,
        failures: batch.failures, projectedPositive, deterministicPositive: 0, eligible,
        durableFundingLifecycleImplemented: true, okxSwapCapabilityCacheEntries: okxSwapCapabilityCache.size,
        okxPrivateCapabilityTargets: okxTargetIds.size,
        okxPrivateCapabilityDeferred: 0,
        kalshiExactEvidenceTargets: kalshiTargets.length,
        kalshiExactEvidenceResolved: [...kalshiEnrichment.values()].filter(Boolean).length,
        kalshiExecutionEligible: kalshiEligible,
        kalshiExecutionBlockedByMissingSystemCapital: kalshiEligible === 0 && [...kalshiEnrichment.values()].some(Boolean),
        firstPassPrivateEvidenceForAllOkxRoutes: true,
        firstPassMeasuredEvidenceForSupportedKalshiRoutes: true,
        projectedBpsMeasuredOutsideEntryWindow: true,
        publicDiscoveryBlockedByPrivateEnrichment: false,
        note: 'Funding entries are projected carry before settlement; only authenticated terminal fills and funding bills/history become realized profit truth',
      });
    } catch (error) {
      this.cycles++;
      this.lastCycleAt = Date.now();
      this.lastError = error instanceof Error ? error.message : String(error);
      logger.warn('[FundingMonitor] Funding discovery cycle degraded', { component: 'FundingRateMonitor', error: this.lastError });
    }
  }
}

export const fundingRateMonitor = new FundingRateMonitor();