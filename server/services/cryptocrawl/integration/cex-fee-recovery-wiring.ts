import logger from '../../../logger.js';
import {
  getCexFeeRecoverySnapshot,
  refreshCexFeeRecoveryEvidence,
} from '../intelligence/cex-fee-recovery-authority.js';

let installed = false;
let timer: NodeJS.Timeout | null = null;
let refreshInFlight: Promise<void> | null = null;
let lastRefreshAttemptAt = 0;
let lastRefreshSuccessAt = 0;
let lastError: string | null = null;

function refreshIntervalMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_CEX_FEE_RECOVERY_REFRESH_MS || 60_000);
  return Number.isFinite(parsed) ? Math.max(15_000, Math.min(15 * 60_000, Math.trunc(parsed))) : 60_000;
}

async function refreshOnce(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    lastRefreshAttemptAt = Date.now();
    try {
      await refreshCexFeeRecoveryEvidence();
      lastRefreshSuccessAt = Date.now();
      lastError = null;
      const snapshot = getCexFeeRecoverySnapshot();
      logger.info('[CEX Fee Recovery] Existing-account fee recovery evidence observed', {
        component: 'CexFeeRecoveryWiring',
        receivedRecoveryUsd: snapshot.receivedRecoveryUsd,
        receivedRecoveryRows: snapshot.received.length,
        coinbaseReceivedRecoveryUsd: snapshot.coinbaseReceivedRecoveryUsd,
        coinbaseMonthToDateRecoveryUsd: snapshot.coinbaseMonthToDateRecoveryUsd,
        coinbaseAppReadReady: snapshot.coinbase.appReadReady,
        coinbaseOneObservedThisMonth: snapshot.coinbase.coinbaseOneObservedThisMonth,
        coinbasePublic25PercentReferenceCanCreateProfitability: snapshot.coinbasePublic25PercentReferenceCanCreateProfitability,
        coinbaseMembershipOrCapInferred: snapshot.coinbaseMembershipOrCapInferred,
        krakenKfeeAvailableFeeOffsetUsd: snapshot.krakenKfee?.availableFeeOffsetUsd ?? null,
        krakenKfeePreTradeEconomicAuthority: snapshot.preTradeKfeeCreditAllowed,
        futureOrConfiguredRecoveryCanCreateProfitability: snapshot.futureOrConfiguredRecoveryCanCreateProfitability,
        programCount: snapshot.programCatalog.length,
        newTradingApiKeyRequired: false,
        canonicalEmbeddedFeeAuthority: snapshot.canonicalEmbeddedFeeAuthority,
        executionAuthority: snapshot.executionAuthority,
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logger.debug('[CEX Fee Recovery] Recovery observation deferred without altering executable economics', {
        component: 'CexFeeRecoveryWiring',
        error: lastError,
        canonicalFeeEvidenceRemainsAuthoritative: true,
        coinbaseFutureRebatePrecredited: false,
        stablecoinParAssumptionAllowed: false,
        executionAuthority: false,
      });
    }
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

function scheduleNext(): void {
  if (process.env.NO_INTERVALS === 'true' || timer) return;
  timer = setTimeout(async () => {
    timer = null;
    await refreshOnce();
    scheduleNext();
  }, refreshIntervalMs());
  timer.unref?.();
}

export function ensureCexFeeRecoveryWiring(): void {
  if (installed) return;
  installed = true;
  void refreshOnce().finally(scheduleNext);
  logger.info('[CEX Fee Recovery] Received-only recovery observer installed', {
    component: 'CexFeeRecoveryWiring',
    refreshIntervalMs: refreshIntervalMs(),
    existingCoinbaseKrakenOkxCredentialsOnly: true,
    additionalTradingApiKeysRequired: false,
    zeroOrNegativeMakerRatesRemainInCanonicalFeeResolver: true,
    receivedCoinbaseOneRebateCreditsObservedWhenAppApiEligible: true,
    receivedCoinbaseExplicitFeeIncentivesObservedWhenUnambiguous: true,
    coinbaseAdvancedVipReducedRatesRemainInAuthenticatedFeeTier: true,
    receivedOkxRebateCardCreditsObserved: true,
    krakenKfeeAvailabilityObserved: true,
    unreceivedCoinbaseOneOrTradebackPrecredited: false,
    executionAuthority: false,
  });
}

export function getCexFeeRecoveryWiringStatus() {
  return {
    installed,
    refreshInFlight: Boolean(refreshInFlight),
    lastRefreshAttemptAt,
    lastRefreshSuccessAt,
    lastError,
    refreshIntervalMs: refreshIntervalMs(),
    recovery: getCexFeeRecoverySnapshot(),
  };
}
