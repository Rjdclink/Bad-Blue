import logger from '../../../logger.js';
import { getCryptara } from '../../cryptara/index.js';
import type { CryptaraOpportunityAssessment, CryptaraOpportunityContext } from '../../cryptara/index.js';
import { arbitrageVerifier, type VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { normalizeCexExecutablePlan } from '../execution/cex-spot-product-policy.js';
import { evaluateStablecoinMakerCandidate, isStablecoinMakerPlan } from '../execution/stablecoin-maker-strategy.js';
import { stageManager } from '../governance/stage-management.js';
import { ensureCoinCapEnvironmentWiring } from './coincap-environment-wiring.js';
import { ensureDynamicRpcProviderWiring } from './dynamic-rpc-provider-wiring.js';
import { ensureStablecoinMakerExecutionWiring } from './stablecoin-maker-execution-wiring.js';

let installed = false;

function makerCanaryMinimumProbability(): number {
  const configured = Number(process.env.CRYPTO_ARBITRAGE_MAKER_CANARY_MIN_PROBABILITY || 0.80);
  const value = Number.isFinite(configured) ? configured : 0.80;
  return Math.max(0.75, Math.min(0.95, value));
}

function criticalMissingInformation(items: readonly string[], makerCanary = false): string[] {
  return [...new Set(items)].filter(item =>
    !item.startsWith('optional:')
    && !item.startsWith('optional_missing:')
    && !item.startsWith('not_applicable:')
    && !(makerCanary && (item === 'runtime_confidence_bootstrap' || item === 'posttrade_calibration_pending')),
  );
}

function normalizeCoinbaseCredentialAliases(): void {
  if (!process.env.COINBASE_API_SECRET?.trim() && process.env.COINBASE_SECRET_KEY?.trim()) {
    process.env.COINBASE_API_SECRET = process.env.COINBASE_SECRET_KEY;
    logger.info('[PositiveProfitCapture] Normalized Railway Coinbase secret-key alias', {
      component: 'PositiveProfitCapture',
      sourceAlias: 'COINBASE_SECRET_KEY',
      canonicalAlias: 'COINBASE_API_SECRET',
      secretValueLogged: false,
    });
  }
}

function enforceAuthenticatedKrakenFeeAuthority(): void {
  const authenticated = Boolean(
    process.env.KRAKEN_API_KEY?.trim()
    && process.env.KRAKEN_API_SECRET?.trim(),
  );
  if (!authenticated || !process.env.CRYPTO_ARBITRAGE_KRAKEN_TAKER_FEE_BPS?.trim()) return;

  delete process.env.CRYPTO_ARBITRAGE_KRAKEN_TAKER_FEE_BPS;
  logger.info('[PositiveProfitCapture] Retired Kraken compatibility taker fee in favor of authenticated TradeVolume evidence', {
    component: 'PositiveProfitCapture',
    authenticatedKrakenFeeAuthority: true,
    requestLevelFeeOverridesRetained: true,
    compatibilityFallbackWhenCredentialsAbsent: true,
  });
}

function normalizePositiveAssessment(
  context: CryptaraOpportunityContext,
  assessment: CryptaraOpportunityAssessment,
): CryptaraOpportunityAssessment {
  const plan = context.plan;
  if (!plan || !Number.isFinite(plan.netProfitUsd) || plan.netProfitUsd <= 0) return assessment;

  const makerCanary = isStablecoinMakerPlan(plan);
  const criticalMissing = criticalMissingInformation(assessment.missingInformation, makerCanary);
  if (criticalMissing.length > 0 || !assessment.monteCarlo) {
    assessment.recommendation = 'observe';
    assessment.provenance = [...new Set([
      ...assessment.provenance,
      'positive_profit_capture:critical_evidence_still_required',
      'rank_non_authoritative_for_execution',
    ])];
    return assessment;
  }

  const minimumProbability = makerCanary ? makerCanaryMinimumProbability() : 0.60;
  if (!Number.isFinite(assessment.monteCarlo.probabilityOfProfit) || assessment.monteCarlo.probabilityOfProfit < minimumProbability) {
    assessment.recommendation = 'reject';
    assessment.provenance = [...new Set([
      ...assessment.provenance,
      makerCanary ? 'positive_profit_capture:maker_canary_hyper_mc_rejected' : 'positive_profit_capture:mc_risk_gate_retained',
      'rank_non_authoritative_for_execution',
    ])];
    return assessment;
  }

  assessment.recommendation = 'consider';
  assessment.provenance = [...new Set([
    ...assessment.provenance,
    makerCanary
      ? 'positive_profit_capture:stablecoin_maker_canary_hyper_mc_qualified'
      : 'positive_profit_capture:any_verified_net_gt_zero',
    ...(makerCanary ? ['maker_canary_bootstrap:post_only_cancel_only'] : []),
    'rank_diagnostic_only',
  ])];
  return assessment;
}

export function ensurePositiveProfitCaptureWiring(): void {
  if (installed) return;
  installed = true;
  normalizeCoinbaseCredentialAliases();
  ensureCoinCapEnvironmentWiring();
  enforceAuthenticatedKrakenFeeAuthority();
  ensureDynamicRpcProviderWiring();
  ensureStablecoinMakerExecutionWiring();

  const verifier = arbitrageVerifier as typeof arbitrageVerifier & {
    verifyOnce: (request: any) => Promise<VerifiedArbitragePlan | null>;
    evaluateOnce: (request: any) => Promise<VerifiedArbitragePlan | null>;
  };
  const originalEvaluateOnce = verifier.evaluateOnce.bind(verifier);
  verifier.evaluateOnce = async (request: any): Promise<VerifiedArbitragePlan | null> => {
    const takerPlan = await originalEvaluateOnce(request);
    if (takerPlan) return normalizeCexExecutablePlan(takerPlan);

    return evaluateStablecoinMakerCandidate({
      symbol: String(request?.symbol || ''),
      notionalUsd: Number(request?.notionalUsd || 0),
      maxQuoteAgeMs: Math.max(1, Number(request?.maxQuoteAgeMs || process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5000)),
    });
  };
  verifier.verifyOnce = async (request: any): Promise<VerifiedArbitragePlan | null> => {
    const plan = await verifier.evaluateOnce(request);
    return plan && Number.isFinite(plan.netProfitUsd) && plan.netProfitUsd > 0 ? plan : null;
  };

  const stageRuntime = stageManager as typeof stageManager & { getMaxDailyProfit: () => number };
  stageRuntime.getMaxDailyProfit = () => Number.POSITIVE_INFINITY;

  const cryptara = getCryptara() as ReturnType<typeof getCryptara> & {
    getAutonomousDirective: () => ReturnType<ReturnType<typeof getCryptara>['getAutonomousDirective']>;
    recordOpportunityObservation: (context: CryptaraOpportunityContext) => CryptaraOpportunityAssessment;
  };

  const originalDirective = cryptara.getAutonomousDirective.bind(cryptara);
  cryptara.getAutonomousDirective = () => ({
    ...originalDirective(),
    minimumNetProfitUsd: 0,
  });

  const originalObservation = cryptara.recordOpportunityObservation.bind(cryptara);
  cryptara.recordOpportunityObservation = (context: CryptaraOpportunityContext): CryptaraOpportunityAssessment => {
    const assessment = originalObservation(context);
    return normalizePositiveAssessment(context, assessment);
  };

  logger.info('[PositiveProfitCapture] Positive-edge routing installed with stablecoin maker recovery', {
    component: 'PositiveProfitCapture',
    deterministicNetProfitRule: 'strictly_greater_than_zero',
    arbitraryMinimumProfitUsd: false,
    maximumDailyProfitExecutionStop: false,
    rankScoreExecutionGate: false,
    authenticatedKrakenFeeAuthority: Boolean(process.env.KRAKEN_API_KEY?.trim() && process.env.KRAKEN_API_SECRET?.trim()),
    paidCoinCapEnvironmentResolution: true,
    dynamicRpcProviderAdmission: true,
    stablecoinMakerRecovery: {
      enabled: true,
      venues: ['kraken', 'okx'],
      postOnly: true,
      takerFallback: false,
      canaryMaxUsd: 5_000,
      maxTtlMs: 30_000,
      cryptaraHyperMonteCarloRequired: true,
      coldStartCanaryMinimumProbability: makerCanaryMinimumProbability(),
    },
    cexProductConstraintsBeforeEligibility: ['coinbase', 'kraken', 'okx'],
    retainedAuthorities: [
      'deterministic_all_in_economics',
      'measured_product_constraints',
      'cryptara_parallel_hyper_monte_carlo',
      'governance_stage',
      'risk_circuit_breakers',
      'position_size',
      'inventory_resource_leases',
      'quote_freshness',
      'settlement',
    ],
  });
}
