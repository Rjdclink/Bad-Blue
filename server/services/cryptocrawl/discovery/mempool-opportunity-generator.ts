import { filteredAlchemyPendingStream } from '../capital-free/alchemy-filtered-pending-stream.js';
import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
import { decodePendingSwapRoute } from '../capital-free/pending-swap-route-decoder.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';
import { getMempoolCapabilities } from './mempool-capability-registry.js';

export function discoverMeasuredMempoolCandidates(): MeasuredCandidate[] {
  const filtered = filteredAlchemyPendingStream.getRecentObservations();
  const capabilities = getMempoolCapabilities().filter(capability => capability.active);
  const ttlMs = Math.max(1_000, Number(process.env.CRYPTOCRAWL_MEMPOOL_CANDIDATE_TTL_MS || 15_000));
  const observed: MeasuredCandidate[] = [];

  // Prefer provider-filtered, hash-first observations because they carry exact
  // chain identity before full transaction detail is fetched. Calldata decoding
  // may remove the route-state information gap, but these rows remain observation
  // only until exact post-transaction state and deterministic economics are measured.
  for (const transaction of filtered) {
    if (!transaction.potentialArbitrage) continue;
    const decodedRoute = decodePendingSwapRoute(transaction.input);
    const routeComplete = decodedRoute?.routeComplete === true;
    const assets = routeComplete ? [...new Set(decodedRoute!.tokenPath.map(token => token.toLowerCase()))] : [];
    const missingInformation = [
      ...(routeComplete ? [] : ['decoded_swap_route']),
      'post_transaction_pool_state',
      'deterministic_backrun_economics',
      'relay_inclusion_probability',
    ];
    observed.push(measuredCandidateRegistry.record({
      opportunityId: `mempool:${transaction.chain}:${transaction.hash}`,
      topology: 'MEMPOOL_BACKRUN',
      observedAt: transaction.timestamp,
      expiresAt: transaction.timestamp + ttlMs,
      status: 'observed',
      assets,
      venues: [transaction.to].filter(Boolean),
      chains: [transaction.chain],
      rawQuotes: [],
      depth: { status: 'unavailable', detail: 'Provider-filtered pending transaction does not prove post-trade pool depth' },
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
        ? 'Pending swap route is decoded and chain-bound, but exact post-transaction pool state, relay inclusion, and deterministic backrun economics remain incomplete'
        : 'Provider-filtered pending swap is a measured rescan trigger only; decoded route state, post-trade pool state, relay inclusion, and deterministic backrun economics remain incomplete',
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
    }));
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
