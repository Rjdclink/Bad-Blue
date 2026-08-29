export interface AriesMeasuredRateEdge {
  id: string;
  from: string;
  to: string;
  /** Dimensionless effective output units per input unit after decimal normalization and fees. */
  effectiveRate: number;
  observedAt: number;
  venue?: string;
  capacityUsd?: number | null;
}

export interface AriesNegativeCycle {
  nodes: string[];
  edgeIds: string[];
  compoundedRate: number;
  grossEdgeBps: number;
  observedAt: number;
}

export interface AriesLiquidityCurvePoint {
  notionalUsd: number;
  netProfitUsd: number;
  netProfitBps: number;
}

export interface AriesLiquidityCurveDecision {
  optimalNotionalUsd: number;
  optimalNetProfitUsd: number;
  optimalNetProfitBps: number;
  maximumPositiveNotionalUsd: number;
  marginalProfitPerDollar: number | null;
  curvePoints: number;
}

export interface AriesRouteFormationObservation {
  routeId: string;
  observedAt: number;
  netProfitBps: number | null;
  notionalUsd: number;
}

export interface AriesRouteFormationScore {
  routeId: string;
  samples: number;
  positiveSamples: number;
  positiveProbability: number;
  estimatedHalfLifeMs: number;
  survivalProbability: number;
  valueOfInformation: number;
  formationPriority: number;
  priorityMultiplier: number;
  authority: 'scan_priority_advisory_only';
  deterministicProfitAuthority: false;
  executionAuthority: false;
}

export interface AriesFragmentationInput {
  normalizedPriceDispersion: number;
  liquidityAsymmetry: number;
  updateLagAsymmetry: number;
  flowDivergence: number;
}

export interface AriesEdgeDecompositionInput {
  grossEdgeBps: number;
  feeBps?: number;
  impactBps?: number;
  latencyDecayBps?: number;
  adverseSelectionBps?: number;
  gasBps?: number;
  relayBps?: number;
  sizingLossBps?: number;
  routingLossBps?: number;
  competitiveErosionBps?: number;
  realizedNetBps?: number | null;
  bestContemporaneousExecutableNetBps?: number | null;
}

export interface AriesEdgeDecomposition {
  modeledTerminalBps: number;
  realizedNetBps: number | null;
  captureRatio: number | null;
  regretBps: number | null;
  largestModeledLoss: { source: string; bps: number } | null;
  losses: Record<string, number>;
}

const ROUTE_HISTORY_LIMIT = 128;
const routeHistory = new Map<string, AriesRouteFormationObservation[]>();

function clamp(value: number, min: number, max: number): number {
  const finite = Number.isFinite(value) ? value : min;
  return Math.max(min, Math.min(max, finite));
}

function positive(value: number | undefined): number {
  return Math.max(0, Number.isFinite(value) ? Number(value) : 0);
}

function normalizedCycleKey(nodes: string[]): string {
  if (nodes.length === 0) return '';
  const cycle = nodes[nodes.length - 1] === nodes[0] ? nodes.slice(0, -1) : [...nodes];
  if (cycle.length === 0) return '';
  let best = cycle;
  for (let index = 1; index < cycle.length; index += 1) {
    const rotated = [...cycle.slice(index), ...cycle.slice(0, index)];
    if (rotated.join('>') < best.join('>')) best = rotated;
  }
  return best.join('>');
}

/**
 * Bellman-Ford negative-cycle detector for already-normalized executable rates.
 * Callers must normalize token decimals before constructing effectiveRate. The
 * detector is discovery/advisory math only; a returned cycle must still receive
 * fresh direct quotes, all-in costs, exact atomic simulation and governance.
 */
