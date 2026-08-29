import logger from '../../../logger.js';
import {
  measuredCandidateRegistry,
  type MeasuredCandidate,
  type MeasuredOpportunityTopology,
} from '../discovery/measured-candidate-registry.js';
import { adaptiveTopologyOptimizer } from './adaptive-topology-optimizer.js';
import { selectCompositeExecutionPath, type DynamicExecutionPath } from './dynamic-execution-path-selector.js';
import { zeroCapitalCompositeEvidenceRegistry } from './zero-capital-composite-evidence-registry.js';

export type CompositeExecutionMode = 'single_domain_atomic' | 'coordinated_parallel';

export interface CompositeArbitrageLeg {
  opportunityId: string;
  topology: MeasuredOpportunityTopology;
  chains: string[];
  venues: string[];
  assets: string[];
  notionalUsd: number | null;
  deterministicNetProfitUsd: number;
  deterministicNetProfitBps: number | null;
  priorityWeight: number;
  score: number;
  expiresAt: number;
  atomicDomain: string;
  atomicallyComposable: boolean;
  selectedExecutionPath: DynamicExecutionPath;
}

export interface UnifiedCompositeArbitragePlan {
  planId: string;
  createdAt: number;
  expiresAt: number;
  executionMode: CompositeExecutionMode;
  selectedExecutionPath: DynamicExecutionPath;
  atomicDomain: string | null;
  legs: CompositeArbitrageLeg[];
  totalDeterministicNetProfitUsd: number;
  totalNotionalUsd: number | null;
  notionalWeightedNetProfitBps: number | null;
  /** Capital-efficiency BPS when exact-simulated closed cycles reuse one flash-loan principal. */
  sharedPrincipalStackedBps: number | null;
  arithmeticLegBpsSum: number | null;
  adaptiveMinIncrementalBps: number;
  adaptivePolicyEmpirical: boolean;
  requestedLegCount: number;
  selectedLegCount: number;
  exactCompositeSimulation: boolean;
  compositeEstimatedGas: string | null;
  compositionGainUsd: number | null;
  compositionGainVerified: boolean;
  executionAuthority: false;
  requiresIndependentFinalAdmission: true;
  reasons: string[];
}

