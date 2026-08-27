import type { CryptaraMarketGateContext, GateSignal } from './marketGates/types.js';

export interface OpportunityMlAssessment {
  score: number;
  confidence: number;
  sampleCount: number;
  featuresUsed: number;
  signal: GateSignal;
}

export interface OpportunityMlRankerState {
  version: 1;
  sampleCount: number;
  weights: number[];
  bias: number;
}

type FeatureVector = [number, number, number, number, number, number, number, number];

const DEFAULT_WEIGHTS: FeatureVector = [0.9, 1.2, 0.8, 0.65, 0.5, 0.55, 0.8, 0.9];
const DEFAULT_BIAS = -3.1;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));

function normalizedProfit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0.5;
  return clamp01(0.5 + Math.tanh(Number(value) / 25) * 0.5);
}

function featureVector(context: CryptaraMarketGateContext): { values: FeatureVector; used: number } {
  const crossVenue = context.crossVenueFees;
  const netSpreadBps = crossVenue
    ? crossVenue.grossSpreadBps - crossVenue.buyTakerFeeBps - crossVenue.sellTakerFeeBps
    : undefined;
  const latencyValues = context.venueLatency ? Object.values(context.venueLatency.p50Ms).filter(Number.isFinite) : [];
  const maxLatency = context.venueLatency?.maxP50Ms;
  const observedLatency = latencyValues.length > 0 ? Math.min(...latencyValues) : undefined;
  const expectedSlippage = context.slippage?.expectedSlippageBps;
  const maxSlippage = context.slippage?.maxSlippageBps;
  const drawdownPct = context.drawdownCaps?.drawdownPct;
  const maxDrawdownPct = context.drawdownCaps?.maxDrawdownPct;

  const raw: Array<number | undefined> = [
    normalizedProfit(context.expectedProfitUsd),
    Number.isFinite(netSpreadBps) ? clamp01(0.5 + Math.tanh(Number(netSpreadBps) / 25) * 0.5) : undefined,
    Number.isFinite(context.volatilityRegime?.liquidityScore) ? clamp01(Number(context.volatilityRegime?.liquidityScore)) : undefined,
    Number.isFinite(context.volatilityRegime?.competitorDensity) ? 1 - clamp01(Number(context.volatilityRegime?.competitorDensity)) : undefined,
    Number.isFinite(context.volatilityRegime?.networkCongestion) ? 1 - clamp01(Number(context.volatilityRegime?.networkCongestion)) : undefined,
    Number.isFinite(observedLatency) && Number.isFinite(maxLatency) && Number(maxLatency) > 0
      ? clamp01(1 - Number(observedLatency) / Number(maxLatency))
      : undefined,
    Number.isFinite(expectedSlippage) && Number.isFinite(maxSlippage) && Number(maxSlippage) > 0
      ? clamp01(1 - Number(expectedSlippage) / Number(maxSlippage))
      : undefined,
    Number.isFinite(drawdownPct) && Number.isFinite(maxDrawdownPct) && Number(maxDrawdownPct) > 0
      ? clamp01(1 - Number(drawdownPct) / Number(maxDrawdownPct))
      : undefined,
  ];

  const used = raw.filter(value => value !== undefined).length;
  const values: FeatureVector = [
    raw[0] ?? 0.5,
    raw[1] ?? 0.5,
    raw[2] ?? 0.5,
    raw[3] ?? 0.5,
    raw[4] ?? 0.5,
    raw[5] ?? 0.5,
    raw[6] ?? 0.5,
    raw[7] ?? 0.5,
  ];
  return { values, used };
}

class OpportunityMlRanker {
  private weights: FeatureVector = [...DEFAULT_WEIGHTS];
  private bias = DEFAULT_BIAS;
  private samples = 0;
  private readonly learningRate = 0.035;
  private readonly pendingBySymbol = new Map<string, FeatureVector>();

