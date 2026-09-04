import logger from '../../../logger.js';
import { getLastOrderedMarketUniverseSymbols } from './market-universe-controller.js';
import { measuredCandidateRegistry } from './measured-candidate-registry.js';
import { discoverFundingRates, type FundingRateObservation } from './funding-rate-discovery.js';
import { evaluateFundingArbitrage } from './funding-arbitrage-policy.js';
import { resolveCexFeeEvidence } from '../intelligence/cex-fee-resolver.js';
import { okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import { resolveOkxAccountFeeRates } from '../intelligence/okx-account-fee-authority.js';
import { measureOkxFundingExecutionEvidence, type OkxFundingExecutionEvidence } from '../execution/okx-funding-evidence.js';
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

const FALLBACK_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT',
  'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'LTCUSDT', 'BCHUSDT', 'UNIUSDT',
];

const OKX_SWAP_CONTEXT_TTL_MS = Math.max(10_000, Number(process.env.CRYPTOCRAWL_OKX_SWAP_CONTEXT_TTL_MS || 60_000));
const OKX_SWAP_CAPABILITY_PROBE_BUDGET = Math.max(1, Math.min(16, Math.floor(Number(process.env.CRYPTOCRAWL_OKX_SWAP_CAPABILITY_PROBE_BUDGET || 8))));
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

function deferredOkxSwapCapability(): OkxSwapCapability {
  return { feeBps: null, instrumentVisible: false, accountModeVisible: false, reason: 'Private OKX SWAP enrichment deferred by the bounded discovery budget; public evidence is retained and execution remains fail-closed' };
}

function quotedAsset(symbol: string): string[] {
  const match = symbol.match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  return match ? [match[1], match[2]] : [symbol];
}

