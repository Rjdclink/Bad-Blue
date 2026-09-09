import { filteredAlchemyPendingStream } from '../capital-free/alchemy-filtered-pending-stream.js';
import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
import { decodePendingSwapRoute } from '../capital-free/pending-swap-route-decoder.js';
import {
  compileExactPostVictimBackrun,
  exactPostVictimBackrunRegistry,
} from '../execution/exact-post-victim-backrun-compiler.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';
import { getMempoolCapabilities } from './mempool-capability-registry.js';

function backrunNotionalUsd(netProfitUsd: number, netProfitBps: number): number | null {
  if (!Number.isFinite(netProfitUsd) || netProfitUsd <= 0 || !Number.isFinite(netProfitBps) || netProfitBps <= 0) return null;
  const notional = netProfitUsd / netProfitBps * 10_000;
  return Number.isFinite(notional) && notional > 0 ? notional : null;
}

export async function discoverMeasuredMempoolCandidates(): Promise<MeasuredCandidate[]> {
  const filtered = filteredAlchemyPendingStream.getRecentObservations();
  const capabilities = getMempoolCapabilities().filter(capability => capability.active);
  const ttlMs = Math.max(1_000, Number(process.env.CRYPTOCRAWL_MEMPOOL_CANDIDATE_TTL_MS || 15_000));
  const observed: MeasuredCandidate[] = [];

  // Prefer provider-filtered, hash-first observations because they carry exact
  // chain identity before full transaction detail is fetched. A route-complete
  // Ethereum observation may be upgraded only by the exact victim-first compiler;
  // pending-feed evidence alone remains non-executable.
  for (const transaction of filtered) {
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
        : 'Provider-filtered pending swap is a measured rescan trigger only; decoded route and exact victim-first execution evidence remain incomplete',
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
        'provider_filter_before_detail:true',
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
      } else {
        exactPostVictimBackrunRegistry.remove(opportunityId);
      }
    }
    observed.push(candidate);
  }

  if (observed.length > 0) return observed;

  // Legacy shared-provider evidence remains available as a no-regression fallback.
  // Its rows do not carry authoritative chain identity, so they stay explicitly
  // unbound and non-executable rather than being copied across possible chains.
  const analysis = alchemyIntegration.getMempoolAnalysis();
  if (!analysis.available || !analysis.observedAt) return [];
  for (const transaction of analysis.arbitrageOpportunities) {
    observed.push(measuredCandidateRegistry.record({
      opportunityId: `mempool:${transaction.hash}`,
      topology: 'MEMPOOL_BACKRUN',
      observedAt: transaction.timestamp,
      expiresAt: transaction.timestamp + ttlMs,
      status: 'observed',
      assets: [],
      venues: [transaction.to].filter(Boolean),
      chains: [],
      rawQuotes: [],
      depth: { status: 'unavailable', detail: 'Pending transaction observation does not prove post-trade pool depth' },
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
      executionCapabilityReason: 'Pending swap is a measured rescan trigger only; exact target-chain binding, decoded route state, relay inclusion, and deterministic backrun economics are incomplete',
      missingInformation: [
        'pending_transaction_chain_binding',
        'decoded_swap_route',
        'post_transaction_pool_state',
        'deterministic_backrun_economics',
        'relay_inclusion_probability',
      ],
      provenance: [
        ...analysis.provenance,
        ...capabilities.map(capability => `mempool_capability:${capability.chain}:${capability.capability}`),
        `pending_tx:${transaction.hash}`,
        `decoded_method:${transaction.decodedMethod || 'unknown'}`,
        'chain_binding:none',
        'provider_filter_before_detail:false',
        'profit_estimate:none',
        'synthetic_evidence:false',
      ],
    }));
  }
  return observed;
}