export function findAriesNegativeCycles(
  rawEdges: readonly AriesMeasuredRateEdge[],
  options: { maxAgeMs?: number; maxHops?: number; maxCycles?: number; now?: number } = {},
): AriesNegativeCycle[] {
  const now = options.now ?? Date.now();
  const maxAgeMs = clamp(options.maxAgeMs ?? 3_000, 100, 60_000);
  const maxHops = Math.floor(clamp(options.maxHops ?? 4, 2, 8));
  const maxCycles = Math.floor(clamp(options.maxCycles ?? 16, 1, 128));
  const edges = rawEdges.filter(edge =>
    edge.from && edge.to && edge.from !== edge.to && edge.effectiveRate > 0 &&
    Number.isFinite(edge.effectiveRate) && now - edge.observedAt <= maxAgeMs,
  );
  const nodes = [...new Set(edges.flatMap(edge => [edge.from, edge.to]))];
  if (nodes.length < 2 || edges.length < 2) return [];

  const nodeIndex = new Map(nodes.map((node, index) => [node, index]));
  const dist = new Array(nodes.length).fill(0);
  const parent = new Array<number>(nodes.length).fill(-1);
  const parentEdge = new Array<AriesMeasuredRateEdge | null>(nodes.length).fill(null);
  let updatedVertices: number[] = [];

  for (let pass = 0; pass < nodes.length; pass += 1) {
    const updated = new Set<number>();
    for (const edge of edges) {
      const from = nodeIndex.get(edge.from)!;
      const to = nodeIndex.get(edge.to)!;
      const weight = -Math.log(edge.effectiveRate);
      if (dist[from] + weight < dist[to] - 1e-12) {
        dist[to] = dist[from] + weight;
        parent[to] = from;
        parentEdge[to] = edge;
        updated.add(to);
      }
    }
    if (updated.size === 0) return [];
    if (pass === nodes.length - 1) updatedVertices = [...updated];
  }

  const cycles = new Map<string, AriesNegativeCycle>();
  for (const updated of updatedVertices) {
    let cursor = updated;
    for (let index = 0; index < nodes.length; index += 1) {
      cursor = parent[cursor];
      if (cursor < 0) break;
    }
    if (cursor < 0) continue;

    const start = cursor;
    const reverseNodes: number[] = [start];
    const reverseEdges: AriesMeasuredRateEdge[] = [];
    cursor = parent[start];
    let guard = 0;
    while (cursor >= 0 && cursor !== start && guard < nodes.length + 1) {
      const edge = parentEdge[reverseNodes[reverseNodes.length - 1]];
      if (edge) reverseEdges.push(edge);
      reverseNodes.push(cursor);
      cursor = parent[cursor];
      guard += 1;
    }
    const closingEdge = parentEdge[reverseNodes[reverseNodes.length - 1]];
    if (cursor !== start || !closingEdge) continue;
    reverseEdges.push(closingEdge);

    const cycleNodes = reverseNodes.reverse().map(index => nodes[index]);
    cycleNodes.push(cycleNodes[0]);
    const cycleEdges = reverseEdges.reverse();
    if (cycleEdges.length < 2 || cycleEdges.length > maxHops) continue;
    const compoundedRate = cycleEdges.reduce((value, edge) => value * edge.effectiveRate, 1);
    if (!(compoundedRate > 1 + 1e-9)) continue;
    const key = normalizedCycleKey(cycleNodes);
    if (!key) continue;
    const candidate: AriesNegativeCycle = {
      nodes: cycleNodes,
      edgeIds: cycleEdges.map(edge => edge.id),
      compoundedRate,
      grossEdgeBps: (compoundedRate - 1) * 10_000,
      observedAt: Math.min(...cycleEdges.map(edge => edge.observedAt)),
    };
    const previous = cycles.get(key);
    if (!previous || candidate.grossEdgeBps > previous.grossEdgeBps) cycles.set(key, candidate);
  }

  return [...cycles.values()]
    .sort((left, right) => right.grossEdgeBps - left.grossEdgeBps)
    .slice(0, maxCycles);
}

