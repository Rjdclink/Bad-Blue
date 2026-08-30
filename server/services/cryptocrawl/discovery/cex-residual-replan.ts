import logger from '../../../logger.js';
import { getCryptara } from '../../cryptara/index.js';
import { arbitrageVerifier, type VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
import { getProfitLadderNotionalAuthority } from '../governance/profit-ladder-notional-authority.js';
import { ensureCryptaraAssessmentWiring } from '../integration/cryptara-assessment-wiring.js';
import { ensureCryptaraCexEvidenceWiring } from '../integration/cryptara-cex-evidence-wiring.js';
import { getBoundTechnicalEvidence } from '../integration/technical-evidence-synchronizer.js';
import { marketDataProviders } from '../intelligence/market-data-providers.js';
import { measuredCandidateRegistry } from './measured-candidate-registry.js';

const inFlight = new Map<string, Promise<void>>();

function opportunityId(plan: VerifiedArbitragePlan, requestedResidualUsd: number, observedAt: number): string {
  return `residual-${plan.buyVenue}-${plan.sellVenue}-${plan.symbol}-${requestedResidualUsd.toFixed(8)}-${observedAt}`;
}

function recordResidualCandidate(
  id: string,
  plan: VerifiedArbitragePlan,
  observedAt: number,
  maxQuoteAgeMs: number,
): void {
  measuredCandidateRegistry.record({
    opportunityId: id,
    topology: 'CEX_CEX',
    observedAt,
    expiresAt: observedAt + Math.max(1, maxQuoteAgeMs - Math.min(maxQuoteAgeMs, plan.quoteAgeMs)),
    status: 'deterministic_positive',
    assets: [plan.symbol],
    venues: [plan.buyVenue, plan.sellVenue],
    chains: ['cex'],
    rawQuotes: [
      {
        source: 'direct_exchange_quotes',
        venue: plan.buyVenue,
        symbol: plan.symbol,
        observedAt: observedAt - plan.quoteAgeMs,
        ask: plan.buyAsk,
        executable: true,
      },
      {
        source: 'direct_exchange_quotes',
        venue: plan.sellVenue,
        symbol: plan.symbol,
        observedAt: observedAt - plan.quoteAgeMs,
        bid: plan.sellBid,
        executable: true,
      },
    ],
    depth: {
      status: plan.liquidity.status === 'measured' ? 'measured' : 'unavailable',
      detail: plan.liquidity.status === 'measured'
        ? plan.liquidity.source.join(',')
        : 'Fresh residual measured executable depth unavailable',
    },
    economics: {
      grossProfitUsd: plan.grossProfitUsd,
      deterministicNetProfitUsd: plan.netProfitUsd,
      feeUsd: plan.costs.buyFeeUsd + plan.costs.sellFeeUsd,
      gasUsd: plan.costs.gasUsd,
      bridgeUsd: plan.costs.bridgeFeeUsd,
      expectedSlippageBps: plan.expectedSlippageBps ?? null,
      expectedPriceImpactBps: plan.expectedPriceImpactBps ?? null,
    },
    quoteAgeMs: plan.quoteAgeMs,
    executableCapability: true,
    executionCapabilityReason: 'Fresh residual CEX verification completed; Cryptara, Monte Carlo, governance, inventory, resources, product truth and final settlement still control execution',
    missingInformation: [],
    provenance: [
      'hyper_hybrid_residual_replan',
      'fresh_arbitrage_verifier',
      'authenticated_fee_evidence',
      'fresh_depth_evidence',
      'cryptara_reassessment_required',
      'direct_execution_authority:false',
      'synthetic_evidence:false',
    ],
  });
}

async function replanResidual(input: {
  symbol: string;
  remainingNotionalUsd: number;
  sourceParentNotionalUsd: number;
}): Promise<void> {
  const ladder = getProfitLadderNotionalAuthority();
  const requestedResidualUsd = Math.min(
    Math.max(0, input.remainingNotionalUsd),
    Math.max(0, ladder.maxNotionalUsd),
  );
  if (!(requestedResidualUsd > 0)) return;

  const maxQuoteAgeMs = Math.max(250, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000));
  const plan = await arbitrageVerifier.evaluateOnce({
    symbol: input.symbol,
    notionalUsd: requestedResidualUsd,
    maxQuoteAgeMs,
    gas: { enabled: false, chain: 'polygon' },
    bridge: { enabled: false, fromChain: 'polygon', toChain: 'polygon', token: 'USDC' },
  }).catch(error => {
    logger.warn('[CEX ResidualReplan] Fresh residual verification failed closed', {
      component: 'CexResidualReplan',
      symbol: input.symbol,
      requestedResidualUsd,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  if (!plan || !(plan.netProfitUsd > 0) || !(plan.notionalUsd > 0) || plan.notionalUsd > requestedResidualUsd + 1e-8) {
    logger.info('[CEX ResidualReplan] Residual is not currently independently profitable/executable', {
      component: 'CexResidualReplan',
      symbol: input.symbol,
      requestedResidualUsd,
      freshPlanAvailable: Boolean(plan),
      freshNetProfitUsd: plan?.netProfitUsd ?? null,
      directExecutionAuthority: false,
    });
    return;
  }

  ensureCryptaraAssessmentWiring();
  ensureCryptaraCexEvidenceWiring();
  const cryptara = getCryptara();
  if (!cryptara.getStatus().isRunning) await cryptara.initialize();

  const observedAt = Date.now();
  const id = opportunityId(plan, requestedResidualUsd, observedAt);
  recordResidualCandidate(id, plan, observedAt, maxQuoteAgeMs);

  const [universe, technicalEvidence] = await Promise.all([
    marketDataProviders.discoverUniverse(),
    getBoundTechnicalEvidence({
      opportunityId: id,
      symbol: plan.symbol,
      observedAt,
      maxAgeMs: Math.max(30_000, Number(process.env.TRADINGVIEW_DATA_TTL_MS || 300_000)),
    }),
  ]);
  const providerStatuses = marketDataProviders.getProviderStatuses();
  const assessment = await cryptara.assessOpportunity({
    opportunityId: id,
    observedAt,
    chain: 'cex',
    symbol: plan.symbol,
    plan,
    tradingView: technicalEvidence.analysis,
    mempool: alchemyIntegration.getMempoolAnalysis(),
    marketUniverse: universe,
    dexObservation: null,
    missingInformation: [
      ...technicalEvidence.missingInformation,
      ...providerStatuses
        .filter(status => status.state === 'failed' || status.state === 'stale' || status.state === 'unavailable')
        .map(status => `provider_${status.provider}_${status.state}`),
    ],
    provenance: [
      'hyper_hybrid_residual_replan',
      'fresh_arbitrage_verifier',
      'fresh_residual_economics',
      `source_parent_notional_usd:${input.sourceParentNotionalUsd}`,
      `requested_residual_notional_usd:${requestedResidualUsd}`,
      ...technicalEvidence.provenance,
      ...[...new Set(universe.flatMap(asset => asset.sources || [asset.source]))],
      ...providerStatuses.map(status => `provider:${status.provider}:${status.state}`),
      'direct_execution_authority:false',
    ],
  });

  if (assessment.recommendation === 'consider' && plan.netProfitUsd > 0) {
    measuredCandidateRegistry.updateStatus(id, 'eligible', {
      provenance: [
        ...technicalEvidence.provenance,
        'hyper_hybrid_residual_replan',
        'Cryptara:consider',
        'monte_carlo:approved_or_complete',
      ],
    });
    logger.info('[CEX ResidualReplan] Fresh residual returned to canonical eligible queue', {
      component: 'CexResidualReplan',
      opportunityId: id,
      symbol: plan.symbol,
      requestedResidualUsd,
      freshExecutableNotionalUsd: plan.notionalUsd,
      freshNetProfitUsd: plan.netProfitUsd,
      cryptaraRecommendation: assessment.recommendation,
      directExecutionAuthority: false,
    });
    return;
  }

  measuredCandidateRegistry.updateStatus(id, 'blocked', {
    missingInformation: assessment.missingInformation,
    provenance: [
      ...technicalEvidence.provenance,
      'hyper_hybrid_residual_replan',
      `Cryptara:${assessment.recommendation}`,
    ],
  });
}

/**
 * Queue one exact residual reassessment without extending settlement latency.
 * Duplicate same-symbol requests are coalesced while the current reassessment is
 * active. The request can create a newly eligible canonical candidate only after
 * fresh quotes/depth/fees plus Cryptara/Monte Carlo assessment. It never submits.
 */
export function queueCexResidualReplan(input: {
  symbol: string;
  remainingNotionalUsd: number;
  sourceParentNotionalUsd: number;
}): void {
  if (!(Number.isFinite(input.remainingNotionalUsd) && input.remainingNotionalUsd > 0)) return;
  const key = input.symbol.trim().toUpperCase();
  if (!key || inFlight.has(key)) return;

  const task = new Promise<void>(resolve => setImmediate(resolve))
    .then(() => replanResidual({ ...input, symbol: key }))
    .catch(error => {
      logger.error('[CEX ResidualReplan] Residual reassessment failed closed', {
        component: 'CexResidualReplan',
        symbol: key,
        remainingNotionalUsd: input.remainingNotionalUsd,
        error: error instanceof Error ? error.message : String(error),
        directExecutionAuthority: false,
      });
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, task);
}