function finitePositive(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function legNotional(candidate: MeasuredCandidate): number | null {
  const direct = finitePositive(candidate.economics.notionalUsd);
  if (direct !== null) return direct;
  const netUsd = finitePositive(candidate.economics.deterministicNetProfitUsd);
  const netBps = Number(candidate.economics.netProfitBps);
  if (netUsd !== null && Number.isFinite(netBps) && netBps > 0) return finitePositive(netUsd * 10_000 / netBps);
  const grossUsd = finitePositive(candidate.economics.grossProfitUsd);
  const grossBps = Number(candidate.economics.grossProfitBps);
  if (grossUsd !== null && Number.isFinite(grossBps) && grossBps > 0) return finitePositive(grossUsd * 10_000 / grossBps);
  return null;
}

function legBps(candidate: MeasuredCandidate, notionalUsd: number | null): number | null {
  const explicit = Number(candidate.economics.netProfitBps);
  if (Number.isFinite(explicit)) return explicit;
  const net = Number(candidate.economics.deterministicNetProfitUsd);
  if (notionalUsd !== null && Number.isFinite(net)) return net / notionalUsd * 10_000;
  return null;
}

function atomicDomain(candidate: MeasuredCandidate): string {
  if (candidate.topology === 'CEX_CEX' || candidate.topology === 'MAKER_CEX') return 'cex-coordinated';
  if (candidate.topology === 'CROSS_CHAIN') return `cross-chain:${candidate.chains.join('>') || 'unknown'}`;
  if (candidate.topology === 'FUNDING_ARBITRAGE') return `derivatives:${candidate.venues.join('+') || 'unknown'}`;
  if (candidate.chains.length === 1) return `evm:${candidate.chains[0]}`;
  return `domain:${candidate.topology.toLowerCase()}`;
}

function atomicallyComposable(candidate: MeasuredCandidate): boolean {
  if (candidate.status !== 'eligible' || !candidate.executableCapability || candidate.chains.length !== 1) return false;
  if (!['DEX_ATOMIC', 'ZERO_CAPITAL_ATOMIC', 'MEMPOOL_BACKRUN'].includes(candidate.topology)) return false;
  return candidate.provenance.includes('atomic_multileg_payload_composable');
}

function conflicts(left: CompositeArbitrageLeg, right: CompositeArbitrageLeg): boolean {
  if (left.opportunityId === right.opportunityId) return true;
  const leftVenueAssets = new Set(left.venues.flatMap(venue => left.assets.map(asset => `${venue}:${asset}`)));
  if (right.venues.some(venue => right.assets.some(asset => leftVenueAssets.has(`${venue}:${asset}`)))) return true;
  if (left.atomicDomain.startsWith('evm:') && right.atomicDomain === left.atomicDomain) {
    const overlap = right.assets.some(asset => left.assets.includes(asset));
    if (overlap && !(left.atomicallyComposable && right.atomicallyComposable)) return true;
  }
  return false;
}

function measuredCompositionGain(candidates: readonly MeasuredCandidate[]): number | null {
  const values = [...new Set(candidates.flatMap(candidate => candidate.provenance
    .filter(item => item.startsWith('measured_composite_gain_usd:'))
    .map(item => Number(item.slice('measured_composite_gain_usd:'.length)))
    .filter(value => Number.isFinite(value))))];
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function toLeg(candidate: MeasuredCandidate, now: number, minIncrementalBps: number): CompositeArbitrageLeg | null {
  if (candidate.expiresAt <= now || candidate.status !== 'eligible' || !candidate.executableCapability) return null;
  const netProfitUsd = Number(candidate.economics.deterministicNetProfitUsd);
  if (!Number.isFinite(netProfitUsd) || netProfitUsd <= 0) return null;
  if (candidate.missingInformation.length > 0 || candidate.depth.status === 'unavailable') return null;

  const notionalUsd = legNotional(candidate);
  const netProfitBps = legBps(candidate, notionalUsd);
  if (netProfitBps !== null && (netProfitBps <= 0 || netProfitBps < minIncrementalBps)) return null;
  const pathDecision = selectCompositeExecutionPath([candidate])[0];
  if (!pathDecision?.executableNow) return null;
  const priorityWeight = adaptiveTopologyOptimizer.getPriority(candidate.topology);
  const freshness = Math.max(0, Math.min(1, (candidate.expiresAt - now) / Math.max(1, candidate.expiresAt - candidate.observedAt)));
  const bpsScore = netProfitBps !== null ? Math.log1p(Math.max(0, netProfitBps)) : Math.log1p(netProfitUsd);
  const score = priorityWeight * (0.70 * bpsScore + 0.30 * freshness);
  return {
    opportunityId: candidate.opportunityId,
    topology: candidate.topology,
    chains: [...candidate.chains],
    venues: [...candidate.venues],
    assets: [...candidate.assets],
    notionalUsd,
    deterministicNetProfitUsd: netProfitUsd,
    deterministicNetProfitBps: netProfitBps,
    priorityWeight,
    score,
    expiresAt: candidate.expiresAt,
    atomicDomain: atomicDomain(candidate),
    atomicallyComposable: atomicallyComposable(candidate),
    selectedExecutionPath: pathDecision.path,
  };
}

function weightedBps(legs: readonly CompositeArbitrageLeg[]): number | null {
  if (legs.some(leg => leg.notionalUsd === null)) return null;
  const notional = legs.reduce((sum, leg) => sum + Number(leg.notionalUsd), 0);
  if (!(notional > 0)) return null;
  const profit = legs.reduce((sum, leg) => sum + leg.deterministicNetProfitUsd, 0);
  return profit / notional * 10_000;
}

function arithmeticBps(legs: readonly CompositeArbitrageLeg[]): number | null {
  if (legs.some(leg => leg.deterministicNetProfitBps === null)) return null;
  return legs.reduce((sum, leg) => sum + Number(leg.deterministicNetProfitBps), 0);
}

class UnifiedMultiLegArbitrageEngine {
  private latest: UnifiedCompositeArbitragePlan | null = null;

  assemble(options?: { minLegs?: number; maxLegs?: number; atomicOnly?: boolean }): UnifiedCompositeArbitragePlan | null {
    const now = Date.now();
    const policy = adaptiveTopologyOptimizer.getAssemblyPolicy();
    const minLegs = Math.max(1, Math.min(8, Math.trunc(options?.minLegs ?? policy.minLegs)));
    const maxLegs = Math.max(minLegs, Math.min(8, Math.trunc(options?.maxLegs ?? policy.maxLegs)));
    const sourceCandidates = measuredCandidateRegistry.getRecent(1024);
    const candidates = sourceCandidates
      .map(candidate => toLeg(candidate, now, policy.minIncrementalBps))
      .filter((leg): leg is CompositeArbitrageLeg => leg !== null)
      .sort((left, right) => right.score - left.score || right.deterministicNetProfitUsd - left.deterministicNetProfitUsd);

    const selected: CompositeArbitrageLeg[] = [];
    for (const leg of candidates) {
      if (selected.length >= maxLegs) break;
      if (options?.atomicOnly && !leg.atomicallyComposable) continue;
      if (selected.some(existing => conflicts(existing, leg))) continue;
      selected.push(leg);
    }
    if (selected.length < minLegs) return null;

    const selectedIds = selected.map(leg => leg.opportunityId);
    const selectedCandidates = selectedIds
      .map(id => measuredCandidateRegistry.get(id))
      .filter((value): value is MeasuredCandidate => value !== null);
    const pathDecisions = selectCompositeExecutionPath(selectedCandidates).filter(decision => decision.executableNow);
    const selectedExecutionPath: DynamicExecutionPath = pathDecisions.some(decision => decision.path === 'HYBRID')
      ? 'HYBRID'
      : pathDecisions[0]?.path ?? 'UNAVAILABLE';
    const domains = [...new Set(selected.map(leg => leg.atomicDomain))];
    const allZeroCapital = selected.every(leg => leg.topology === 'ZERO_CAPITAL_ATOMIC');
    const exactZeroCapitalComposite = allZeroCapital ? zeroCapitalCompositeEvidenceRegistry.get(selectedIds) : null;
    const singleDomainAtomic = domains.length === 1 &&
      selected.every(leg => leg.atomicallyComposable) &&
      (!allZeroCapital || exactZeroCapitalComposite !== null);
    const executionMode: CompositeExecutionMode = singleDomainAtomic ? 'single_domain_atomic' : 'coordinated_parallel';
    const expiresAt = Math.min(...selected.map(leg => leg.expiresAt));
    const totalNotionalUsd = selected.every(leg => leg.notionalUsd !== null)
      ? selected.reduce((sum, leg) => sum + Number(leg.notionalUsd), 0)
      : null;
    const arithmeticLegBpsSum = arithmeticBps(selected);
    const sharedPrincipalStackedBps = singleDomainAtomic && exactZeroCapitalComposite
      ? exactZeroCapitalComposite.sharedPrincipalStackedBps
      : null;
    const compositionGainUsd = singleDomainAtomic ? measuredCompositionGain(selectedCandidates) : null;
    const compositionGainVerified = compositionGainUsd !== null && compositionGainUsd > 0;

    const plan: UnifiedCompositeArbitragePlan = {
      planId: `composite:${now}:${selectedIds.join('|')}`,
      createdAt: now,
      expiresAt,
      executionMode,
      selectedExecutionPath,
      atomicDomain: singleDomainAtomic ? domains[0] : null,
      legs: selected.map(leg => ({ ...leg, chains: [...leg.chains], venues: [...leg.venues], assets: [...leg.assets] })),
      totalDeterministicNetProfitUsd: selected.reduce((sum, leg) => sum + leg.deterministicNetProfitUsd, 0),
      totalNotionalUsd,
      notionalWeightedNetProfitBps: weightedBps(selected),
      sharedPrincipalStackedBps,
      arithmeticLegBpsSum,
      adaptiveMinIncrementalBps: policy.minIncrementalBps,
      adaptivePolicyEmpirical: policy.empirical,
      requestedLegCount: maxLegs,
      selectedLegCount: selected.length,
      exactCompositeSimulation: exactZeroCapitalComposite !== null,
      compositeEstimatedGas: exactZeroCapitalComposite?.estimatedGas.toString() ?? null,
      compositionGainUsd,
      compositionGainVerified,
      executionAuthority: false,
      requiresIndependentFinalAdmission: true,
      reasons: [
        'Every selected leg is independently deterministic-positive, executable-capable, and currently eligible',
        `Adaptive assembly threshold=${policy.minIncrementalBps.toFixed(4)} BPS from ${policy.terminalSamples} terminal samples`,
        executionMode === 'single_domain_atomic'
          ? 'The exact selected opportunity set passed combined receiver simulation in one settlement domain'
          : 'Cross-domain or unmatched-composite legs are coordinated only; they are not falsely represented as one atomic blockchain transaction',
        sharedPrincipalStackedBps !== null
          ? `Shared-principal stacked BPS=${sharedPrincipalStackedBps.toFixed(4)} from exact-simulated zero-capital composite evidence`
          : 'No shared-principal BPS is claimed without an exact composite-evidence match',
        compositionGainVerified
          ? 'Additional composition gain is backed by explicit measured gain evidence'
          : 'No extra composition/synergy gain is claimed without measured gain evidence',
        'Arithmetic leg-BPS sum is telemetry only; ordinary parallel portfolios use notional-weighted BPS',
        'Each leg must re-pass quote freshness, resources, governance, product/protocol constraints, and terminal settlement immediately before execution',
      ],
    };
    this.latest = plan;
    logger.info('[UnifiedMultiLeg] Composite arbitrage plan assembled', {
      component: 'UnifiedMultiLegArbitrageEngine',
      planId: plan.planId,
      executionMode: plan.executionMode,
      selectedExecutionPath: plan.selectedExecutionPath,
      selectedLegCount: plan.selectedLegCount,
      topologies: plan.legs.map(leg => leg.topology),
      arithmeticLegBpsSum: plan.arithmeticLegBpsSum,
      notionalWeightedNetProfitBps: plan.notionalWeightedNetProfitBps,
      sharedPrincipalStackedBps: plan.sharedPrincipalStackedBps,
      exactCompositeSimulation: plan.exactCompositeSimulation,
      compositeEstimatedGas: plan.compositeEstimatedGas,
      compositionGainUsd: plan.compositionGainUsd,
      compositionGainVerified: plan.compositionGainVerified,
      adaptiveMinIncrementalBps: plan.adaptiveMinIncrementalBps,
      totalDeterministicNetProfitUsd: plan.totalDeterministicNetProfitUsd,
      executionAuthority: false,
    });
    return this.getLatestPlan();
  }

  getLatestPlan(): UnifiedCompositeArbitragePlan | null {
    if (!this.latest) return null;
    return {
      ...this.latest,
      legs: this.latest.legs.map(leg => ({ ...leg, chains: [...leg.chains], venues: [...leg.venues], assets: [...leg.assets] })),
      reasons: [...this.latest.reasons],
    };
  }
}

export const unifiedMultiLegArbitrageEngine = new UnifiedMultiLegArbitrageEngine();