/** Selects the measured size that maximizes dollars, while exposing local slope. */
export function optimizeAriesLiquidityCurve(points: readonly AriesLiquidityCurvePoint[]): AriesLiquidityCurveDecision {
  const valid = points
    .filter(point => point.notionalUsd > 0 && Number.isFinite(point.notionalUsd) && Number.isFinite(point.netProfitUsd) && Number.isFinite(point.netProfitBps))
    .sort((left, right) => left.notionalUsd - right.notionalUsd);
  if (valid.length === 0) {
    return {
      optimalNotionalUsd: 0,
      optimalNetProfitUsd: 0,
      optimalNetProfitBps: 0,
      maximumPositiveNotionalUsd: 0,
      marginalProfitPerDollar: null,
      curvePoints: 0,
    };
  }
  const positivePoints = valid.filter(point => point.netProfitUsd > 0);
  if (positivePoints.length === 0) {
    return {
      optimalNotionalUsd: 0,
      optimalNetProfitUsd: 0,
      optimalNetProfitBps: 0,
      maximumPositiveNotionalUsd: 0,
      marginalProfitPerDollar: null,
      curvePoints: valid.length,
    };
  }
  const best = positivePoints.reduce((winner, point) => point.netProfitUsd > winner.netProfitUsd ? point : winner);
  const index = valid.findIndex(point => point === best);
  const neighbor = index > 0 ? valid[index - 1] : index + 1 < valid.length ? valid[index + 1] : null;
  const marginalProfitPerDollar = neighbor && best.notionalUsd !== neighbor.notionalUsd
    ? (best.netProfitUsd - neighbor.netProfitUsd) / (best.notionalUsd - neighbor.notionalUsd)
    : null;
  return {
    optimalNotionalUsd: best.notionalUsd,
    optimalNetProfitUsd: best.netProfitUsd,
    optimalNetProfitBps: best.netProfitBps,
    maximumPositiveNotionalUsd: Math.max(...positivePoints.map(point => point.notionalUsd)),
    marginalProfitPerDollar: marginalProfitPerDollar !== null && Number.isFinite(marginalProfitPerDollar) ? marginalProfitPerDollar : null,
    curvePoints: valid.length,
  };
}

export function recordAriesRouteFormationObservation(observation: AriesRouteFormationObservation): void {
  if (!observation.routeId || !Number.isFinite(observation.observedAt) || observation.observedAt <= 0) return;
  const history = routeHistory.get(observation.routeId) || [];
  const last = history[history.length - 1];
  if (last && last.observedAt === observation.observedAt) history[history.length - 1] = { ...observation };
  else history.push({ ...observation });
  if (history.length > ROUTE_HISTORY_LIMIT) history.splice(0, history.length - ROUTE_HISTORY_LIMIT);
  routeHistory.set(observation.routeId, history);
}

function estimatePositiveHalfLifeMs(history: readonly AriesRouteFormationObservation[]): number {
  const completedRuns: number[] = [];
  let runStart: number | null = null;
  let previousAt: number | null = null;
  for (const observation of history) {
    const positiveNow = observation.netProfitBps !== null && observation.netProfitBps > 0;
    if (positiveNow && runStart === null) runStart = observation.observedAt;
    if (!positiveNow && runStart !== null) {
      completedRuns.push(Math.max(1, observation.observedAt - runStart));
      runStart = null;
    }
    previousAt = observation.observedAt;
  }
  if (runStart !== null && previousAt !== null && previousAt > runStart) completedRuns.push(previousAt - runStart);
  if (completedRuns.length === 0) {
    const intervals = history.slice(1).map((item, index) => item.observedAt - history[index].observedAt).filter(value => value > 0);
    const medianInterval = intervals.length > 0
      ? intervals.sort((a, b) => a - b)[Math.floor(intervals.length / 2)]
      : 5_000;
    return clamp(medianInterval * 4, 1_000, 5 * 60_000);
  }
  completedRuns.sort((a, b) => a - b);
  return clamp(completedRuns[Math.floor(completedRuns.length / 2)], 500, 10 * 60_000);
}

/**
 * Historical survival/VOI score used only to allocate quote work. It cannot
 * declare profitability or authorize execution.
 */