  assess(context: CryptaraMarketGateContext): OpportunityMlAssessment {
    const { values, used } = featureVector(context);
    const linear = this.bias + values.reduce((sum, value, index) => sum + value * this.weights[index], 0);
    const score = clamp01(sigmoid(linear));
    const coverage = used / values.length;
    const learnedConfidence = Math.min(1, this.samples / 100);
    const confidence = clamp01(0.25 + coverage * 0.5 + learnedConfidence * 0.25);

    if (context.pairOrSymbol) {
      this.pendingBySymbol.set(context.pairOrSymbol.trim().toUpperCase(), values);
      if (this.pendingBySymbol.size > 64) {
        const first = this.pendingBySymbol.keys().next().value as string | undefined;
        if (first) this.pendingBySymbol.delete(first);
      }
    }

    return {
      score,
      confidence,
      sampleCount: this.samples,
      featuresUsed: used,
      signal: {
        id: 'aiMl.opportunityRank',
        status: 'pass',
        score,
        message: `Advisory AI/ML opportunity score=${score.toFixed(3)} confidence=${confidence.toFixed(3)} samples=${this.samples}`,
        details: {
          advisoryOnly: true,
          featuresUsed: used,
          totalFeatures: values.length,
          sampleCount: this.samples,
        },
      },
    };
  }

  observeExecution(input: { symbol?: string; success: boolean; realizedProfitUsd?: number | null }): void {
    const symbol = input.symbol?.trim().toUpperCase();
    if (!symbol) return;
    const features = this.pendingBySymbol.get(symbol);
    if (!features) return;

    const label = input.success && Number(input.realizedProfitUsd ?? 0) > 0 ? 1 : 0;
    const prediction = sigmoid(this.bias + features.reduce((sum, value, index) => sum + value * this.weights[index], 0));
    const error = label - prediction;

    this.weights = [
      Math.max(-3, Math.min(3, this.weights[0] + this.learningRate * error * features[0])),
      Math.max(-3, Math.min(3, this.weights[1] + this.learningRate * error * features[1])),
      Math.max(-3, Math.min(3, this.weights[2] + this.learningRate * error * features[2])),
      Math.max(-3, Math.min(3, this.weights[3] + this.learningRate * error * features[3])),
      Math.max(-3, Math.min(3, this.weights[4] + this.learningRate * error * features[4])),
      Math.max(-3, Math.min(3, this.weights[5] + this.learningRate * error * features[5])),
      Math.max(-3, Math.min(3, this.weights[6] + this.learningRate * error * features[6])),
      Math.max(-3, Math.min(3, this.weights[7] + this.learningRate * error * features[7])),
    ];
    this.bias = Math.max(-6, Math.min(3, this.bias + this.learningRate * error));
    this.samples += 1;
    this.pendingBySymbol.delete(symbol);
  }

  exportState(): OpportunityMlRankerState {
    return {
      version: 1,
      sampleCount: this.samples,
      weights: [...this.weights],
      bias: this.bias,
    };
  }

  importState(state: OpportunityMlRankerState): boolean {
    if (
      state?.version !== 1 ||
      !Number.isInteger(state.sampleCount) ||
      state.sampleCount < 0 ||
      !Array.isArray(state.weights) ||
      state.weights.length !== DEFAULT_WEIGHTS.length ||
      !state.weights.every(weight => Number.isFinite(weight) && weight >= -3 && weight <= 3) ||
      !Number.isFinite(state.bias) ||
      state.bias < -6 ||
      state.bias > 3
    ) return false;

    this.samples = state.sampleCount;
    this.weights = state.weights.map(Number) as FeatureVector;
    this.bias = state.bias;
    this.pendingBySymbol.clear();
    return true;
  }

  getState(): { sampleCount: number; weights: number[]; bias: number } {
    const state = this.exportState();
    return { sampleCount: state.sampleCount, weights: state.weights, bias: state.bias };
  }
}

export const opportunityMlRanker = new OpportunityMlRanker();
