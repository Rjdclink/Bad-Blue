import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';
import { getMempoolCapabilities } from './mempool-capability-registry.js';

export function discoverMeasuredMempoolCandidates(): MeasuredCandidate[] {
  const analysis = alchemyIntegration.getMempoolAnalysis();
  if (!analysis.available || !analysis.observedAt) return [];
  const capabilities = getMempoolCapabilities().filter(capability => capability.active);
  const ttlMs = Math.max(1_000, Number(process.env.CRYPTOCRAWL_MEMPOOL_CANDIDATE_TTL_MS || 15_000));
  const observed: MeasuredCandidate[] = [];

  // The current adapter's pending transactions are real provider observations,
  // but it does not attach one authoritative chain identity to each returned row.
  // Never duplicate an ambiguous transaction across every active network: leave
  // chains empty until the producer supplies exact chain binding.
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
        'profit_estimate:none',
        'synthetic_evidence:false',
      ],
    }));
  }
  return observed;
}
