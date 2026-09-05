import type { CanonicalOpportunitySnapshot } from '../../intelligence/canonical-opportunity-state.js';
import type { MeasuredCandidate } from '../../discovery/measured-candidate-registry.js';
import { getCanonicalExecutionCapabilities } from '../../execution/execution-readiness.js';
import { executionResourceScheduler } from '../../execution/resource-scheduler.js';
import { zeroCapitalResourceScheduler } from '../../execution/zero-capital-resource-scheduler.js';
import type { UnifiedExecutionDecision } from '../../execution/unified-execution-router.js';
import type { NixGenResourceBudget, NixGenStrategyBid, NixGenStrategyClass } from './types.js';

export interface NixGenPreparedBid { bid: NixGenStrategyBid; budgets: NixGenResourceBudget[] }
export interface CexNixGenAdvisoryInput {
  now: number; expiresAt: number; probabilityOfProfitableExecution?: number; terminalCalibrationFactor?: number; decayUrgencyFactor?: number; rankScore?: number;
}

function finitePositive(value: unknown): boolean { return Number.isFinite(Number(value)) && Number(value) > 0; }
function boundedCapacity(raw: unknown, fallback: number, maximum = 32): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(1, Math.min(maximum, Math.trunc(value))) : fallback;
}

function strategyClassForMeasured(candidate: MeasuredCandidate): NixGenStrategyClass | null {
  switch (candidate.topology) {
    case 'DEX_ATOMIC': return 'dex_arbitrage';
    case 'ZERO_CAPITAL_ATOMIC': return 'zero_capital';
    case 'LIQUIDATION': return 'liquidation';
    case 'CROSS_CHAIN': return 'cross_chain';
    default: return null;
  }
}
function measuredTopologySettlementCapable(decision: UnifiedExecutionDecision): boolean {
  return (decision.topology === 'DEX_ATOMIC' && decision.path === 'FLASH_LOAN')
    || (decision.topology === 'ZERO_CAPITAL_ATOMIC' && decision.path === 'FLASH_LOAN')
    || (decision.topology === 'LIQUIDATION' && decision.path === 'FLASH_LOAN_LIQUIDATION')
    || (decision.topology === 'CROSS_CHAIN' && decision.path === 'BRIDGE_FLASH_LOAN');
}
function measuredTopologyAuthoritativePath(decision: UnifiedExecutionDecision): string {
  if (decision.topology === 'ZERO_CAPITAL_ATOMIC' && decision.path === 'FLASH_LOAN') return 'zero_capital_engine:dispatchExecutableOpportunities';
  if (decision.topology === 'CROSS_CHAIN' && decision.path === 'BRIDGE_FLASH_LOAN') return 'funding_crosschain_execution_adapter:across_same_asset_terminal';
  return `measured_topology_execution_adapter:${decision.path}`;
}
function canonicalCexExecutionSupported(plan: NonNullable<CanonicalOpportunitySnapshot['plan']>): boolean {
  const supportedVenues = new Set<string>(getCanonicalExecutionCapabilities().supportedCentralizedVenues);
  return supportedVenues.has(String(plan.buyVenue)) && supportedVenues.has(String(plan.sellVenue));
}
function cexStrategyIdentity(plan: NonNullable<CanonicalOpportunitySnapshot['plan']>): { strategyId: string; strategyClass: NixGenStrategyClass; authoritativePath: string } {
  const makerExecution = (plan as NonNullable<CanonicalOpportunitySnapshot['plan']> & { makerExecution?: unknown }).makerExecution;
  if (makerExecution) return { strategyId: 'verified_cex_market_making', strategyClass: 'market_making', authoritativePath: 'canonical_execution_scheduler:post_only_maker_execution' };
  return { strategyId: 'verified_cex_arbitrage', strategyClass: 'cex_arbitrage', authoritativePath: 'canonical_execution_scheduler:verified_cex_arbitrage' };
}
function measuredAtFromCexSnapshot(snapshot: CanonicalOpportunitySnapshot, now: number): number {
  if (!snapshot.plan) return snapshot.observedAt;
  const quoteAgeMs = Number(snapshot.plan.quoteAgeMs);
  if (!Number.isFinite(quoteAgeMs) || quoteAgeMs < 0) return snapshot.observedAt;
  return Math.max(snapshot.observedAt, now - quoteAgeMs);
}

