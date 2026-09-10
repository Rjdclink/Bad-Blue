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
const advisoryInFlight = new Set<string>();

function opportunityId(plan: VerifiedArbitragePlan, requestedResidualUsd: number, observedAt: number): string {
  return `residual-${plan.buyVenue}-${plan.sellVenue}-${plan.symbol}-${requestedResidualUsd.toFixed(8)}-${observedAt}`;
}

function usdToBps(valueUsd: number, notionalUsd: number): number | null {
  if (!Number.isFinite(valueUsd) || !Number.isFinite(notionalUsd) || notionalUsd <= 0) return null;
  return valueUsd / notionalUsd * 10_000;
}

function recordResidualCandidate(
  id: string,
  plan: VerifiedArbitragePlan,
  observedAt: number,
  maxQuoteAgeMs: number,
): void {
  const measuredDepth = plan.liquidity.status === 'measured';
  const grossProfitBps = usdToBps(plan.grossProfitUsd, plan.notionalUsd);
  const netProfitBps = usdToBps(plan.netProfitUsd, plan.notionalUsd);
  const allInCostBps = usdToBps(plan.costs.totalCostsUsd, plan.notionalUsd);
  measuredCandidateRegistry.record({
    opportunityId: id,
    topology: 'CEX_CEX',
    observedAt,
    expiresAt: observedAt + Math.max(1, maxQuoteAgeMs - Math.min(maxQuoteAgeMs, plan.quoteAgeMs)),
    status: measuredDepth ? 'eligible' : 'deterministic_positive',
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
      status: measuredDepth ? 'measured' : 'unavailable',
      detail: measuredDepth
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
      notionalUsd: plan.notionalUsd,
      grossProfitBps,
      allInCostBps,
      breakEvenBps: allInCostBps,
      netProfitBps,
      bpsToBreakEven: netProfitBps === null ? null : Math.max(0, -netProfitBps),
    },
    quoteAgeMs: plan.quoteAgeMs,
    executableCapability: true,
    executionCapabilityReason: measuredDepth
      ? 'Fresh residual CEX verification has positive all-in economics and measured executable depth; advisory systems cannot veto canonical eligibility'
      : 'Fresh residual CEX economics are positive but measured executable depth remains unavailable',
    missingInformation: measuredDepth ? [] : ['required:measured_executable_depth'],
    provenance: [
      'hyper_hybrid_residual_replan',
      'fresh_arbitrage_verifier',
      'authenticated_fee_evidence',
      ...(measuredDepth ? ['fresh_depth_evidence', 'positive_all_in_net_execution_eligible'] : []),
      'cryptara_advisory_execution_veto:false',
      'direct_execution_authority:false',
      'synthetic_evidence:false',
    ],
  });
}

function launchResidualAdvisory(input: {
  id: string;
  plan: VerifiedArbitragePlan;
  observedAt: number;
  sourceParentNotionalUsd: number;
  requestedResidualUsd: number;
}): void {
  if (advisoryInFlight.has(input.id)) return;
  advisoryInFlight.add(input.id);
  void (async () => {
    ensureCryptaraAssessmentWiring();
    ensureCryptaraCexEvidenceWiring();
    const cryptara = getCryptara();
    if (!cryptara.getStatus().isRunning) await cryptara.initialize();
    if (!cryptara.getStatus().isRunning) return;

    const [universe, technicalEvidence] = await Promise.all([
      marketDataProviders.discoverUniverse(),
      getBoundTechnicalEvidence({
        opportunityId: input.id,
        symbol: input.plan.symbol,
        observedAt: input.observedAt,
        maxAgeMs: Math.max(30_000, Number(process.env.TRADINGVIEW_DATA_TTL_MS || 300_000)),
      }),
    ]);
    const providerStatuses = marketDataProviders.getProviderStatuses();
    const assessment = await cryptara.assessOpportunity({
      opportunityId: input.id,
      observedAt: input.observedAt,
      chain: 'cex',
      symbol: input.plan.symbol,
      plan: input.plan,
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
        `requested_residual_notional_usd:${input.requestedResidualUsd}`,
        ...technicalEvidence.provenance,
        ...[...new Set(universe.flatMap(asset => asset.sources || [asset.source]))],
        ...providerStatuses.map(status => `provider:${status.provider}:${status.state}`),
        'direct_execution_authority:false',
      ],
    });

    const current = measuredCandidateRegistry.get(input.id);
    if (!current || current.observedAt !== input.observedAt) return;
    measuredCandidateRegistry.updateStatus(input.id, current.status, {
      provenance: [
        ...technicalEvidence.provenance,
        `Cryptara:advisory_${assessment.recommendation}`,
        'cryptara_advisory_execution_veto:false',
        'advisory_assessment_refresh_blocked:false',
      ],
    });
    logger.info('[CEX ResidualReplan] Detached advisory assessment completed without changing canonical eligibility', {
      component: 'CexResidualReplan',
      opportunityId: input.id,
      symbol: input.plan.symbol,
      cryptaraRecommendation: assessment.recommendation,
      canonicalStatus: current.status,
      advisoryExecutionVeto: false,
      directExecutionAuthority: false,
    });
  })().catch(error => {
    logger.debug('[CEX ResidualReplan] Detached advisory assessment degraded', {
      component: 'CexResidualReplan',
      opportunityId: input.id,
      symbol: input.plan.symbol,
      error: error instanceof Error ? error.message : String(error),
      candidateEligibilityPreserved: true,
      directExecutionAuthority: false,
    });
  }).finally(() => advisoryInFlight.delete(input.id));
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

  const observedAt = Date.now();
  const id = opportunityId(plan, requestedResidualUsd, observedAt);
  recordResidualCandidate(id, plan, observedAt, maxQuoteAgeMs);
  launchResidualAdvisory({
    id,
    plan,
    observedAt,
    sourceParentNotionalUsd: input.sourceParentNotionalUsd,
    requestedResidualUsd,
  });

  logger.info('[CEX ResidualReplan] Fresh positive residual returned immediately to canonical candidate flow', {
    component: 'CexResidualReplan',
    opportunityId: id,
    symbol: plan.symbol,
    requestedResidualUsd,
    freshExecutableNotionalUsd: plan.notionalUsd,
    freshNetProfitUsd: plan.netProfitUsd,
    freshNetProfitBps: usdToBps(plan.netProfitUsd, plan.notionalUsd),
    measuredDepth: plan.liquidity.status === 'measured',
    advisoryExecutionVeto: false,
    directExecutionAuthority: false,
  });
}

/**
 * Queue one exact residual reassessment without extending settlement latency.
 * Duplicate same-symbol requests are coalesced while the current reassessment is
 * active. Fresh positive all-in economics and measured depth determine canonical
 * eligibility; Cryptara remains detached advisory evidence and cannot veto it.
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