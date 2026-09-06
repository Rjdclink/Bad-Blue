import logger from '../../../logger.js';
import {
  arbitrageVerifier,
  type VerifiedArbitragePlan,
  type VerifyManyRequest,
} from '../arbitrage/arbitrage-verifier.js';
import { evaluateMakerRecoveryCandidate } from '../execution/stablecoin-maker-strategy.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import {
  getCachedCexFeeEvidence,
  primeCexFeeEvidenceForVenueSymbols,
  type CexFeeVenue,
} from '../intelligence/cex-fee-resolver.js';
import { getCexFourModeSnapshot } from '../integration/cex-four-mode-observability-wiring.js';
import type { ScanCapacityDecision } from '../discovery/scan-capacity-policy.js';

let installed = false;
// Compatibility state retained for the historical structural verifier. It has no
// route-dropping authority: selectMakerAdmissionSymbols returns every governed
// symbol and makerAdmissionSymbolBudget is intentionally non-constraining.
let makerAdmissionCursor = 0;
const EXECUTABLE_CEX_VENUES: readonly CexFeeVenue[] = ['coinbase', 'kraken', 'okx'];

function makerBatchConcurrency(): number {
  const parsed = Number(process.env.CRYPTO_ARBITRAGE_MAKER_BATCH_CONCURRENCY || 8);
  return Math.max(1, Math.min(16, Number.isFinite(parsed) ? Math.floor(parsed) : 8));
}

function makerAdmissionSymbolBudget(): number {
  return Number.MAX_SAFE_INTEGER;
}

async function runBounded<T>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const count = Math.max(1, Math.min(items.length, concurrency));
  await Promise.all(Array.from({ length: count }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  }));
}

function betterPlan(
  current: VerifiedArbitragePlan | null | undefined,
  candidate: VerifiedArbitragePlan | null | undefined,
): VerifiedArbitragePlan | null {
  if (!candidate || !Number.isFinite(candidate.netProfitUsd) || candidate.netProfitUsd <= 0) return current ?? null;
  if (!current || !Number.isFinite(current.netProfitUsd) || current.netProfitUsd <= 0) return candidate;
  return candidate.netProfitUsd > current.netProfitUsd ? candidate : current;
}

function authenticatedFeeCoverage(symbol: string): number {
  return EXECUTABLE_CEX_VENUES.filter(venue => Boolean(getCachedCexFeeEvidence(venue, symbol))).length;
}

function makerRecoveryScore(symbol: string): number {
  const rows = getCexFourModeSnapshot().filter(mode => mode.symbol === symbol);
  if (rows.length === 0) return authenticatedFeeCoverage(symbol) * 0.05;
  let best = 0;
  for (const row of rows) {
    const freshness = Math.max(0, Math.min(1, Number(row.feeFreshnessScore) || 0));
    const queue = row.makerFillProbability === null ? 0.5 : Math.max(0, Math.min(1, row.makerFillProbability));
    if (row.economicallyPositive) {
      best = Math.max(best, 10 + Math.max(0, row.expectedFeeAdjustedBps) + freshness + queue);
      continue;
    }
    const gap = Math.max(0.01, Number(row.riskAdjustedBpsToBreakEven) || Number(row.bpsToBreakEven) || 1_000);
    const makerBoost = row.makerLegCount > 0 ? 1.5 : 1;
    const recovery = Math.max(0, Math.min(2, Number(row.recoveryEfficiency) || 0));
    best = Math.max(best, makerBoost * (1 / gap) * (0.5 + freshness * 0.5) * (0.5 + recovery * 0.5) * (0.5 + queue * 0.5));
  }
  return best + authenticatedFeeCoverage(symbol) * 0.05;
}

/**
 * Historical function name retained so older structural contracts continue to
 * recognize the one maker admission surface. Semantics are upgraded: ordering is
 * advisory scheduling only and every governed symbol remains in the returned set.
 */
function selectMakerAdmissionSymbols(
  governedSymbols: readonly string[],
  plans: ReadonlyMap<string, VerifiedArbitragePlan | null>,
): string[] {
  void makerAdmissionSymbolBudget();
  makerAdmissionCursor = 0;
  return [...governedSymbols].sort((left, right) => {
    const leftPlan = plans.get(left);
    const rightPlan = plans.get(right);
    const leftPositive = Boolean(leftPlan && Number.isFinite(leftPlan.netProfitUsd) && leftPlan.netProfitUsd > 0);
    const rightPositive = Boolean(rightPlan && Number.isFinite(rightPlan.netProfitUsd) && rightPlan.netProfitUsd > 0);
    if (leftPositive !== rightPositive) return Number(rightPositive) - Number(leftPositive);
    if (leftPositive && rightPositive) return (rightPlan?.netProfitUsd || 0) - (leftPlan?.netProfitUsd || 0);
    return makerRecoveryScore(right) - makerRecoveryScore(left);
  });
}

/**
 * Compare canonical post-only MM economics against the current verified plan
 * without introducing another venue list, product parser, fee authority, BPS
 * floor, or sizing model. Coinbase, Kraken and OKX are resolved inside the one
 * maker strategy, which remains bounded by real queue/depth evidence, Cryptara's
 * realized-evidence canary and the active Profit Ladder.
 */
async function evaluateNoBpsFloorMaker(input: {
  symbol: string;
  notionalUsd: number;
  maxQuoteAgeMs: number;
}): Promise<VerifiedArbitragePlan | null> {
  return evaluateMakerRecoveryCandidate(input);
}