function entryWindow(observation: FundingRateObservation): { eligible: boolean; expiresAt: number; reason: string } {
  const now = Date.now();
  const fundingAt = observation.fundingTime ?? null;
  if (observation.venue !== 'okx' || fundingAt === null || !Number.isFinite(fundingAt)) {
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
      component: 'FundingRateMonitor', intervalMs, venues: ['okx', 'kraken_futures', 'binance_futures'],
      okxPrivateAccountContextTtlMs: OKX_SWAP_CONTEXT_TTL_MS, newKeysRequiredForDiscovery: false,
      durableFundingLifecycleImplemented: true,
      executionAuthority: 'funding_position_lifecycle_for_bounded_positive_pre_settlement_okx_carry',
      projectedProfitIsDeterministicProfit: false,
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
      const batch = await discoverFundingRates(symbols);
      const notionalUsd = Math.max(1, Number(process.env.CRYPTOCRAWL_FUNDING_REFERENCE_NOTIONAL_USD || 250));
      const ttlMs = Math.max(5_000, Number(process.env.CRYPTOCRAWL_FUNDING_CANDIDATE_TTL_MS || 45_000));
      let projectedPositive = 0;
      let eligible = 0;

      const okxCapabilityTargets = batch.observations
        .filter(observation => observation.venue === 'okx')
        .sort((left, right) => Math.abs(right.fundingRate) - Math.abs(left.fundingRate))
        .filter((observation, index, all) => all.findIndex(candidate => candidate.instrumentId === observation.instrumentId) === index)
        .slice(0, OKX_SWAP_CAPABILITY_PROBE_BUDGET);
      const okxTargetIds = new Set(okxCapabilityTargets.map(observation => observation.instrumentId));
      const okxEnrichment = new Map<string, {
        spotFee: Awaited<ReturnType<typeof resolveCexFeeEvidence>>;
        swapCapability: OkxSwapCapability;
        executionEvidence: OkxFundingExecutionEvidence | null;
      }>();
      await Promise.all(okxCapabilityTargets.map(async observation => {
        const window = entryWindow(observation);
        const [spotFee, swapCapability, executionEvidence] = await Promise.all([
          resolveCexFeeEvidence('okx', observation.symbol).catch(() => null),
          getOkxSwapCapability(observation),
          observation.fundingRate > 0 && window.eligible
            ? measureOkxFundingExecutionEvidence({ symbol: observation.symbol, swapInstId: observation.instrumentId, targetNotionalUsd: notionalUsd }).catch(() => null)
            : Promise.resolve(null),
        ]);
        okxEnrichment.set(observation.instrumentId, { spotFee, swapCapability, executionEvidence });
      }));

      for (const observation of batch.observations) {
        const enrichment = observation.venue === 'okx' ? okxEnrichment.get(observation.instrumentId) : null;
        const spotFee = enrichment?.spotFee || null;
        const swapCapability = observation.venue === 'okx' ? enrichment?.swapCapability || deferredOkxSwapCapability() : { feeBps: null, instrumentVisible: false, accountModeVisible: false, reason: 'not_okx' };
        const executionEvidence = enrichment?.executionEvidence ?? null;
        const window = entryWindow(observation);
        const decision = evaluateFundingArbitrage({
          fundingRate: observation.fundingRate,
          notionalUsd,
          spotEntryFeeBps: spotFee?.takerFeeBps ?? null,
          spotExitFeeBps: spotFee?.takerFeeBps ?? null,
          perpEntryFeeBps: swapCapability.feeBps,
          perpExitFeeBps: swapCapability.feeBps,
          entryBasisBps: executionEvidence?.entryBasisBps ?? observation.entryBasisBps,
          exitBasisReserveBps: executionEvidence?.exitBasisReserveBps ?? null,
          expectedSlippageBps: executionEvidence?.expectedSlippageBps ?? null,
          borrowCostUsd: observation.fundingRate < 0 ? null : 0,
          fundingRateLocked: false,
          shortSpotCapability: false,
        });
        const projectedNet = decision.projectedNetProfitUsd;
        if (projectedNet !== null && projectedNet > 0) projectedPositive++;
        const executionCapable = observation.venue === 'okx'
          && observation.fundingRate > 0
          && projectedNet !== null
          && projectedNet > 0
          && window.eligible
          && executionEvidence !== null
          && executionEvidence.expiresAt > Date.now()
          && swapCapability.instrumentVisible
          && swapCapability.accountModeVisible;
        const opportunityId = `funding:${observation.venue}:${observation.instrumentId}:${observation.symbol}`;
        const expiresAt = executionCapable
          ? Math.min(observation.observedAt + ttlMs, executionEvidence!.expiresAt, window.expiresAt)
          : observation.observedAt + ttlMs;

        if (executionCapable) {
          const fees = Math.max(0, decision.expectedTradingFeesUsd ?? 0);
          const basis = Math.max(0, decision.expectedBasisAndSlippageUsd ?? 0);
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

        const missingInformation = [
          ...decision.missingInformation,
          ...(observation.venue === 'okx' && !executionEvidence ? ['measured_entry_exit_depth_margin_capacity'] : []),
          ...(!window.eligible && observation.venue === 'okx' ? [window.reason] : []),
          ...(observation.venue === 'kraken_futures' ? ['kraken_derivatives_execution_credentials'] : []),
          ...(observation.venue === 'binance_futures' ? ['binance_execution_capability_intentionally_disabled'] : []),
          ...(observation.venue === 'okx' && !swapCapability.instrumentVisible ? ['okx_swap_instrument_capability'] : []),
          ...(observation.venue === 'okx' && !swapCapability.accountModeVisible ? ['okx_derivatives_account_mode'] : []),
        ];

        measuredCandidateRegistry.record({
          opportunityId,
          topology: 'FUNDING_ARBITRAGE',
          observedAt: observation.observedAt,
          expiresAt,
          status: executionCapable ? 'eligible' : 'enriched',
          assets: quotedAsset(observation.symbol),
          venues: [observation.venue],
          chains: ['cex'],
          rawQuotes: [{
            source: `${observation.venue}:funding_rate`, venue: observation.venue, symbol: observation.symbol,
            observedAt: observation.observedAt, price: observation.perpReferencePrice, executable: executionCapable,
            provenance: [
              ...observation.provenance,
              `funding_rate:${observation.fundingRate}`,
              `funding_rate_kind:${observation.fundingRateKind}`,
              `funding_rate_locked:${observation.fundingRateLocked}`,
              ...(observation.fundingTime ? [`funding_time:${observation.fundingTime}`] : []),
              ...(observation.nextFundingTime ? [`next_funding_time:${observation.nextFundingTime}`] : []),
              ...(executionEvidence?.provenance ?? []),
            ],
          }],
          depth: executionEvidence
            ? { status: 'measured', detail: 'OKX spot and SWAP entry/exit VWAP depth measured at exact contract/base quantities with authenticated contract sizing and max-size capacity' }
            : { status: 'unavailable', detail: 'Exact executable spot/SWAP depth and margin capacity were not acquired in this bounded cycle' },
          economics: {
            grossProfitUsd: decision.expectedFundingUsd,
            // Projected funding carry is deliberately not canonical deterministic profit.
            deterministicNetProfitUsd: null,
            feeUsd: decision.expectedTradingFeesUsd,
            gasUsd: 0,
            bridgeUsd: 0,
            expectedSlippageBps: executionEvidence?.expectedSlippageBps ?? null,
            expectedPriceImpactBps: executionEvidence?.exitBasisReserveBps ?? null,
            notionalUsd,
            netProfitBps: projectedNet !== null ? projectedNet / notionalUsd * 10_000 : null,
          },
          quoteAgeMs: Math.max(0, Date.now() - observation.observedAt),
          executableCapability: executionCapable,
          executionCapabilityReason: executionCapable
            ? 'OKX positive projected carry is inside the pre-settlement entry window with authenticated fees, measured SPOT/SWAP depth, exact contract sizing, system-capital-aware lifecycle capability, FOK entry/close, margin monitoring, authenticated funding bills and terminal realized accounting'
            : observation.venue === 'okx' ? `${swapCapability.reason}; ${window.reason}`
              : observation.venue === 'kraken_futures'
                ? 'Kraken Futures public funding is visible without authentication, but Kraken Spot credentials are not Derivatives execution credentials'
                : 'Binance Futures is public discovery only; Binance live execution remains intentionally disabled in CryptoCrawler',
          missingInformation: [...new Set(missingInformation)],
          provenance: [
            ...observation.provenance,
            'funding_arbitrage_policy:all_in_projected_costs_required',
            'funding_projected_profit_is_not_deterministic_profit',
            'durable_funding_lifecycle:migration_owned_nonblocking',
            'okx_funding_lifecycle:authenticated_fills_and_bills',
            'unknown_cost_is_not_zero',
            executionCapable ? 'execution_promoted_from_bounded_projected_carry_and_complete_execution_evidence' : 'execution_not_promoted_without_complete_pre_settlement_evidence',
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
        okxPrivateCapabilityProbeBudget: OKX_SWAP_CAPABILITY_PROBE_BUDGET, okxPrivateCapabilityTargets: okxTargetIds.size,
        okxPrivateCapabilityDeferred: Math.max(0, batch.observations.filter(observation => observation.venue === 'okx').length - okxTargetIds.size),
        publicDiscoveryBlockedByPrivateEnrichment: false,
        note: 'Funding entries are bounded projected carry before settlement; only authenticated terminal fills and funding bills become realized profit truth',
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
