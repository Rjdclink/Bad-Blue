import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';

export interface ZeroCapitalRouteEvidence {
  opportunityId: string;
  chain: SupportedChain;
  type: ZeroCapitalOpportunity['type'];
  inputToken: string;
  outputToken: string;
  inputAssetSymbol: ZeroCapitalOpportunity['inputAssetSymbol'];
  inputTokenDecimals: number;
  inputAssetUsdPrice?: number;
  flashLoanAmount: bigint;
  expectedProfit: bigint;
  grossProfit?: bigint;
  gasEstimate: bigint;
  estimatedExecutionCostInInputToken: bigint;
  estimatedGasCostInInputToken?: bigint;
  flashLoanFeeInInputToken?: bigint;
  relayFeeInInputToken?: bigint;
  expectedSlippageBps: number;
  quoteLatencyMs: number;
  netProfitBps: number;
  route: ZeroCapitalOpportunity['route'];
  confidence: number;
  observedAt: number;
  expiresAt: number;
}

function clone(evidence: ZeroCapitalRouteEvidence): ZeroCapitalRouteEvidence {
  return {
    ...evidence,
    route: evidence.route.map(step => ({ ...step })),
  };
}

function toOpportunity(evidence: ZeroCapitalRouteEvidence): ZeroCapitalOpportunity {
  return {
    id: evidence.opportunityId,
    type: evidence.type,
    chain: evidence.chain,
    inputToken: evidence.inputToken,
    outputToken: evidence.outputToken,
    inputAssetSymbol: evidence.inputAssetSymbol,
    inputTokenDecimals: evidence.inputTokenDecimals,
    ...(evidence.inputAssetUsdPrice !== undefined ? { inputAssetUsdPrice: evidence.inputAssetUsdPrice } : {}),
    flashLoanAmount: evidence.flashLoanAmount,
    expectedProfit: evidence.expectedProfit,
    ...(evidence.grossProfit !== undefined ? { grossProfit: evidence.grossProfit } : {}),
    gasEstimate: evidence.gasEstimate,
    estimatedExecutionCostInInputToken: evidence.estimatedExecutionCostInInputToken,
    ...(evidence.estimatedGasCostInInputToken !== undefined ? { estimatedGasCostInInputToken: evidence.estimatedGasCostInInputToken } : {}),
    ...(evidence.flashLoanFeeInInputToken !== undefined ? { flashLoanFeeInInputToken: evidence.flashLoanFeeInInputToken } : {}),
    ...(evidence.relayFeeInInputToken !== undefined ? { relayFeeInInputToken: evidence.relayFeeInInputToken } : {}),
    expectedSlippageBps: evidence.expectedSlippageBps,
    quoteLatencyMs: evidence.quoteLatencyMs,
    netProfitBps: evidence.netProfitBps,
    route: evidence.route.map(step => ({ ...step })),
    confidence: evidence.confidence,
    timestamp: evidence.observedAt,
    expiresAt: evidence.expiresAt,
  };
}

class ZeroCapitalRouteEvidenceRegistry {
  private readonly entries = new Map<string, ZeroCapitalRouteEvidence>();
  private readonly maxEntries = Math.max(128, Math.min(4096, Number(process.env.CRYPTOCRAWL_MULTILEG_ROUTE_EVIDENCE_MAX || 1024)));

  record(opportunity: ZeroCapitalOpportunity): void {
    if (opportunity.chain === 'europa') return;
    this.entries.set(opportunity.id, {
      opportunityId: opportunity.id,
      chain: opportunity.chain,
      type: opportunity.type,
      inputToken: opportunity.inputToken,
      outputToken: opportunity.outputToken,
      inputAssetSymbol: opportunity.inputAssetSymbol,
      inputTokenDecimals: opportunity.inputTokenDecimals,
      ...(opportunity.inputAssetUsdPrice !== undefined ? { inputAssetUsdPrice: opportunity.inputAssetUsdPrice } : {}),
      flashLoanAmount: opportunity.flashLoanAmount,
      expectedProfit: opportunity.expectedProfit,
      ...(opportunity.grossProfit !== undefined ? { grossProfit: opportunity.grossProfit } : {}),
      gasEstimate: opportunity.gasEstimate,
      estimatedExecutionCostInInputToken: opportunity.estimatedExecutionCostInInputToken,
      ...(opportunity.estimatedGasCostInInputToken !== undefined ? { estimatedGasCostInInputToken: opportunity.estimatedGasCostInInputToken } : {}),
      ...(opportunity.flashLoanFeeInInputToken !== undefined ? { flashLoanFeeInInputToken: opportunity.flashLoanFeeInInputToken } : {}),
      ...(opportunity.relayFeeInInputToken !== undefined ? { relayFeeInInputToken: opportunity.relayFeeInInputToken } : {}),
      expectedSlippageBps: opportunity.expectedSlippageBps,
      quoteLatencyMs: opportunity.quoteLatencyMs,
      netProfitBps: opportunity.netProfitBps,
      route: opportunity.route.map(step => ({ ...step })),
      confidence: opportunity.confidence,
      observedAt: opportunity.timestamp,
      expiresAt: opportunity.expiresAt,
    });
    this.prune();
  }

  remove(opportunityId: string): void {
    this.entries.delete(opportunityId);
  }

  get(opportunityId: string): ZeroCapitalRouteEvidence | null {
    const value = this.entries.get(opportunityId);
    if (!value || value.expiresAt <= Date.now()) return null;
    return clone(value);
  }

  getOpportunity(opportunityId: string): ZeroCapitalOpportunity | null {
    const evidence = this.get(opportunityId);
    return evidence ? toOpportunity(evidence) : null;
  }

  getCompatible(input: { chain: SupportedChain; inputToken: string; now?: number }): ZeroCapitalRouteEvidence[] {
    const now = input.now ?? Date.now();
    return [...this.entries.values()]
      .filter(value =>
        value.expiresAt > now &&
        value.chain === input.chain &&
        value.inputToken.toLowerCase() === input.inputToken.toLowerCase() &&
        value.expectedProfit > 0n,
      )
      .sort((left, right) => Number(right.expectedProfit - left.expectedProfit))
      .map(clone);
  }

  getCompatibleOpportunities(input: { chain: SupportedChain; inputToken: string; now?: number }): ZeroCapitalOpportunity[] {
    return this.getCompatible(input).map(toOpportunity);
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, value] of this.entries) if (value.expiresAt <= now) this.entries.delete(id);
    if (this.entries.size <= this.maxEntries) return;
    const oldest = [...this.entries.values()].sort((left, right) => left.observedAt - right.observedAt);
    for (let index = 0; index < oldest.length - this.maxEntries; index++) this.entries.delete(oldest[index].opportunityId);
  }
}

export const zeroCapitalRouteEvidenceRegistry = new ZeroCapitalRouteEvidenceRegistry();
