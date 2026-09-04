import type { CryptaraExecutionFeedback } from './index.js';

export type CryptaraVenue = 'coinbase' | 'kraken' | 'okx';
export type CryptaraVenueRole =
  | 'execution'
  | 'settlement'
  | 'retained_capital'
  | 'payout_funding'
  | 'treasury_transfer';

export interface CryptaraVenueSpecializationObservation {
  venue: CryptaraVenue;
  role: CryptaraVenueRole;
  terminal: true;
  success: boolean;
  observedAt: number;
  latencyMs?: number;
  realizedCostUsd?: number;
  realizedNetValueUsd?: number;
  slippageBps?: number;
  fillRatio?: number;
  ambiguous?: boolean;
  evidenceReference?: string;
  provenance: string[];
}

export interface CryptaraVenueRoleMetrics {
  venue: CryptaraVenue;
  role: CryptaraVenueRole;
  terminalObservations: number;
  successfulObservations: number;
  ambiguousObservations: number;
  successEwma: number;
  latencyEwmaMs: number;
  costEwmaUsd: number;
  netValueEwmaUsd: number;
  slippageEwmaBps: number;
  fillRatioEwma: number;
  lastObservedAt: number;
  learningAuthority: 'cryptara_venue_specialization';
  executionAuthority: false;
  canonicalEconomicsAuthority: false;
  capitalMovementAuthority: false;
}

export interface CryptaraVenueRoleRanking {
  venue: CryptaraVenue;
  role: CryptaraVenueRole;
  score: number;
  confidence: number;
  sampleCount: number;
}

const SUPPORTED_VENUES = new Set<CryptaraVenue>(['coinbase', 'kraken', 'okx']);
const MAX_OBSERVATIONS = 4_000;

function boundedAlpha(): number {
  const parsed = Number(process.env.CRYPTARA_VENUE_LEARNING_ALPHA || 0.2);
  return Number.isFinite(parsed) ? Math.max(0.02, Math.min(0.5, parsed)) : 0.2;
}

function ewma(previous: number, value: number, observations: number): number {
  if (observations <= 1) return value;
  const alpha = boundedAlpha();
  return previous * (1 - alpha) + value * alpha;
}