export function getAriesRouteFormationScore(
  routeId: string,
  options: { horizonMs?: number; economicConsequence?: number; quoteCost?: number } = {},
): AriesRouteFormationScore {
  const history = routeHistory.get(routeId) || [];
  const samples = history.length;
  const positives = history.filter(item => item.netProfitBps !== null && item.netProfitBps > 0);
  const positiveSamples = positives.length;
  const positiveProbability = samples > 0 ? (positiveSamples + 1) / (samples + 2) : 0.5;
  const estimatedHalfLifeMs = estimatePositiveHalfLifeMs(history);
  const horizonMs = clamp(options.horizonMs ?? 2_000, 100, 60_000);
  const survivalProbability = Math.pow(0.5, horizonMs / Math.max(1, estimatedHalfLifeMs));
  const latestPositive = positives[positives.length - 1];
  const economicConsequence = positive(options.economicConsequence ?? latestPositive?.netProfitBps ?? 0);
  const quoteCost = Math.max(1e-6, positive(options.quoteCost) || 1);
  const uncertainty = 4 * positiveProbability * (1 - positiveProbability);
  const valueOfInformation = (uncertainty * economicConsequence) / quoteCost;
  const meanPositiveEdge = positiveSamples > 0
    ? positives.reduce((sum, item) => sum + positive(item.netProfitBps ?? 0), 0) / positiveSamples
    : 0;
  const formationPriority = positiveProbability * survivalProbability * Math.log1p(meanPositiveEdge) + Math.log1p(valueOfInformation);
  const priorityMultiplier = clamp(0.75 + formationPriority / 3, 0.75, 3);
  return {
    routeId,
    samples,
    positiveSamples,
    positiveProbability,
    estimatedHalfLifeMs,
    survivalProbability,
    valueOfInformation,
    formationPriority,
    priorityMultiplier,
    authority: 'scan_priority_advisory_only',
    deterministicProfitAuthority: false,
    executionAuthority: false,
  };
}

export function calculateAriesFragmentationScore(input: AriesFragmentationInput): number {
  const dispersion = clamp(input.normalizedPriceDispersion, 0, 1);
  const liquidity = clamp(input.liquidityAsymmetry, 0, 1);
  const lag = clamp(input.updateLagAsymmetry, 0, 1);
  const flow = clamp(input.flowDivergence, 0, 1);
  return clamp(0.35 * dispersion + 0.25 * liquidity + 0.20 * lag + 0.20 * flow, 0, 1);
}

export function decomposeAriesEdge(input: AriesEdgeDecompositionInput): AriesEdgeDecomposition {
  const losses: Record<string, number> = {
    fees: positive(input.feeBps),
    impact: positive(input.impactBps),
    latency_decay: positive(input.latencyDecayBps),
    adverse_selection: positive(input.adverseSelectionBps),
    gas: positive(input.gasBps),
    relay: positive(input.relayBps),
    sizing: positive(input.sizingLossBps),
    routing: positive(input.routingLossBps),
    competitive_erosion: positive(input.competitiveErosionBps),
  };
  const modeledTerminalBps = input.grossEdgeBps - Object.values(losses).reduce((sum, value) => sum + value, 0);
  const realizedNetBps = input.realizedNetBps !== null && input.realizedNetBps !== undefined && Number.isFinite(input.realizedNetBps)
    ? input.realizedNetBps
    : null;
  const best = input.bestContemporaneousExecutableNetBps !== null && input.bestContemporaneousExecutableNetBps !== undefined && Number.isFinite(input.bestContemporaneousExecutableNetBps)
    ? input.bestContemporaneousExecutableNetBps
    : null;
  const captureRatio = realizedNetBps !== null && best !== null && best > 0 ? clamp(realizedNetBps / best, 0, 2) : null;
  const regretBps = realizedNetBps !== null && best !== null ? Math.max(0, best - realizedNetBps) : null;
  const rankedLosses = Object.entries(losses).sort((left, right) => right[1] - left[1]);
  const largest = rankedLosses[0] && rankedLosses[0][1] > 0 ? { source: rankedLosses[0][0], bps: rankedLosses[0][1] } : null;
  return { modeledTerminalBps, realizedNetBps, captureRatio, regretBps, largestModeledLoss: largest, losses };
}

export function getAriesEdgeFormationHistorySize(): number {
  let count = 0;
  for (const observations of routeHistory.values()) count += observations.length;
  return count;
}
