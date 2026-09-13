import {
  ensureProviderMeshPendingStream,
  providerMeshPendingStream,
} from '../capital-free/provider-mesh-pending-stream.js';
import { decodePendingSwapRoute } from '../capital-free/pending-swap-route-decoder.js';
import {
  compileExactPostVictimBackrun,
  exactPostVictimBackrunRegistry,
  measuredPostVictimBackrunEconomicsRegistry,
} from '../execution/exact-post-victim-backrun-compiler.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';
import { getMempoolCapabilities } from './mempool-capability-registry.js';

function backrunNotionalUsd(netProfitUsd: number, netProfitBps: number): number | null {
  if (!Number.isFinite(netProfitUsd) || netProfitUsd <= 0 || !Number.isFinite(netProfitBps) || netProfitBps <= 0) return null;
  const notional = netProfitUsd / netProfitBps * 10_000;
  return Number.isFinite(notional) && notional > 0 ? notional : null;
}

export async function discoverMeasuredMempoolCandidates(): Promise<MeasuredCandidate[]> {
  ensureProviderMeshPendingStream();
  const pending = providerMeshPendingStream.getRecentObservations();
  const capabilities = getMempoolCapabilities().filter(capability => capability.active);
  const ttlMs = Math.max(1_000, Number(process.env.CRYPTOCRAWL_MEMPOOL_CANDIDATE_TTL_MS || 15_000));
  const observed: MeasuredCandidate[] = [];

  // Alchemy-free full-pending observations carry exact chain identity before any
  // candidate can reach execution. A route-complete Ethereum observation may be
  // upgraded only by the exact victim-first compiler; mempool evidence alone is
  // never sufficient execution authority.
  for (const transaction of pending) {
    if (!transaction.potentialArbitrage) continue;
    const decodedRoute = decodePendingSwapRoute(transaction.input);
    const routeComplete = decodedRoute?.routeComplete === true;
    const assets = routeComplete ? [...new Set(decodedRoute!.tokenPath.map(token => token.toLowerCase()))] : [];
    const opportunityId = `mempool:${transaction.chain}:${transaction.hash}`;
    const expiresAt = transaction.timestamp + ttlMs;
    const missingInformation = [
      ...(routeComplete ? [] : ['decoded_swap_route']),
      'post_transaction_pool_state',
      'deterministic_backrun_economics',
      'relay_inclusion_probability',
    ];
    let candidate = measuredCandidateRegistry.record({
      opportunityId,
      topology: 'MEMPOOL_BACKRUN',
      observedAt: transaction.timestamp,
      expiresAt,
      status: 'observed',
      assets,
      venues: [transaction.to].filter(Boolean),
      chains: [transaction.chain],
      rawQuotes: [],
      depth: { status: 'unavailable', detail: 'Pending transaction does not itself prove victim-first executable state' },
      economics: {
        grossProfitUsd: null,
        deterministicNetProfitUsd: null,
        feeUsd: null,
        gasUsd: null,
        bridgeUsd: 0,
        expectedSlippageBps: null,
        expectedPriceImpactBps: null,
      },
      quoteAgeMs: Math.max(0, Date.now() - transaction.timestamp),
      executableCapability: false,
      executionCapabilityReason: routeComplete
        ? 'Pending swap route is decoded and chain-bound; exact victim-first bundle compilation/simulation is required before execution'
        : 'Alchemy-free provider-mesh pending swap is a measured rescan trigger only; decoded route and exact victim-first execution evidence remain incomplete',
      missingInformation,
      provenance: [
        ...transaction.provenance,
        ...capabilities
          .filter(capability => capability.chain === transaction.chain)
          .map(capability => `mempool_capability:${capability.chain}:${capability.capability}`),
        `pending_tx:${transaction.hash}`,
        `decoded_method:${decodedRoute?.method || transaction.decodedMethod || 'unknown'}`,
        `decoded_route_complete:${routeComplete}`,
        ...(decodedRoute?.provenance || []),
        ...(routeComplete ? [
          `decoded_token_path:${decodedRoute!.tokenPath.join('>')}`,
          `decoded_fee_tiers:${decodedRoute!.feeTiers.join(',') || 'none'}`,
        ] : []),
        `chain_binding:${transaction.chain}`,
        'application_filter_after_full_pending_push:true',
        'alchemy_dependency:false',
        'profit_estimate:none',
        'synthetic_evidence:false',
      ],
    });

    if (routeComplete && decodedRoute && transaction.chain === 'ethereum' && expiresAt > Date.now()) {
      const compiled = await compileExactPostVictimBackrun({
        candidateOpportunityId: opportunityId,
        observation: transaction,
        decoded: decodedRoute,
        candidateExpiresAt: expiresAt,
      });
      const measuredNearMiss = measuredPostVictimBackrunEconomicsRegistry.get(opportunityId);
      if (compiled) {
        const notionalUsd = backrunNotionalUsd(compiled.deterministicNetProfitUsd, compiled.deterministicNetProfitBps);
        candidate = measuredCandidateRegistry.updateStatus(opportunityId, 'eligible', {
          economics: {
            ...candidate.economics,
            deterministicNetProfitUsd: compiled.deterministicNetProfitUsd,
            feeUsd: 0,
            gasUsd: compiled.expectedGasUsd,
            bridgeUsd: 0,
            expectedSlippageBps: 0,
            expectedPriceImpactBps: 0,
            notionalUsd,
            netProfitBps: compiled.deterministicNetProfitBps,
            bpsToBreakEven: 0,
            realizedNetProfitBps: null,
          },
          depth: {
            status: 'not_applicable',
            detail: 'Exact signed victim-first private bundle simulation replaces standalone depth authority for this backrun',
          },
          executableCapability: true,
          executionCapabilityReason: 'Exact signed victim-first bundle passed relay eth_callBundle with receiver-enforced positive all-in residual',
          quoteAgeMs: Math.max(0, Date.now() - transaction.timestamp),
          replaceMissingInformation: true,
          missingInformation: ['advisory:relay_inclusion_probability_not_execution_authority'],
          provenance: [
            ...compiled.provenance,
            `compiled_backrun_target_block:${compiled.targetBlock}`,
            `compiled_backrun_source_route:${compiled.sourceZeroCapitalOpportunityId}`,
            'mempool_backrun_execution_plan_registry:exact',
            'sandwichOrFrontrun:false',
          ],
        }) || candidate;
      } else if (measuredNearMiss) {
        const allInCostBps = measuredNearMiss.flashLoanFeeBps + measuredNearMiss.gasCostBps + measuredNearMiss.relayCostBps;
        candidate = measuredCandidateRegistry.updateStatus(opportunityId, 'enriched', {
          economics: {
            ...candidate.economics,
            grossProfitUsd: measuredNearMiss.grossProfitUsd,
            deterministicNetProfitUsd: null,
            feeUsd: 0,
            gasUsd: measuredNearMiss.expectedGasUsd,
            bridgeUsd: 0,
            expectedSlippageBps: null,
            expectedPriceImpactBps: null,
            notionalUsd: measuredNearMiss.notionalUsd,
            grossProfitBps: measuredNearMiss.grossProfitBps,
            flashLoanFeeBps: measuredNearMiss.flashLoanFeeBps,
            gasCostBps: measuredNearMiss.gasCostBps,
            relayCostBps: measuredNearMiss.relayCostBps,
            allInCostBps,
            netProfitBps: measuredNearMiss.measuredNetProfitBps,
            bpsToBreakEven: measuredNearMiss.measuredNetProfitBps < 0 ? Math.abs(measuredNearMiss.measuredNetProfitBps) : 0,
            realizedNetProfitBps: null,
          },
          depth: {
            status: 'not_applicable',
            detail: 'Fresh compatible route, measured flash fee, raw EOA bundle gas ceiling and relay cost are available for Stage-2 BPS reduction; exact post-victim state remains unproven until signed victim-first simulation',
          },
          executableCapability: false,
          executionCapabilityReason: 'Stage-2 all-in compatible-route economics are measured, but exact victim-first post-state bundle simulation did not grant execution eligibility',
          quoteAgeMs: Math.max(0, Date.now() - measuredNearMiss.measuredAt),
          replaceMissingInformation: true,
          missingInformation: [
            'required:exact_post_victim_pool_state',
            'required:exact_victim_first_bundle_simulation',
            'advisory:relay_inclusion_probability_not_execution_authority',
          ],
          provenance: [
            ...measuredNearMiss.provenance,
            `mempool_stage_two_source_route:${measuredNearMiss.sourceZeroCapitalOpportunityId}`,
            'mempool_stage_two_canonical_near_miss_published:true',
            'deterministic_post_victim_profit_claimed:false',
            'execution_authority:false',
          ],
        }) || candidate;
        exactPostVictimBackrunRegistry.remove(opportunityId);
      } else {
        exactPostVictimBackrunRegistry.remove(opportunityId);
      }
    }
    observed.push(candidate);
  }

  return observed;
}