function finiteNonNegative(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function finiteSigned(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function bounded01(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : undefined;
}

function canonicalVenue(value: unknown): CryptaraVenue | null {
  const normalized = String(value || '').trim().toLowerCase() as CryptaraVenue;
  return SUPPORTED_VENUES.has(normalized) ? normalized : null;
}

function key(venue: CryptaraVenue, role: CryptaraVenueRole): string {
  return `${venue}:${role}`;
}

function confidenceFromSamples(samples: number): number {
  const priorStrength = Math.max(2, Math.min(100, Number(process.env.CRYPTARA_VENUE_LEARNING_PRIOR_SAMPLES || 12)));
  return Math.max(0, Math.min(1, samples / (samples + priorStrength)));
}

function freshnessWeight(lastObservedAt: number, now = Date.now()): number {
  if (!(lastObservedAt > 0)) return 0;
  const halfLifeMs = Math.max(
    60_000,
    Math.min(30 * 24 * 60 * 60_000, Number(process.env.CRYPTARA_VENUE_LEARNING_HALF_LIFE_MS || 6 * 60 * 60_000)),
  );
  const age = Math.max(0, now - lastObservedAt);
  return Math.pow(0.5, age / halfLifeMs);
}

export class CryptaraVenueSpecializationLearning {
  private readonly observations: CryptaraVenueSpecializationObservation[] = [];
  private readonly metrics = new Map<string, CryptaraVenueRoleMetrics>();

  record(observation: CryptaraVenueSpecializationObservation): void {
    const venue = canonicalVenue(observation.venue);
    if (!venue || observation.terminal !== true) return;

    const normalized: CryptaraVenueSpecializationObservation = {
      ...observation,
      venue,
      terminal: true,
      observedAt: Number.isFinite(observation.observedAt) ? observation.observedAt : Date.now(),
      latencyMs: finiteNonNegative(observation.latencyMs),
      realizedCostUsd: finiteNonNegative(observation.realizedCostUsd),
      realizedNetValueUsd: finiteSigned(observation.realizedNetValueUsd),
      slippageBps: finiteNonNegative(observation.slippageBps),
      fillRatio: bounded01(observation.fillRatio),
      ambiguous: observation.ambiguous === true,
      provenance: [...new Set((observation.provenance || []).filter(Boolean))],
    };

    this.observations.push(normalized);
    if (this.observations.length > MAX_OBSERVATIONS) {
      this.observations.splice(0, this.observations.length - MAX_OBSERVATIONS);
    }

    const metricKey = key(venue, normalized.role);
    const current = this.metrics.get(metricKey) || {
      venue,
      role: normalized.role,
      terminalObservations: 0,
      successfulObservations: 0,
      ambiguousObservations: 0,
      successEwma: 0.5,
      latencyEwmaMs: 0,
      costEwmaUsd: 0,
      netValueEwmaUsd: 0,
      slippageEwmaBps: 0,
      fillRatioEwma: 1,
      lastObservedAt: 0,
      learningAuthority: 'cryptara_venue_specialization' as const,
      executionAuthority: false as const,
      canonicalEconomicsAuthority: false as const,
      capitalMovementAuthority: false as const,
    };

    current.terminalObservations += 1;
    if (normalized.success) current.successfulObservations += 1;
    if (normalized.ambiguous) current.ambiguousObservations += 1;
    current.successEwma = ewma(current.successEwma, normalized.success ? 1 : 0, current.terminalObservations);
    if (normalized.latencyMs !== undefined) current.latencyEwmaMs = ewma(current.latencyEwmaMs, normalized.latencyMs, current.terminalObservations);
    if (normalized.realizedCostUsd !== undefined) current.costEwmaUsd = ewma(current.costEwmaUsd, normalized.realizedCostUsd, current.terminalObservations);
    if (normalized.realizedNetValueUsd !== undefined) current.netValueEwmaUsd = ewma(current.netValueEwmaUsd, normalized.realizedNetValueUsd, current.terminalObservations);
    if (normalized.slippageBps !== undefined) current.slippageEwmaBps = ewma(current.slippageEwmaBps, normalized.slippageBps, current.terminalObservations);
    if (normalized.fillRatio !== undefined) current.fillRatioEwma = ewma(current.fillRatioEwma, normalized.fillRatio, current.terminalObservations);
    current.lastObservedAt = normalized.observedAt;
    this.metrics.set(metricKey, current);
  }

  recordTerminalExecution(feedback: CryptaraExecutionFeedback): void {
    if (!feedback.settlement || feedback.settlement.terminal !== true || feedback.settlementConfirmed !== true) return;
    const orders = feedback.settlement.orders || [];
    const terminalOrders = orders.filter(order => order.terminal === true);
    const venues = [...new Set(terminalOrders.map(order => canonicalVenue(order.venue)).filter((venue): venue is CryptaraVenue => venue !== null))];
    if (venues.length === 0) return;

    const costShare = finiteNonNegative(feedback.feeUsd) !== undefined ? Math.max(0, Number(feedback.feeUsd)) / venues.length : undefined;
    const netShare = finiteSigned(feedback.realizedProfitUsd) !== undefined ? Number(feedback.realizedProfitUsd) / venues.length : undefined;
    const slippage = finiteNonNegative(feedback.slippageBps);
    const latencyShare = Math.max(0, Number.isFinite(feedback.latencyMs) ? feedback.latencyMs : 0) / Math.max(1, venues.length);

    for (const venue of venues) {
      const venueOrders = terminalOrders.filter(order => canonicalVenue(order.venue) === venue);
      const filled = venueOrders.reduce((sum, order) => sum + Math.max(0, Number(order.filledQuantity || 0)), 0);
      const requested = venueOrders.reduce((sum, order) => sum + Math.max(0, Number(order.requestedQuantity || order.filledQuantity || 0)), 0);
      const fillRatio = requested > 0 ? Math.max(0, Math.min(1, filled / requested)) : undefined;
      const success = feedback.success === true && feedback.settlement.settlementConfirmed === true;
      const common = {
        venue,
        terminal: true as const,
        success,
        observedAt: feedback.timestamp || Date.now(),
        latencyMs: latencyShare,
        realizedCostUsd: costShare,
        realizedNetValueUsd: netShare,
        slippageBps: slippage,
        fillRatio,
        evidenceReference: feedback.opportunityId,
        provenance: [
          'cryptara_terminal_execution_feedback',
          'terminal_confirmed_settlement',
          'authenticated_cex_order_settlement',
        ],
      };
      this.record({ ...common, role: 'execution' });
      this.record({ ...common, role: 'settlement' });
      if (success && (netShare ?? 0) > 0) {
        this.record({
          ...common,
          role: 'retained_capital',
          provenance: [...common.provenance, 'terminal_positive_system_capital_origin'],
        });
      }
    }
  }

  score(venue: CryptaraVenue, role: CryptaraVenueRole, now = Date.now()): CryptaraVenueRoleRanking {
    const metric = this.metrics.get(key(venue, role));
    if (!metric) return { venue, role, score: 0.5, confidence: 0, sampleCount: 0 };

    const confidence = confidenceFromSamples(metric.terminalObservations);
    const freshness = freshnessWeight(metric.lastObservedAt, now);
    const latencyScore = 1 / (1 + Math.max(0, metric.latencyEwmaMs) / 1_000);
    const costScore = 1 / (1 + Math.max(0, metric.costEwmaUsd));
    const slippageScore = 1 / (1 + Math.max(0, metric.slippageEwmaBps) / 10);
    const valueScore = metric.netValueEwmaUsd >= 0
      ? 0.5 + 0.5 * (metric.netValueEwmaUsd / (1 + metric.netValueEwmaUsd))
      : 0.5 / (1 + Math.abs(metric.netValueEwmaUsd));
    const ambiguityPenalty = Math.min(0.25, metric.ambiguousObservations / Math.max(1, metric.terminalObservations));

    let evidenceScore: number;
    if (role === 'execution' || role === 'settlement') {
      evidenceScore = metric.successEwma * 0.35 + metric.fillRatioEwma * 0.20 + latencyScore * 0.15 + costScore * 0.10 + slippageScore * 0.10 + valueScore * 0.10;
    } else if (role === 'payout_funding' || role === 'treasury_transfer') {
      evidenceScore = metric.successEwma * 0.40 + latencyScore * 0.20 + costScore * 0.25 + valueScore * 0.15;
    } else {
      evidenceScore = metric.successEwma * 0.25 + latencyScore * 0.15 + costScore * 0.15 + valueScore * 0.35 + metric.fillRatioEwma * 0.10;
    }
    evidenceScore = Math.max(0, Math.min(1, evidenceScore - ambiguityPenalty));

    // Unknown/old evidence shrinks toward neutral 0.5 instead of vetoing a venue.
    const effectiveConfidence = confidence * freshness;
    const score = 0.5 * (1 - effectiveConfidence) + evidenceScore * effectiveConfidence;
    return {
      venue,
      role,
      score: Math.max(0, Math.min(1, score)),
      confidence: effectiveConfidence,
      sampleCount: metric.terminalObservations,
    };
  }

  rank(venues: CryptaraVenue[], role: CryptaraVenueRole, now = Date.now()): CryptaraVenueRoleRanking[] {
    return [...new Set(venues)]
      .map(venue => this.score(venue, role, now))
      .sort((left, right) => right.score - left.score || right.confidence - left.confidence || left.venue.localeCompare(right.venue));
  }

  getMetrics(): CryptaraVenueRoleMetrics[] {
    return Array.from(this.metrics.values()).map(metric => ({ ...metric }));
  }

  getObservations(limit = 200): CryptaraVenueSpecializationObservation[] {
    return this.observations.slice(-Math.max(1, limit)).map(observation => ({ ...observation, provenance: [...observation.provenance] }));
  }
}

let singleton: CryptaraVenueSpecializationLearning | null = null;

export function getCryptaraVenueSpecializationLearning(): CryptaraVenueSpecializationLearning {
  if (!singleton) singleton = new CryptaraVenueSpecializationLearning();
  return singleton;
}
