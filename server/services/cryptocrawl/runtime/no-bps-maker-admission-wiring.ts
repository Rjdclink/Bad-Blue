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
let makerAdmissionCursor = 0;
const EXECUTABLE_CEX_VENUES: readonly CexFeeVenue[] = ['coinbase', 'kraken', 'okx'];

function makerBatchConcurrency(): number {
  const parsed = Number(process.env.CRYPTO_ARBITRAGE_MAKER_BATCH_CONCURRENCY || 8);
  return Math.max(1, Math.min(16, Number.isFinite(parsed) ? Math.floor(parsed) : 8));
}

function makerAdmissionSymbolBudget(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_MAKER_ADMISSION_SYMBOLS || 24);
  return Math.max(8, Math.min(48, Number.isFinite(parsed) ? Math.floor(parsed) : 24));
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
 * Bound private maker-fee work by measured recovery value while reserving a
 * rotating exploration slice. Existing positive taker plans are always included
 * first so the maker path can still improve verified profitable execution.
 */
function selectMakerAdmissionSymbols(
  governedSymbols: readonly string[],
  plans: ReadonlyMap<string, VerifiedArbitragePlan | null>,
): string[] {
  const budget = Math.min(governedSymbols.length, makerAdmissionSymbolBudget());
  if (budget >= governedSymbols.length) return [...governedSymbols];

  const selected = new Set<string>();
  const positives = governedSymbols
    .filter(symbol => {
      const plan = plans.get(symbol);
      return Boolean(plan && Number.isFinite(plan.netProfitUsd) && plan.netProfitUsd > 0);
    })
    .sort((a, b) => (plans.get(b)?.netProfitUsd || 0) - (plans.get(a)?.netProfitUsd || 0));
  for (const symbol of positives) {
    if (selected.size >= budget) break;
    selected.add(symbol);
  }

  const remaining = governedSymbols
    .filter(symbol => !selected.has(symbol))
    .sort((a, b) => makerRecoveryScore(b) - makerRecoveryScore(a));
  const available = budget - selected.size;
  const explorationSlots = Math.min(available, Math.max(1, Math.floor(budget * 0.25)));
  const economicSlots = Math.max(0, available - explorationSlots);
  for (const symbol of remaining.slice(0, economicSlots)) selected.add(symbol);

  const explorationPool = remaining.filter(symbol => !selected.has(symbol));
  if (explorationPool.length > 0 && explorationSlots > 0) {
    const start = makerAdmissionCursor % explorationPool.length;
    for (let offset = 0; offset < Math.min(explorationSlots, explorationPool.length); offset++) {
      selected.add(explorationPool[(start + offset) % explorationPool.length]);
    }
    makerAdmissionCursor = (start + Math.max(1, explorationSlots)) % explorationPool.length;
  }

  for (const symbol of remaining) {
    if (selected.size >= budget) break;
    selected.add(symbol);
  }
  return [...selected];
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

    // Prime the one authenticated fee authority only for the bounded measured
    // recovery set. Public discovery remains broad and a rotating exploration
    // share prevents permanent exclusion from maker evaluation.
    await primeCexFeeEvidenceForVenueSymbols({
      coinbase: makerSymbols,
      kraken: makerSymbols,
      okx: makerSymbols,
    }).catch(error => {
      logger.debug('[NoBpsMakerAdmission] Bounded canonical three-venue fee prime degraded', {
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

    logger.info('[NoBpsMakerAdmission] Canonical bounded MM comparison completed', {
      component: 'NoBpsMakerAdmissionWiring',
      symbolsRequested: symbols.length,
      governedSymbols: governedSymbols.length,
      makerSymbolsEvaluated: makerSymbols.length,
      privateFeeHydrationPolicy: 'measured_recovery_priority_plus_rotating_exploration',
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
    bpsExecutionFloor: null,
    executionRule: 'strict_all_in_net_profit_usd_greater_than_zero',
    authenticatedMakerFeesRequired: true,
    measuredProductConstraintsRequired: true,
    duplicateVenueOrProductAuthority: false,
  });
}
