import type Cryptara from '../../cryptara/index.js';
import {
  getCryptara,
  type CryptaraOpportunityAssessment,
  type CryptaraOpportunityContext,
} from '../../cryptara/index.js';
import { createLogger } from '../../../logger.js';

const log = createLogger('CryptaraProviderConsensusWiring');
const installed = new WeakSet<object>();
const MAX_SNAPSHOTS = Math.max(100, Math.min(10_000, Number(process.env.CRYPTARA_PROVIDER_CONSENSUS_MAX_SNAPSHOTS || 2_000)));
const MAX_AGE_MS = Math.max(1_000, Math.min(15 * 60_000, Number(process.env.CRYPTARA_PROVIDER_CONSENSUS_MAX_AGE_MS || 300_000)));

type ConsensusState = 'multi_source_fresh' | 'single_source_fresh' | 'stale' | 'missing';

export interface CryptaraProviderConsensusSnapshot {
  opportunityId: string;
  symbol: string;
  evaluatedAt: number;
  marketObservedAt: number | null;
  ageMs: number | null;
  sourceCount: number;
  sources: string[];
  freshnessScore: number;
  diversityScore: number;
  qualityScore: number;
  state: ConsensusState;
  executionAuthority: false;
}

type CryptaraAssessmentTarget = {
  assessOpportunity: (context: CryptaraOpportunityContext) => Promise<CryptaraOpportunityAssessment>;
};

const snapshots = new Map<string, CryptaraProviderConsensusSnapshot>();

function normalizedSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function matchingMarketAsset(context: CryptaraOpportunityContext) {
  const target = normalizedSymbol(context.symbol);
  const base = target.replace(/(USDT|USDC|USD)$/, '');
  return context.marketUniverse.find(item => normalizedSymbol(item.symbol) === target)
    || context.marketUniverse.find(item => normalizedSymbol(item.symbol) === `${base}USDT`)
    || null;
}

function buildSnapshot(context: CryptaraOpportunityContext): CryptaraProviderConsensusSnapshot {
  const market = matchingMarketAsset(context);
  const now = Date.now();
  const sources = market
    ? [...new Set([market.source, ...(market.sources || [])])]
    : [];
  const observedAt = market && Number.isFinite(market.observedAt) ? market.observedAt : null;
  const ageMs = observedAt === null ? null : Math.max(0, now - observedAt);
  const freshnessScore = ageMs === null ? 0 : Math.max(0, Math.min(1, 1 - ageMs / MAX_AGE_MS));
  const diversityScore = Math.max(0, Math.min(1, sources.length / 3));
  const qualityScore = Number((freshnessScore * diversityScore).toFixed(4));
  const state: ConsensusState = !market || observedAt === null
    ? 'missing'
    : ageMs! > MAX_AGE_MS
      ? 'stale'
      : sources.length >= 2
        ? 'multi_source_fresh'
        : 'single_source_fresh';

  return {
    opportunityId: context.opportunityId,
    symbol: context.symbol,
    evaluatedAt: now,
    marketObservedAt: observedAt,
    ageMs,
    sourceCount: sources.length,
    sources,
    freshnessScore: Number(freshnessScore.toFixed(4)),
    diversityScore: Number(diversityScore.toFixed(4)),
    qualityScore,
    state,
    executionAuthority: false,
  };
}

function storeSnapshot(snapshot: CryptaraProviderConsensusSnapshot): void {
  snapshots.delete(snapshot.opportunityId);
  snapshots.set(snapshot.opportunityId, snapshot);
  while (snapshots.size > MAX_SNAPSHOTS) {
    const oldest = snapshots.keys().next().value as string | undefined;
    if (!oldest) break;
    snapshots.delete(oldest);
  }
}

export function getCryptaraProviderConsensusSnapshot(opportunityId: string): CryptaraProviderConsensusSnapshot | null {
  const snapshot = snapshots.get(opportunityId);
  return snapshot ? { ...snapshot, sources: [...snapshot.sources] } : null;
}

export function getCryptaraProviderConsensusSummary(): {
  tracked: number;
  multiSourceFresh: number;
  singleSourceFresh: number;
  stale: number;
  missing: number;
  averageQualityScore: number;
  executionAuthority: false;
} {
  const values = [...snapshots.values()];
  const count = (state: ConsensusState) => values.filter(value => value.state === state).length;
  const averageQualityScore = values.length > 0
    ? values.reduce((sum, value) => sum + value.qualityScore, 0) / values.length
    : 0;
  return {
    tracked: values.length,
    multiSourceFresh: count('multi_source_fresh'),
    singleSourceFresh: count('single_source_fresh'),
    stale: count('stale'),
    missing: count('missing'),
    averageQualityScore: Number(averageQualityScore.toFixed(4)),
    executionAuthority: false,
  };
}

/**
 * Adds a measured, bounded provider-consensus signal to Cryptara without changing
 * economics, Monte Carlo output, recommendations, governance, or execution authority.
 * Later optimization layers can consume the snapshot as an evidence-quality input
 * while the current execution path remains bit-for-bit authoritative on its existing
 * gates and measured economics.
 */
export function ensureCryptaraProviderConsensusWiring(): Cryptara {
  const instance = getCryptara();
  if (installed.has(instance)) return instance;
  installed.add(instance);

  const target = instance as unknown as CryptaraAssessmentTarget;
  const originalAssessOpportunity = target.assessOpportunity.bind(target);
  target.assessOpportunity = async (
    context: CryptaraOpportunityContext,
  ): Promise<CryptaraOpportunityAssessment> => {
    const assessment = await originalAssessOpportunity(context);
    const snapshot = buildSnapshot(context);
    storeSnapshot(snapshot);

    return {
      ...assessment,
      provenance: [...new Set([
        ...assessment.provenance,
        `provider_consensus:${snapshot.state}`,
        `provider_consensus_sources:${snapshot.sourceCount}`,
        `provider_consensus_quality:${snapshot.qualityScore.toFixed(4)}`,
      ])],
    };
  };

  log.info('Cryptara provider-consensus foundation installed', {
    advisoryOnly: true,
    executionAuthority: false,
    economicsChanged: false,
    monteCarloChanged: false,
    recommendationChanged: false,
    governanceChanged: false,
    maxAgeMs: MAX_AGE_MS,
    maxSnapshots: MAX_SNAPSHOTS,
  });

  return instance;
}
