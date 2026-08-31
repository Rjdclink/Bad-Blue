import logger from '../../../logger.js';
import { getLastOrderedMarketUniverseSymbols } from './market-universe-controller.js';
import { measuredCandidateRegistry } from './measured-candidate-registry.js';
import { discoverFundingRates, type FundingRateObservation } from './funding-rate-discovery.js';
import { evaluateFundingArbitrage } from './funding-arbitrage-policy.js';
import { resolveCexFeeEvidence } from '../intelligence/cex-fee-resolver.js';
import { okxPrivateRequest } from '../intelligence/cex-private-authority.js';

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
  // OKX account fee fields are decimal rates: negative means commission,
  // positive means rebate. A rebate is conservatively treated as zero cost here.
  return parsed < 0 ? Math.abs(parsed) * 10_000 : 0;
}

async function getOkxSwapAccountContext(): Promise<OkxSwapAccountContext> {
  if (okxSwapContextCache && Date.now() - okxSwapContextCache.observedAt <= OKX_SWAP_CONTEXT_TTL_MS) {
    return okxSwapContextCache;
  }
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
  if (observation.venue !== 'okx') {
    return { feeBps: null, instrumentVisible: false, accountModeVisible: false, reason: 'not_okx' };
  }

  const cacheKey = observation.instrumentId.toUpperCase();
  const cached = okxSwapCapabilityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const inFlight = okxSwapCapabilityInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const promise = (async (): Promise<OkxSwapCapability> => {
    try {
      const family = observation.instrumentId.replace(/-SWAP$/i, '');
      const [feeResponse, accountContext] = await Promise.all([
        okxPrivateRequest('/api/v5/account/trade-fee', 'GET', { instType: 'SWAP', instFamily: family }, { lane: 'trade_fee' }),
        getOkxSwapAccountContext(),
      ]);
      const feeRow = feeResponse.data?.[0] || null;
      const feeBps = feeCostBps(feeRow?.taker);
      const instrument = accountContext.instruments.find((row: any) =>
        String(row?.instId || '').toUpperCase() === observation.instrumentId.toUpperCase(),
      );
      const state = String(instrument?.state || '').toLowerCase();
      const instrumentVisible = !!instrument && (!state || state === 'live' || state === 'post_only');
      const value: OkxSwapCapability = {
        feeBps,
        instrumentVisible,
        accountModeVisible: accountContext.accountModeVisible,
        reason: instrumentVisible && accountContext.accountModeVisible
          ? 'Existing OKX credentials can read the SWAP instrument and account mode; the durable lifecycle exists, but live funding execution still requires a registered OKX lifecycle adapter plus measured entry/exit depth, margin-safe sizing and terminal funding/close evidence'
          : 'Existing OKX credentials did not prove both SWAP instrument visibility and account mode',
      };
      okxSwapCapabilityCache.set(cacheKey, { expiresAt: Date.now() + OKX_SWAP_CONTEXT_TTL_MS, value });
      return value;
    } catch (error) {
      return {
        feeBps: null,
        instrumentVisible: false,
        accountModeVisible: false,
        reason: `OKX SWAP capability probe unavailable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  })().finally(() => { okxSwapCapabilityInFlight.delete(cacheKey); });

  okxSwapCapabilityInFlight.set(cacheKey, promise);
  return promise;
}

function quotedAsset(symbol: string): string[] {
  const match = symbol.match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  return match ? [match[1], match[2]] : [symbol];
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
      component: 'FundingRateMonitor',
      intervalMs,
      venues: ['okx', 'kraken_futures', 'binance_futures'],
      okxPrivateAccountContextTtlMs: OKX_SWAP_CONTEXT_TTL_MS,
      newKeysRequiredForDiscovery: false,
      durableFundingLifecycleImplemented: true,
      executionAuthority: 'none_until_topology_specific_adapter_and_exact_economics_exist',
    });
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

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
      const batch = await discoverFundingRates(symbols);
      const notionalUsd = Math.max(1, Number(process.env.CRYPTOCRAWL_FUNDING_REFERENCE_NOTIONAL_USD || 250));
      const ttlMs = Math.max(5_000, Number(process.env.CRYPTOCRAWL_FUNDING_CANDIDATE_TTL_MS || 45_000));
      let projectedPositive = 0;
      let deterministicPositive = 0;

      for (const observation of batch.observations) {
        const spotFee = observation.venue === 'okx'
          ? await resolveCexFeeEvidence('okx', observation.symbol).catch(() => null)
          : null;
        const swapCapability = await getOkxSwapCapability(observation);

        // Public funding discovery establishes carry signal. It does not promote
        // execution until future close/basis risk, entry/exit depth, adapter
        // capability and terminal funding settlement are all measured.
        const decision = evaluateFundingArbitrage({
          fundingRate: observation.fundingRate,
          notionalUsd,
          spotEntryFeeBps: spotFee?.takerFeeBps ?? null,
          spotExitFeeBps: spotFee?.takerFeeBps ?? null,
          perpEntryFeeBps: swapCapability.feeBps,
          perpExitFeeBps: swapCapability.feeBps,
          entryBasisBps: observation.entryBasisBps,
          exitBasisReserveBps: null,
          expectedSlippageBps: null,
          borrowCostUsd: observation.fundingRate < 0 ? null : 0,
          fundingRateLocked: observation.fundingRateLocked,
          shortSpotCapability: false,
        });

        if (decision.projectedNetProfitUsd !== null && decision.projectedNetProfitUsd > 0) projectedPositive++;
        if (decision.deterministicPositive) deterministicPositive++;

        const missingInformation = [
          ...decision.missingInformation,
          'measured_entry_and_exit_depth',
          'measured_exit_basis_reserve',
          'funding_venue_lifecycle_adapter',
          'liquidation_margin_and_collateral_monitoring',
          'terminal_funding_payment_and_close_settlement',
          ...(observation.venue === 'kraken_futures' ? ['kraken_derivatives_execution_credentials'] : []),
          ...(observation.venue === 'binance_futures' ? ['binance_execution_capability_intentionally_disabled'] : []),
          ...(observation.venue === 'okx' && !swapCapability.instrumentVisible ? ['okx_swap_instrument_capability'] : []),
          ...(observation.venue === 'okx' && !swapCapability.accountModeVisible ? ['okx_derivatives_account_mode'] : []),
        ];

        const status = decision.deterministicPositive ? 'deterministic_positive' as const : 'enriched' as const;
        measuredCandidateRegistry.record({
          opportunityId: `funding:${observation.venue}:${observation.instrumentId}:${observation.symbol}`,
          topology: 'FUNDING_ARBITRAGE',
          observedAt: observation.observedAt,
          expiresAt: observation.observedAt + ttlMs,
          status,
          assets: quotedAsset(observation.symbol),
          venues: [observation.venue],
          chains: ['cex'],
          rawQuotes: [{
            source: `${observation.venue}:funding_rate`,
            venue: observation.venue,
            symbol: observation.symbol,
            observedAt: observation.observedAt,
            price: observation.perpReferencePrice,
            executable: false,
            provenance: [
              ...observation.provenance,
              `funding_rate:${observation.fundingRate}`,
              `funding_rate_kind:${observation.fundingRateKind}`,
              `funding_rate_locked:${observation.fundingRateLocked}`,
              ...(observation.nextFundingTime ? [`next_funding_time:${observation.nextFundingTime}`] : []),
            ],
          }],
          depth: { status: 'unavailable', detail: 'Funding discovery uses public ticker/funding snapshots; executable entry/exit depth is intentionally not inferred' },
          economics: {
            grossProfitUsd: decision.expectedFundingUsd,
            deterministicNetProfitUsd: decision.deterministicNetProfitUsd,
            feeUsd: decision.expectedTradingFeesUsd,
            gasUsd: 0,
            bridgeUsd: 0,
            expectedSlippageBps: null,
            expectedPriceImpactBps: null,
          },
          quoteAgeMs: Math.max(0, Date.now() - observation.observedAt),
          executableCapability: false,
          executionCapabilityReason: observation.venue === 'okx'
            ? swapCapability.reason
            : observation.venue === 'kraken_futures'
              ? 'Kraken Futures public funding is visible without authentication, but Kraken Spot credentials are not Derivatives execution credentials'
              : 'Binance Futures is public discovery only; Binance live execution remains intentionally disabled in CryptoCrawler',
          missingInformation,
          provenance: [
            ...observation.provenance,
            'funding_arbitrage_policy:all_in_costs_required',
            'durable_funding_lifecycle:implemented_migration_owned_nonblocking',
            'unknown_cost_is_not_zero',
            'execution_not_promoted_from_public_discovery',
          ],
        });
      }

      this.cycles++;
      this.lastCycleAt = Date.now();
      this.lastError = null;
      logger.info('[FundingMonitor] Funding discovery cycle completed', {
        component: 'FundingRateMonitor',
        requestedSymbols: batch.requestedSymbols,
        observations: batch.observations.length,
        failures: batch.failures,
        projectedPositive,
        deterministicPositive,
        eligible: 0,
        durableFundingLifecycleImplemented: true,
        okxSwapCapabilityCacheEntries: okxSwapCapabilityCache.size,
        note: 'Funding rate is carry, not instant spread; unknown exit/depth/adapter/liquidation evidence blocks execution',
      });
    } catch (error) {
      this.cycles++;
      this.lastCycleAt = Date.now();
      this.lastError = error instanceof Error ? error.message : String(error);
      logger.warn('[FundingMonitor] Funding discovery cycle degraded', {
        component: 'FundingRateMonitor',
        error: this.lastError,
      });
    }
  }
}

export const fundingRateMonitor = new FundingRateMonitor();