import logger from '../../../logger.js';
import { getCryptara } from '../../cryptara/index.js';
import type { CryptaraOpportunityAssessment, CryptaraOpportunityContext } from '../../cryptara/index.js';
import { arbitrageVerifier, type VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { normalizeCexExecutablePlan } from '../execution/cex-spot-product-policy.js';
import {
  evaluateMakerRecoveryCandidate,
  getDynamicMakerCanaryStatus,
  isMakerRecoveryPlan,
} from '../execution/stablecoin-maker-strategy.js';
import { stageManager } from '../governance/stage-management.js';
import { computeAriesExpectedValueOfInformation, rankAriesBeam } from '../intelligence/aries-vault.js';
import { ensureCoinCapEnvironmentWiring } from './coincap-environment-wiring.js';
import { ensureDynamicRpcProviderWiring } from './dynamic-rpc-provider-wiring.js';
import { isHybridCexRecoveryPlan } from './hybrid-cex-execution-wiring.js';
import { ensureStablecoinMakerExecutionWiring } from './stablecoin-maker-execution-wiring.js';

let installed = false;

function finiteBoundedEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, value));
}

function makerCanaryMinimumProbability(): number {
  return finiteBoundedEnv('CRYPTO_ARBITRAGE_MAKER_CANARY_MIN_PROBABILITY', 0.80, 0.75, 0.95);
}

function criticalMissingInformation(items: readonly string[], makerCanary = false): string[] {
  return [...new Set(items)].filter(item =>
    !item.startsWith('optional:')
    && !item.startsWith('optional_missing:')
    && !item.startsWith('not_applicable:')
    && !(makerCanary && (item === 'runtime_confidence_bootstrap' || item === 'posttrade_calibration_pending')),
  );
}

function normalizedEnvValue(raw: string | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) value = value.slice(1, -1).trim();
  }
  return value || null;
}

function normalizeCoinbaseCredentialAliases(): void {
  const canonicalSecret = normalizedEnvValue(process.env.COINBASE_API_SECRET);
  const secretAlias = normalizedEnvValue(process.env.COINBASE_SECRET_KEY);
  if (canonicalSecret) process.env.COINBASE_API_SECRET = canonicalSecret;
  else if (secretAlias) {
    process.env.COINBASE_API_SECRET = secretAlias;
    logger.info('[PositiveProfitCapture] Normalized Railway Coinbase secret-key alias', {
      component: 'PositiveProfitCapture',
      sourceAlias: 'COINBASE_SECRET_KEY',
      canonicalAlias: 'COINBASE_API_SECRET',
      secretValueLogged: false,
    });
  }

  const keyName = normalizedEnvValue(process.env.COINBASE_KEY_NAME);
  if (keyName) process.env.COINBASE_KEY_NAME = keyName;
  const genericKey = normalizedEnvValue(process.env.COINBASE_API_KEY);
  if (genericKey) process.env.COINBASE_API_KEY = genericKey;
}

function normalizeZeroXCredentialAliases(): void {
  const canonical = normalizedEnvValue(process.env.ZEROX_API_KEY);
  if (canonical) {
    process.env.ZEROX_API_KEY = canonical;
    return;
  }
  const aliases = ['0X_API_KEY', 'OX_API_KEY', 'ZERO_X_API_KEY', 'ZEROX_KEY', 'ZERO_X_KEY', '0X_KEY'] as const;
  const source = aliases.find(alias => normalizedEnvValue(process.env[alias]));
  if (!source) return;
  process.env.ZEROX_API_KEY = normalizedEnvValue(process.env[source]) || undefined;
  logger.info('[PositiveProfitCapture] Normalized Railway 0x API-key alias', {
    component: 'PositiveProfitCapture',
    sourceAlias: source,
    canonicalAlias: 'ZEROX_API_KEY',
    secretValueLogged: false,
  });
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

function normalizeProbability(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : null;
}

/**
 * Aries is wired into every measured Cryptara opportunity as a horizon advisory.
 * It deliberately cannot change the existing recommendation here: the existing
 * deterministic economics, Hyper MC and governance remain execution authority.
 * This gives Aries live measured inputs and observable output without creating a
 * new regression-capable bypass while calibration evidence accumulates.
 */
function annotateAriesHorizonAdvisory(
  context: CryptaraOpportunityContext,
  assessment: CryptaraOpportunityAssessment,
): CryptaraOpportunityAssessment {
  const plan = context.plan;
  if (!plan || !(plan.notionalUsd > 0) || !Number.isFinite(plan.netProfitUsd)) return assessment;

  const netBps = plan.netProfitUsd / plan.notionalUsd * 10_000;
  const probability = normalizeProbability(assessment.monteCarlo?.probabilityOfProfit)
    ?? normalizeProbability(assessment.probabilityOfProfitableExecution)
    ?? 0;
  const expectedProfitUsd = plan.netProfitUsd * probability;
  const uncertaintyUsd = Math.abs(plan.netProfitUsd) * (1 - probability);
  const expectedRealizedBps = netBps * probability;
  const beam = rankAriesBeam([
    {
      id: 'execute_measured_plan',
      expectedRealizedBps,
      expectedProfitUsd,
      uncertaintyUsd,
    },
    {
      id: 'hold_capital',
      expectedRealizedBps: 0,
      expectedProfitUsd: 0,
      uncertaintyUsd: 0,
    },
  ], 1)[0];
  const valueOfInformationBps = computeAriesExpectedValueOfInformation(
    expectedRealizedBps,
    Math.max(0, netBps),
    1 - probability,
  );

  assessment.provenance = [...new Set([
    ...assessment.provenance,
    'aries_vault:horizon_advisory_live',
    `aries_vault:beam_preference:${beam?.id || 'hold_capital'}`,
    `aries_vault:expected_realized_bps:${expectedRealizedBps.toFixed(4)}`,
    `aries_vault:value_of_information_bps:${valueOfInformationBps.toFixed(4)}`,
    'aries_vault:execution_authority:false',
  ])];
  return assessment;
}

function normalizePositiveAssessment(
  context: CryptaraOpportunityContext,
  assessment: CryptaraOpportunityAssessment,
): CryptaraOpportunityAssessment {
  const plan = context.plan;
  if (!plan || !Number.isFinite(plan.netProfitUsd) || plan.netProfitUsd <= 0) return assessment;

  const makerPlan = isMakerRecoveryPlan(plan) ? plan : null;
  const hybridPlan = isHybridCexRecoveryPlan(plan) ? plan : null;
  const makerCanary = makerPlan !== null || hybridPlan !== null;
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
    makerPlan
      ? `positive_profit_capture:${makerPlan.makerExecution.strategy}:hyper_mc_qualified`
      : hybridPlan
        ? `positive_profit_capture:hybrid_${hybridPlan.hybridExecution.mode.toLowerCase()}:hyper_mc_qualified`
        : 'positive_profit_capture:any_verified_net_gt_zero',
    ...(makerPlan ? ['maker_canary_bootstrap:post_only_cancel_only'] : []),
    ...(hybridPlan ? ['hybrid_maker_canary:maker_first_fresh_taker_requote'] : []),
    'rank_diagnostic_only',
  ])];
  return assessment;
}

