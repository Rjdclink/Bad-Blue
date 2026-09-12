import logger from '../../../logger.js';
import {
  getAcrossCrossSwapQuote,
  type AcrossStableSymbol,
} from '../bridge/across-bridge-provider.js';
import { livePriceMesh } from '../bridge/live-price-mesh.js';
import type { ChainId } from '../bridge/types.js';
import {
  evaluateAcrossClosedUsdProfit,
} from '../discovery/cross-chain-route-economics.js';
import {
  measuredCandidateRegistry,
  type MeasuredCandidate,
} from '../discovery/measured-candidate-registry.js';
import { adviseEconomicTransformations } from '../optimization/economic-transformation-engine.js';
import { buildBpsReductionSuperPlan } from '../optimization/bps-reduction-super-engine.js';
import { buildResearchBpsExecutionPlan } from '../optimization/research-bps-execution-tactics.js';
import { getBpsCompressionMeshSnapshot } from './bps-compression-mesh.js';

const SUPPORTED_STAGE_TWO_CHAINS = new Set<ChainId>(['polygon', 'arbitrum', 'avalanche', 'bsc']);
const SUPPORTED_STAGE_TWO_ASSETS = new Set<AcrossStableSymbol>(['USDC', 'USDT']);
const DEFAULT_FACTORS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3] as const;

function finite(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function maxCandidates(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_STAGE_TWO_CROSS_CHAIN_SIZE_CANDIDATES || 7);
  return Number.isFinite(parsed) ? Math.max(3, Math.min(12, Math.trunc(parsed))) : 7;
}

function maxNotionalUsd(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_STAGE_TWO_CROSS_CHAIN_MAX_NOTIONAL_USD || 100_000);
  return Number.isFinite(parsed) ? Math.max(100, Math.min(1_000_000, parsed)) : 100_000;
}

function parseRoute(candidate: MeasuredCandidate): {
  originChain: ChainId;
  destinationChain: ChainId;
  inputSymbol: AcrossStableSymbol;
  outputSymbol: AcrossStableSymbol;
} | null {
  if (candidate.topology !== 'CROSS_CHAIN' || candidate.chains.length !== 2) return null;
  const originChain = candidate.chains[0] as ChainId;
  const destinationChain = candidate.chains[1] as ChainId;
  if (!SUPPORTED_STAGE_TWO_CHAINS.has(originChain) || !SUPPORTED_STAGE_TWO_CHAINS.has(destinationChain) || originChain === destinationChain) return null;

  const symbol = candidate.rawQuotes.find(row => typeof row.symbol === 'string' && row.symbol.includes('/'))?.symbol;
  const [rawInput, rawOutput] = String(symbol || '').split('/').map(value => value.trim().toUpperCase());
  const inputSymbol = rawInput as AcrossStableSymbol;
  const outputSymbol = rawOutput as AcrossStableSymbol;
  if (!SUPPORTED_STAGE_TWO_ASSETS.has(inputSymbol) || !SUPPORTED_STAGE_TWO_ASSETS.has(outputSymbol)) return null;
  return { originChain, destinationChain, inputSymbol, outputSymbol };
}

function candidateNotionals(candidate: MeasuredCandidate): number[] {
  const base = finite(candidate.canonicalBps.notionalUsd);
  if (base === null || base <= 0) return [];

  const advice = adviseEconomicTransformations(candidate);
  const research = buildResearchBpsExecutionPlan(candidate, advice);
  const plan = buildBpsReductionSuperPlan(candidate, advice, research, null, getBpsCompressionMeshSnapshot());
  const fixedCostDominant = advice.dominantCostDriver === 'gas' || advice.dominantCostDriver === 'bridge' || advice.dominantCostDriver === 'relay';
  const nonlinearDominant = advice.dominantCostDriver === 'slippage_impact' || advice.dominantCostDriver === 'latency_decay';
  const factors = new Set<number>([1]);

  for (const fraction of plan.residualNotionalFractions) {
    if (Number.isFinite(fraction) && fraction > 0 && fraction < 1) factors.add(fraction);
  }
  for (const factor of DEFAULT_FACTORS) {
    if (fixedCostDominant || nonlinearDominant || factor <= 1) factors.add(factor);
  }

  // Fixed origin/approval gas can become fewer BPS at a larger exact size, while
  // slippage/route composition can improve at a smaller exact size. Search both
  // directions only through real Across quotes; no predicted saving is credited.
  if (fixedCostDominant) {
    factors.add(4);
    factors.add(6);
  }

  const values = [...factors]
    .map(factor => Math.round(Math.min(maxNotionalUsd(), Math.max(1, base * factor)) * 1_000_000) / 1_000_000)
    .filter(value => Number.isFinite(value) && value > 0)
    .filter((value, index, rows) => rows.indexOf(value) === index)
    .sort((left, right) => Math.abs(left - base) - Math.abs(right - base) || left - right);
  return values.slice(0, maxCandidates());
}

function bpsToBreakEven(netBps: number): number {
  return netBps < 0 ? Math.abs(netBps) : 0;
}

/**
 * Stage-2-only Cross-Chain reducer. It changes no canonical economics in place.
 * Each alternative notional receives a fresh Across exact-input quote and is
 * independently re-evaluated by the existing closed-USD economics authority.
 * Only those measured successor candidates enter the canonical registry.
 */
