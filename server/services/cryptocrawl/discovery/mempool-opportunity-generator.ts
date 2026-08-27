import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';

export function discoverMeasuredMempoolCandidates(): MeasuredCandidate[] {
  const analysis = alchemyIntegration.getMempoolAnalysis();
  if (!analysis.available || !analysis.observedAt) return [];
  const activeNetworks = alchemyIntegration.getStatistics().readiness.activeNetworks;
  const ttlMs = Math.max(1_000, Number(process.env.CRYPTOCRAWL_MEMPOOL_CANDIDATE_TTL_MS || 15_000));
  const observed: MeasuredCandidate[] = [];

  // The current Alchemy adapter marks measured swap transactions as
  // `potentialArbitrage`; that flag is a trigger, not profit evidence. A pending
  // swap only causes broader route re-evaluation. No estimated profit is created.
  for (const transaction of analysis.arbitrageOpportunities) {
    observed.push(measuredCandidateRegistry.record({
      opportunityId: `mempool:${transaction.hash}`,
      topology: 'MEMPOOL_BACKRUN',
      observedAt: transaction.timestamp,
      expiresAt: transaction.timestamp + ttlMs,
      status: 'observed',
      assets: [],
      venues: [transaction.to].filter(Boolean),
      chains: activeNetworks,
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
      executionCapabilityReason: 'Pending swap is a measured rescan trigger only; target-chain binding, decoded route state, relay inclusion, and deterministic backrun economics are not yet complete',
      missingInformation: [
        'pending_transaction_chain_binding',
        'decoded_swap_route',
        'post_transaction_pool_state',
        'deterministic_backrun_economics',
        'relay_inclusion_probability',
      ],
      provenance: [
        ...analysis.provenance,
        `pending_tx:${transaction.hash}`,
        `decoded_method:${transaction.decodedMethod || 'unknown'}`,
        'profit_estimate:none',
        'synthetic_evidence:false',
      ],
    }));
  }
  return observed;
}
