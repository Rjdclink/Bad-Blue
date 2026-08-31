import logger from '../../../logger.js';
import {
  arbitrageVerifier,
  type VerifiedArbitragePlan,
  type VerifyManyRequest,
} from '../arbitrage/arbitrage-verifier.js';
import { evaluateMakerRecoveryCandidate } from '../execution/stablecoin-maker-strategy.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { primeCexFeeEvidenceForVenueSymbols } from '../intelligence/cex-fee-resolver.js';
import type { ScanCapacityDecision } from '../discovery/scan-capacity-policy.js';

let installed = false;

function makerBatchConcurrency(): number {
  const parsed = Number(process.env.CRYPTO_ARBITRAGE_MAKER_BATCH_CONCURRENCY || 8);
  return Math.max(1, Math.min(16, Number.isFinite(parsed) ? Math.floor(parsed) : 8));
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

    // Prime the single authenticated fee authority once for all three executable
    // venues before parallel maker comparison. The canonical maker evaluator then
    // consumes the same cache instead of creating a second private-fee path.
    await primeCexFeeEvidenceForVenueSymbols({
      coinbase: governedSymbols,
      kraken: governedSymbols,
      okx: governedSymbols,
    }).catch(error => {
      logger.debug('[NoBpsMakerAdmission] Canonical three-venue fee prime degraded', {
        component: 'NoBpsMakerAdmissionWiring',
        symbols: governedSymbols.length,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    let makerPositive = 0;
    let makerRecovered = 0;
    let makerImprovedExisting = 0;
    await runBounded(governedSymbols, makerBatchConcurrency(), async symbol => {
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

    logger.info('[NoBpsMakerAdmission] Canonical MM comparison completed', {
      component: 'NoBpsMakerAdmissionWiring',
      symbolsRequested: symbols.length,
      governedSymbols: governedSymbols.length,
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