export function prepareCexNixGenBid(snapshot: CanonicalOpportunitySnapshot, advisory: CexNixGenAdvisoryInput): NixGenPreparedBid | null {
  const plan = snapshot.plan;
  if (!plan || snapshot.status !== 'eligible') return null;
  if (!finitePositive(plan.netProfitUsd) || !finitePositive(plan.notionalUsd)) return null;
  if (!Number.isFinite(advisory.now) || !Number.isFinite(advisory.expiresAt) || advisory.expiresAt <= advisory.now) return null;
  const projection = executionResourceScheduler.getCexPlanningProjection(plan);
  const executionSupported = canonicalCexExecutionSupported(plan);
  const strategy = cexStrategyIdentity(plan);
  return {
    bid: {
      bidId: `cex:${snapshot.opportunityId}`, opportunityId: snapshot.opportunityId, strategyId: strategy.strategyId, strategyClass: strategy.strategyClass,
      observedAt: snapshot.observedAt, expiresAt: advisory.expiresAt,
      economics: { netProfitUsd: plan.netProfitUsd, notionalUsd: plan.notionalUsd, netBps: null, measuredAt: measuredAtFromCexSnapshot(snapshot, advisory.now), authority: 'arbitrage_verifier:verified_plan' },
      execution: { eligible: true, executable: executionSupported, settlementCapable: executionSupported, authoritativePath: executionSupported ? strategy.authoritativePath : '' },
      advisory: { probabilityOfProfitableExecution: advisory.probabilityOfProfitableExecution, terminalCalibrationFactor: advisory.terminalCalibrationFactor, decayUrgencyFactor: advisory.decayUrgencyFactor, rankScore: advisory.rankScore },
      resources: projection.demands,
      mutualExclusionGroup: `opportunity:${snapshot.opportunityId}`,
      metadata: {
        symbol: snapshot.symbol, buyVenue: plan.buyVenue, sellVenue: plan.sellVenue,
        executionCapabilityAuthority: strategy.strategyClass === 'market_making' ? 'post-only-maker-adapters:createPostOnlyMakerAdapters' : 'execution-readiness:getCanonicalExecutionCapabilities',
        resourceProjectionAuthority: projection.authority, resourceProjectionMutatesState: projection.mutatesResourceState,
      },
    }, budgets: projection.budgets,
  };
}

function measuredProjection(candidate: MeasuredCandidate, fundingMode: 'sponsored' | 'native') {
  if (candidate.topology !== 'CROSS_CHAIN') {
    const chain = candidate.chains[0]?.trim();
    if (!chain) return null;
    return zeroCapitalResourceScheduler.getMeasuredAtomicPlanningProjection({ chain, protocols: candidate.venues, fundingMode });
  }
  const origin = candidate.chains[0]?.trim();
  const destination = candidate.chains[1]?.trim();
  const asset = candidate.assets[0]?.trim().toUpperCase();
  if (!origin || !destination || !asset) return null;
  const globalCapacity = boundedCapacity(process.env.CRYPTOCRAWL_CROSS_CHAIN_CONCURRENCY, 2, 16);
  const routeCapacity = boundedCapacity(process.env.CRYPTOCRAWL_ACROSS_ROUTE_CONCURRENCY, 1, 8);
  const demands = [
    { resourceKey: 'cross-chain:global', units: 1 },
    { resourceKey: `cross-chain:across:${origin}->${destination}`, units: 1 },
    { resourceKey: `onchain:system-capital:${origin}:${asset}`, units: 1 },
    { resourceKey: `cross-chain:settlement:${destination}`, units: 1 },
  ];
  return {
    authority: 'cross_chain_execution_adapter_read_only_projection',
    mutatesResourceState: false as const,
    demands,
    budgets: demands.map(demand => ({
      resourceKey: demand.resourceKey,
      capacity: demand.resourceKey === 'cross-chain:global' ? globalCapacity : routeCapacity,
    })),
  };
}

export function prepareMeasuredTopologyNixGenBid(candidate: MeasuredCandidate, decision: UnifiedExecutionDecision, fundingMode: 'sponsored' | 'native'): NixGenPreparedBid | null {
  if (candidate.opportunityId !== decision.opportunityId) return null;
  const strategyClass = strategyClassForMeasured(candidate);
  if (!strategyClass || !measuredTopologySettlementCapable(decision)) return null;
  const netProfitUsd = Number(candidate.economics.deterministicNetProfitUsd);
  const notionalUsd = Number(candidate.economics.notionalUsd);
  if (!finitePositive(netProfitUsd) || !finitePositive(notionalUsd)) return null;
  const projection = measuredProjection(candidate, fundingMode);
  if (!projection) return null;
  const chain = candidate.chains[0]?.trim();
  if (!chain) return null;

  return {
    bid: {
      bidId: `${candidate.topology.toLowerCase()}:${candidate.opportunityId}`, opportunityId: candidate.opportunityId,
      strategyId: decision.path.toLowerCase(), strategyClass, observedAt: candidate.observedAt, expiresAt: candidate.expiresAt,
      economics: { netProfitUsd, notionalUsd, netBps: candidate.canonicalBps.netBps, measuredAt: candidate.canonicalBps.measuredAt, authority: candidate.canonicalBps.source },
      execution: { eligible: candidate.status === 'eligible' && decision.admitted, executable: candidate.executableCapability && decision.admitted, settlementCapable: true, authoritativePath: measuredTopologyAuthoritativePath(decision) },
      advisory: {
        probabilityOfProfitableExecution: Number.isFinite(decision.score.confidenceLevel) ? decision.score.confidenceLevel : undefined,
        // Do not feed UnifiedExecutionScore.profitabilityScore back into Nix-Gen:
        // that score already contains profit/confidence and would double-count them.
        rankScore: undefined,
      },
      resources: projection.demands,
      mutualExclusionGroup: `opportunity:${candidate.opportunityId}`,
      metadata: {
        topology: candidate.topology, chain, destinationChain: candidate.chains[1] ?? null, path: decision.path,
        executionCapabilityAuthority: candidate.topology === 'ZERO_CAPITAL_ATOMIC'
          ? 'zero_capital_engine:terminal_realized_profit_wiring'
          : candidate.topology === 'CROSS_CHAIN'
            ? 'funding_crosschain_execution_adapter:authenticated_across_terminal_settlement'
            : 'measured_topology_execution_adapter:terminal_settlement',
        resourceProjectionAuthority: projection.authority, resourceProjectionMutatesState: projection.mutatesResourceState,
      },
    }, budgets: projection.budgets,
  };
}