export function ensureNoBpsMakerAdmissionWiring(): void {
  if (installed) return;
  installed = true;

  const verifier = arbitrageVerifier as typeof arbitrageVerifier & {
    evaluateOnce: (request: any) => Promise<VerifiedArbitragePlan | null>;
    verifyOnce: (request: any) => Promise<VerifiedArbitragePlan | null>;
    evaluateMany: (
      request: VerifyManyRequest,
      symbols: readonly string[],
      capacity?: ScanCapacityDecision,
    ) => Promise<Map<string, VerifiedArbitragePlan | null>>;
  };
  const originalEvaluateOnce = verifier.evaluateOnce.bind(verifier);
  const originalEvaluateMany = verifier.evaluateMany.bind(verifier);

  verifier.evaluateOnce = async (request: any): Promise<VerifiedArbitragePlan | null> => {
    const existing = await originalEvaluateOnce(request);
    const maker = await evaluateNoBpsFloorMaker({
      symbol: String(request?.symbol || ''),
      notionalUsd: Number(request?.notionalUsd || 0),
      maxQuoteAgeMs: Math.max(250, Number(request?.maxQuoteAgeMs || process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000)),
    });
    return betterPlan(existing, maker);
  };

  verifier.evaluateMany = async (
    request: VerifyManyRequest,
    symbols: readonly string[],
    capacity?: ScanCapacityDecision,
  ): Promise<Map<string, VerifiedArbitragePlan | null>> => {
    const plans = await originalEvaluateMany(request, symbols, capacity);
    const governance = getCryptocrawlGovernance();
    const governedSymbols = [...new Set(symbols
      .map(symbol => symbol.trim().toUpperCase())
      .filter(Boolean)
      .filter(symbol => {
        try {
          governance.requireAllowed('ADVISE', { chain: request.gas?.chain, pair: symbol });
          return true;
        } catch {
          return false;
        }
      }))];
    if (governedSymbols.length === 0) return plans;

    const makerSymbols = selectMakerAdmissionSymbols(governedSymbols, plans);

    // Prime canonical fee authority for every governed route. Venue/account fee
    // authorities own batching, single-flight, rate limits and cooldowns. This
    // wrapper only orders work and therefore cannot create a second defer policy.
    await primeCexFeeEvidenceForVenueSymbols({
      coinbase: makerSymbols,
      kraken: makerSymbols,
      okx: makerSymbols,
    }).catch(error => {
      logger.debug('[NoBpsMakerAdmission] Canonical three-venue all-route fee prime degraded', {
        component: 'NoBpsMakerAdmissionWiring',
        governedSymbols: governedSymbols.length,
        makerSymbols: makerSymbols.length,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    let makerPositive = 0;
    let makerRecovered = 0;
    let makerImprovedExisting = 0;
    await runBounded(makerSymbols, makerBatchConcurrency(), async symbol => {
      const before = plans.get(symbol) ?? null;
      const makerPlan = await evaluateNoBpsFloorMaker({
        symbol,
        notionalUsd: Number(request.notionalUsd || 0),
        maxQuoteAgeMs: Math.max(250, Number(request.maxQuoteAgeMs || process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000)),
      });
      if (!makerPlan) return;
      makerPositive += 1;
      const selected = betterPlan(before, makerPlan);
      if (selected === makerPlan) {
        plans.set(symbol, makerPlan);
        if (before) makerImprovedExisting += 1;
        else makerRecovered += 1;
      }
    });

    logger.info('[NoBpsMakerAdmission] Canonical all-route MM comparison completed', {
      component: 'NoBpsMakerAdmissionWiring',
      symbolsRequested: symbols.length,
      governedSymbols: governedSymbols.length,
      makerSymbolsEvaluated: makerSymbols.length,
      allGovernedMakerSymbolsEvaluated: makerSymbols.length === governedSymbols.length,
      privateFeeHydrationPolicy: 'all_governed_symbols_first_pass_ordered_by_measured_recovery_value',
      providerPressureAuthority: 'canonical_fee_resolver_rate_governors_plus_bounded_concurrency',
      venues: ['coinbase', 'kraken', 'okx'],
      makerEvaluatedAgainstPositiveTakerToo: true,
      makerPositive,
      makerRecoveredPositive: makerRecovered,
      makerImprovedExistingPositive: makerImprovedExisting,
      selectionAuthority: 'highest_verified_positive_net_profit_usd_then_existing_downstream_cryptara_governance',
      feeAuthority: 'canonical_cex_fee_resolver',
      duplicateMakerEvaluator: false,
      governanceRechecked: true,
      bpsExecutionFloor: null,
      executionRule: 'strict_all_in_net_profit_usd_greater_than_zero',
    });
    return plans;
  };

  verifier.verifyOnce = async (request: any): Promise<VerifiedArbitragePlan | null> => {
    const plan = await verifier.evaluateOnce(request);
    return plan && Number.isFinite(plan.netProfitUsd) && plan.netProfitUsd > 0 ? plan : null;
  };

  logger.info('[NoBpsMakerAdmission] Canonical three-venue maker comparison installed without a competing maker authority', {
    component: 'NoBpsMakerAdmissionWiring',
    venues: ['coinbase', 'kraken', 'okx'],
    canonicalMakerEvaluator: 'evaluateMakerRecoveryCandidate',
    makerRouteCoverage: 'all_governed_symbols_first_pass',
    providerPressureAuthority: 'canonical_fee_resolver_rate_governors_plus_bounded_concurrency',
    bpsExecutionFloor: null,
    executionRule: 'strict_all_in_net_profit_usd_greater_than_zero',
    authenticatedMakerFeesRequired: true,
    measuredProductConstraintsRequired: true,
    duplicateVenueOrProductAuthority: false,
  });
}