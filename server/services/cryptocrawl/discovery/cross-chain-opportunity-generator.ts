import { SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import type { ChainId } from '../bridge/types.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';

const CHAINS: ChainId[] = ['polygon', 'arbitrum', 'avalanche', 'bsc'];

function rpcHealthy(chain: ChainId): boolean {
  return multiProviderRpcManager.getHealth(chain).some(observation => observation.http.success);
}

/**
 * Cross-chain discovery deliberately stops before profitability when no live
 * bridge quote/settlement adapter exists. The legacy RouteOptimizer uses static
 * average fees/times and therefore cannot be authoritative trading evidence.
 */
export async function discoverMeasuredCrossChainCandidates(): Promise<MeasuredCandidate[]> {
  await multiProviderRpcManager.initialize(CHAINS);
  const now = Date.now();
  const ttlMs = Math.max(5_000, Number(process.env.CRYPTOCRAWL_CROSS_CHAIN_CANDIDATE_TTL_MS || 30_000));
  const observed: MeasuredCandidate[] = [];

  for (const from of CHAINS) {
    if (!rpcHealthy(from)) continue;
    for (const to of CHAINS) {
      if (from === to || !rpcHealthy(to)) continue;
      for (const asset of ['USDC', 'USDT'] as const) {
        const sourceToken = asset === 'USDC' ? SUPPORTED_CHAINS[from].usdc : SUPPORTED_CHAINS[from].usdt;
        const destinationToken = asset === 'USDC' ? SUPPORTED_CHAINS[to].usdc : SUPPORTED_CHAINS[to].usdt;
        if (!sourceToken || !destinationToken) continue;
        observed.push(measuredCandidateRegistry.record({
          opportunityId: `cross-chain:${from}:${to}:${asset}:${now}`,
          topology: 'CROSS_CHAIN',
          observedAt: now,
          expiresAt: now + ttlMs,
          status: 'observed',
          assets: [asset],
          venues: [],
          chains: [from, to],
          rawQuotes: [],
          depth: { status: 'unavailable', detail: 'No measured bridge liquidity quote has been admitted' },
          economics: {
            grossProfitUsd: null,
            deterministicNetProfitUsd: null,
            feeUsd: null,
            gasUsd: null,
            bridgeUsd: null,
            expectedSlippageBps: null,
            expectedPriceImpactBps: null,
          },
          quoteAgeMs: null,
          executableCapability: false,
          executionCapabilityReason: 'Source/destination RPCs are measured healthy, but no live bridge quote + atomic/settlement adapter is authoritative',
          missingInformation: [
            'measured_bridge_quote',
            'measured_bridge_liquidity',
            'measured_bridge_transfer_time',
            'cross_chain_settlement_adapter',
            'source_destination_price_drift_model',
          ],
          provenance: [
            `rpc:${from}:healthy`,
            `rpc:${to}:healthy`,
            'bridge_static_average_costs:non_authoritative',
            'synthetic_evidence:false',
          ],
        }));
      }
    }
  }

  return observed;
}