export function ensurePositiveProfitCaptureWiring(): void {
  if (installed) return;
  installed = true;
  normalizeCoinbaseCredentialAliases();
  normalizeZeroXCredentialAliases();
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

    return evaluateMakerRecoveryCandidate({
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
    const normalized = normalizePositiveAssessment(context, assessment);
    return annotateAriesHorizonAdvisory(context, normalized);
  };

  const makerCanary = getDynamicMakerCanaryStatus();
  logger.info('[PositiveProfitCapture] Positive-edge routing installed with dynamic maker recovery', {
    component: 'PositiveProfitCapture',
    deterministicNetProfitRule: 'strictly_greater_than_zero',
    arbitraryMinimumProfitUsd: false,
    maximumDailyProfitExecutionStop: false,
    rankScoreExecutionGate: false,
    authenticatedKrakenFeeAuthority: Boolean(process.env.KRAKEN_API_KEY?.trim() && process.env.KRAKEN_API_SECRET?.trim()),
    zeroXApiKeyVisible: Boolean(process.env.ZEROX_API_KEY?.trim()),
    paidCoinCapEnvironmentResolution: true,
    dynamicRpcProviderAdmission: true,
    ariesVault: {
      horizonAdvisoryLive: true,
      beamPreference: 'expected_profit_minus_uncertainty_vs_hold',
      expectedValueOfInformation: true,
      executionAuthority: false,
    },
    makerRecovery: {
      enabled: true,
      venues: ['kraken', 'okx'],
      pairClasses: ['stablecoin', 'volatile_high_spread'],
      postOnly: true,
      takerFallback: false,
      bootstrapCanaryUsd: finiteBoundedEnv('CRYPTO_ARBITRAGE_MAKER_CANARY_BOOTSTRAP_USD', 1, 1, 100),
      currentCanaryCeilingUsd: makerCanary.ceilingUsd,
      makerProofSamples: makerCanary.samples,
      makerProofWins: makerCanary.wins,
      makerProofWinRate: makerCanary.winRate,
      makerConfidenceScore: makerCanary.confidenceScore,
      sizingAuthority: makerCanary.sizingAuthority,
      hardMaxCanaryUsd: finiteBoundedEnv('CRYPTO_ARBITRAGE_MAKER_CANARY_MAX_USD', 1_000_000, 1, 1_000_000),
      sizingCurve: 'continuous_cryptara_realized_evidence',
      volatileMinGrossSpreadBps: finiteBoundedEnv('CRYPTO_ARBITRAGE_VOLATILE_MAKER_MIN_GROSS_SPREAD_BPS', 70, 10, 2_000),
      maxTtlMs: 30_000,
      cryptaraMonteCarloRequired: true,
      monteCarloDepth: 'opportunity_adaptive_early_stop',
      coldStartCanaryMinimumProbability: makerCanaryMinimumProbability(),
    },
    hybridMakerRecovery: {
      enabled: true,
      modes: ['MT', 'TM'],
      canaryMinimumProbability: makerCanaryMinimumProbability(),
      executionAuthority: 'canonical_hybrid_wiring_only',
      riskGateWeakened: false,
    },
    cexProductConstraintsBeforeEligibility: ['coinbase', 'kraken', 'okx'],
    retainedAuthorities: [
      'deterministic_all_in_economics',
      'authenticated_maker_fee_evidence',
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