export async function realizeStageTwoCrossChainReduction(candidate: MeasuredCandidate): Promise<MeasuredCandidate[]> {
  const route = parseRoute(candidate);
  const beforeNetBps = finite(candidate.canonicalBps.netBps);
  if (!route || beforeNetBps === null || candidate.expiresAt <= Date.now()) return [];

  const notionals = candidateNotionals(candidate);
  if (notionals.length === 0) return [];
  const prices = await livePriceMesh.getLiveSymbolPrices([route.inputSymbol, route.outputSymbol]).catch(() => new Map<string, number>());
  const inputPrice = finite(prices.get(route.inputSymbol));
  const outputPrice = finite(prices.get(route.outputSymbol));
  if (inputPrice === null || inputPrice <= 0 || outputPrice === null || outputPrice <= 0) return [];

  const measured: MeasuredCandidate[] = [];
  for (const notionalUsd of notionals) {
    const quote = await getAcrossCrossSwapQuote({ ...route, amountHuman: notionalUsd }).catch(() => null);
    if (!quote || quote.expiresAt <= Date.now() || quote.minOutputAmount === null) continue;
    const economics = evaluateAcrossClosedUsdProfit({
      quote,
      liveInputAssetUsdPrice: inputPrice,
      liveOutputAssetUsdPrice: outputPrice,
    });
    if (!economics || !Number.isFinite(economics.netProfitBps)) continue;

    const observedAt = quote.observedAt;
    const opportunityId = `cross-chain-stage2:${route.originChain}:${route.destinationChain}:${route.inputSymbol}-${route.outputSymbol}:${notionalUsd}:${observedAt}`;
    const row = measuredCandidateRegistry.record({
      opportunityId,
      topology: 'CROSS_CHAIN',
      observedAt,
      expiresAt: quote.expiresAt,
      status: economics.deterministicNetProfitUsd > 0 ? 'deterministic_positive' : 'enriched',
      assets: [...candidate.assets],
      venues: [...candidate.venues],
      chains: [...candidate.chains],
      rawQuotes: [{
        source: 'across_stage_two_exact_requote',
        venue: 'across',
        chain: `${route.originChain}->${route.destinationChain}`,
        symbol: `${route.inputSymbol}/${route.outputSymbol}`,
        observedAt,
        amountIn: quote.inputAmount,
        amountOut: quote.minOutputAmount,
        executable: false,
        provenance: [
          ...quote.provenance,
          `stage_two_source_opportunity:${candidate.opportunityId}`,
          `stage_two_exact_notional_usd:${notionalUsd}`,
        ],
      }],
      depth: {
        status: 'measured',
        detail: `Stage 2 tested a fresh Across exact-input route at $${notionalUsd}; guaranteed minimum output and measured origin/approval gas were re-evaluated by canonical Cross-Chain economics`,
      },
      economics: {
        grossProfitUsd: economics.routeGainUsdBeforeOriginGas,
        deterministicNetProfitUsd: economics.deterministicNetProfitUsd,
        feeUsd: quote.totalFeeUsd,
        gasUsd: economics.originGasUsd,
        bridgeUsd: quote.bridgeFeeUsd,
        expectedSlippageBps: null,
        expectedPriceImpactBps: null,
        notionalUsd: economics.notionalUsd,
        netProfitBps: economics.netProfitBps,
        bpsToBreakEven: bpsToBreakEven(economics.netProfitBps),
      },
      quoteAgeMs: Math.max(0, Date.now() - observedAt),
      executableCapability: false,
      executionCapabilityReason: 'Stage 2 measured alternate-notional economics only; normal Cross-Chain execution must independently satisfy its existing fresh simulation, signer, approval, settlement, and strict-positive gates',
      missingInformation: ['required:normal_cross_chain_execution_readiness_revalidation'],
      provenance: [
        ...quote.provenance,
        `stage_two_source_opportunity:${candidate.opportunityId}`,
        `stage_two_before_net_bps:${beforeNetBps}`,
        `stage_two_exact_notional_usd:${notionalUsd}`,
        'stage_two_bps_reduction:true',
        'stage_two_cross_chain_variable_notional_exact_requote:true',
        'canonical_economics:across_min_output_closed_usd_plus_live_input_output_prices',
        'predicted_savings_credited:false',
        'synthetic_economics:false',
        'execution_authority:false',
      ],
    });
    measured.push(row);
  }

  if (measured.length > 0) {
    const best = measured
      .filter(row => row.canonicalBps.netBps !== null)
      .sort((left, right) => Number(right.canonicalBps.netBps) - Number(left.canonicalBps.netBps))[0];
    logger.info('[StageTwoBpsReduction] Cross-Chain exact notional search completed', {
      component: 'StageTwoCrossChainReduction',
      sourceOpportunityId: candidate.opportunityId,
      beforeNetBps,
      alternativesMeasured: measured.length,
      bestMeasuredNetBps: best?.canonicalBps.netBps ?? null,
      improvementBps: best?.canonicalBps.netBps !== null && best?.canonicalBps.netBps !== undefined
        ? Number(best.canonicalBps.netBps) - beforeNetBps
        : null,
      predictedSavingsCredited: false,
      canonicalBpsMutation: false,
      executionAuthority: false,
    });
  }
  return measured;
}
