export type ExecutionReadinessMetric =
  | 'closestFeeGapBps'
  | 'bestExpectedGapBps'
  | 'maxFeeAgeMs'
  | 'feeFreshnessShare'
  | 'stablecoinClosestGapBps'
  | 'maxQuoteAgeMs'
  | 'maxMakerFillProbability'
  | 'maxQueueRiskPenaltyBps'
  | 'inventoryAssetCount'
  | 'inventoryVenueCount'
  | 'inventoryFreshnessShare'
  | 'governanceCanExecute'
  | 'stageNumber'
  | 'eligibleCandidates'
  | 'expiringCandidates'
  | 'providerFailureRate'
  | 'providerLatencyMs'
  | 'providerQuality'
  | 'observedModes'
  | 'positiveModes';

export type ExecutionReadinessLever =
  | 'edgeRetention'
  | 'candidateRevalidation'
  | 'feeRefreshInterval'
  | 'stablecoinFocus'
  | 'makerProbe'
  | 'inventoryRefreshInterval'
  | 'executionPrewarm'
  | 'expiryUrgency'
  | 'providerFailover'
  | 'bookPrewarm';

export interface ExecutionReadinessProfitabilityInput {
  closestFeeGapBps?: number | null;
  bestExpectedGapBps?: number | null;
  maxFeeAgeMs?: number | null;
  feeFreshnessShare?: number | null;
  stablecoinClosestGapBps?: number | null;
  maxQuoteAgeMs?: number | null;
  maxMakerFillProbability?: number | null;
  maxQueueRiskPenaltyBps?: number | null;
  inventoryAssetCount?: number | null;
  inventoryVenueCount?: number | null;
  inventoryFreshnessShare?: number | null;
  governanceCanExecute?: number | null;
  stageNumber?: number | null;
  eligibleCandidates?: number | null;
  expiringCandidates?: number | null;
  providerFailureRate?: number | null;
  providerLatencyMs?: number | null;
  providerQuality?: number | null;
  observedModes?: number | null;
  positiveModes?: number | null;
}

export interface ExecutionReadinessRule {
  id: number;
  key: string;
  name: string;
  metric: ExecutionReadinessMetric;
  direction: 'lte' | 'gte';
  threshold: number;
  lever: ExecutionReadinessLever;
  factor: number;
  intent: string;
}

interface RuleFamily {
  key: string;
  label: string;
  metric: ExecutionReadinessMetric;
  direction: 'lte' | 'gte';
  thresholds: readonly number[];
  lever: ExecutionReadinessLever;
  factor: number;
  intent: string;
}

const FAMILIES: readonly RuleFamily[] = [
  { key: 'near_edge_retention', label: 'Near-edge retention', metric: 'closestFeeGapBps', direction: 'lte', thresholds: [0.25,0.5,1,2,3,5,8,13,21,34], lever: 'edgeRetention', factor: 1.08, intent: 'Keep freshly remeasured near-positive CEX symbols warm long enough to survive transient spread decay.' },
  { key: 'expected_edge_revalidation', label: 'Expected-edge revalidation', metric: 'bestExpectedGapBps', direction: 'lte', thresholds: [0.1,0.25,0.5,1,2,3,5,8,13,21], lever: 'candidateRevalidation', factor: 1.07, intent: 'Revalidate candidates whose expected fee-adjusted gap is close enough for current microstructure to change the sign.' },
  { key: 'fee_age_refresh', label: 'Authenticated fee-age refresh', metric: 'maxFeeAgeMs', direction: 'gte', thresholds: [5000,10000,15000,30000,45000,60000,90000,120000,180000,240000], lever: 'feeRefreshInterval', factor: 0.94, intent: 'Shorten authenticated fee refresh cadence as evidence ages.' },
  { key: 'fee_freshness_deficit', label: 'Fee-freshness deficit correction', metric: 'feeFreshnessShare', direction: 'lte', thresholds: [0.99,0.98,0.95,0.90,0.85,0.80,0.70,0.60,0.50,0.40], lever: 'feeRefreshInterval', factor: 0.95, intent: 'Protect near-edge decisions from stale fee tiers by increasing real refresh frequency.' },
  { key: 'stablecoin_microgap', label: 'Stablecoin micro-gap focus', metric: 'stablecoinClosestGapBps', direction: 'lte', thresholds: [0.25,0.5,1,2,3,5,8,13,21,34], lever: 'stablecoinFocus', factor: 1.07, intent: 'Favor stablecoin lanes where low fees make small spreads economically relevant.' },
  { key: 'quote_age_revalidation', label: 'Quote-age revalidation', metric: 'maxQuoteAgeMs', direction: 'gte', thresholds: [250,500,750,1000,1500,2000,3000,4000,5000,7500], lever: 'candidateRevalidation', factor: 1.06, intent: 'Revalidate books before stale quote age can turn an apparent edge into a false positive.' },
  { key: 'maker_fill_confidence', label: 'Maker-fill confidence focus', metric: 'maxMakerFillProbability', direction: 'gte', thresholds: [0.10,0.20,0.30,0.40,0.50,0.60,0.70,0.80,0.90,0.95], lever: 'makerProbe', factor: 1.045, intent: 'Spend more passive-mode measurement where queue evidence says a maker leg is plausibly fillable.' },
  { key: 'queue_risk_guard', label: 'Maker queue-risk guard', metric: 'maxQueueRiskPenaltyBps', direction: 'gte', thresholds: [0.5,1,2,3,5,8,13,21,34,55], lever: 'makerProbe', factor: 0.96, intent: 'Contract passive probing when measured queue risk consumes the apparent fee savings.' },
  { key: 'inventory_asset_hydration', label: 'Inventory asset hydration', metric: 'inventoryAssetCount', direction: 'lte', thresholds: [0,1,2,3,5,8,13,21,34,55], lever: 'inventoryRefreshInterval', factor: 0.94, intent: 'Refresh authenticated balances faster when the local inventory ledger is sparse.' },
  { key: 'inventory_venue_hydration', label: 'Inventory venue hydration', metric: 'inventoryVenueCount', direction: 'lte', thresholds: [0,1,2,3,4,5,6,7,8,9], lever: 'inventoryRefreshInterval', factor: 0.95, intent: 'Hydrate executable venues before a profitable opportunity pays private-balance latency.' },
  { key: 'inventory_freshness', label: 'Inventory freshness correction', metric: 'inventoryFreshnessShare', direction: 'lte', thresholds: [0.99,0.98,0.95,0.90,0.85,0.80,0.70,0.60,0.50,0.40], lever: 'inventoryRefreshInterval', factor: 0.95, intent: 'Keep spendable balance evidence current without treating stale balances as executable capacity.' },
  { key: 'governance_execution_prewarm', label: 'Governed execution prewarm', metric: 'governanceCanExecute', direction: 'gte', thresholds: [0.10,0.20,0.30,0.40,0.50,0.60,0.70,0.80,0.90,1.0], lever: 'executionPrewarm', factor: 1.055, intent: 'When StageManager permits execution, prewarm evidence while leaving final order authority unchanged.' },
  { key: 'stage_execution_prewarm', label: 'Stage-aware execution prewarm', metric: 'stageNumber', direction: 'gte', thresholds: [1,2,3,4,5,6,7,8,9,10], lever: 'executionPrewarm', factor: 1.04, intent: 'Scale preparation with the governed stage while preserving each stage limit.' },
  { key: 'eligible_candidate_prewarm', label: 'Eligible-candidate execution prewarm', metric: 'eligibleCandidates', direction: 'gte', thresholds: [1,2,3,4,5,8,13,21,34,55], lever: 'executionPrewarm', factor: 1.06, intent: 'Reduce evidence-to-order latency only after canonical candidates are already eligible.' },
  { key: 'expiry_urgency', label: 'Candidate-expiry urgency', metric: 'expiringCandidates', direction: 'gte', thresholds: [1,2,3,4,5,8,13,21,34,55], lever: 'expiryUrgency', factor: 1.06, intent: 'Prioritize fresh revalidation for candidates approaching expiry instead of extending stale evidence.' },
  { key: 'provider_failure_failover', label: 'Provider failure failover', metric: 'providerFailureRate', direction: 'gte', thresholds: [0.01,0.02,0.05,0.08,0.10,0.15,0.20,0.30,0.40,0.50], lever: 'providerFailover', factor: 1.06, intent: 'Increase bounded alternate-provider preparation when measured failures rise.' },
  { key: 'provider_latency_failover', label: 'Provider latency failover', metric: 'providerLatencyMs', direction: 'gte', thresholds: [1,2,5,10,20,40,80,160,320,640], lever: 'providerFailover', factor: 1.05, intent: 'Prefer already-implemented alternate market-data lanes when measured latency rises.' },
  { key: 'provider_quality_prewarm', label: 'Provider-quality book prewarm', metric: 'providerQuality', direction: 'gte', thresholds: [0.10,0.20,0.30,0.40,0.50,0.60,0.70,0.80,0.90,0.95], lever: 'bookPrewarm', factor: 1.04, intent: 'Use healthy provider capacity to keep more executable books warm.' },
  { key: 'mode_surface_recovery', label: 'Mode-surface recovery', metric: 'observedModes', direction: 'lte', thresholds: [2,4,6,8,12,16,24,32,48,64], lever: 'bookPrewarm', factor: 1.05, intent: 'Recover books and observations when the measured CEX mode surface collapses.' },
  { key: 'positive_edge_execution_hold', label: 'Positive-edge execution hold', metric: 'positiveModes', direction: 'gte', thresholds: [1,2,3,4,5,8,13,21,34,55], lever: 'executionPrewarm', factor: 1.07, intent: 'Hold preparation on measured positive observations through canonical verification without granting execution authority.' },
] as const;

if (FAMILIES.length !== 20 || FAMILIES.some(family => family.thresholds.length !== 10)) {
  throw new Error('Execution-readiness profitability policy requires 20 ten-level rule families');
}

export const EXECUTION_READINESS_PROFITABILITY_RULES: readonly ExecutionReadinessRule[] = FAMILIES.flatMap((family, familyIndex) =>
  family.thresholds.map((threshold, levelIndex) => ({
    id: 101 + familyIndex * 10 + levelIndex,
    key: `${family.key}_${String(levelIndex + 1).padStart(2, '0')}`,
    name: `${family.label} level ${levelIndex + 1}`,
    metric: family.metric,
    direction: family.direction,
    threshold,
    lever: family.lever,
    factor: family.factor,
    intent: family.intent,
  })),
);

if (EXECUTION_READINESS_PROFITABILITY_RULES.length !== 200) {
  throw new Error(`Execution-readiness profitability catalog must contain exactly 200 rules; found ${EXECUTION_READINESS_PROFITABILITY_RULES.length}`);
}
if (new Set(EXECUTION_READINESS_PROFITABILITY_RULES.map(rule => rule.id)).size !== 200
  || new Set(EXECUTION_READINESS_PROFITABILITY_RULES.map(rule => rule.key)).size !== 200) {
  throw new Error('Execution-readiness profitability catalog contains duplicate ids or keys');
}

export interface ExecutionReadinessProfitabilityPlan {
  catalogSize: 200;
  activeRuleCount: number;
  activeRuleIds: number[];
  activeRuleKeys: string[];
  edgeRetentionMultiplier: number;
  candidateRevalidationMultiplier: number;
  feeRefreshIntervalMultiplier: number;
  stablecoinFocusMultiplier: number;
  makerProbeMultiplier: number;
  inventoryRefreshIntervalMultiplier: number;
  executionPrewarmMultiplier: number;
  expiryUrgencyMultiplier: number;
  providerFailoverMultiplier: number;
  bookPrewarmMultiplier: number;
  authority: 'measured_execution_readiness_optimization_only';
  executionAuthority: false;
  bypassGovernanceAllowed: false;
  bypassInventoryAllowed: false;
  bypassPositiveNetAllowed: false;
  syntheticEvidenceAllowed: false;
}

const BOUNDS: Record<ExecutionReadinessLever, readonly [number, number]> = {
  edgeRetention: [0.80, 3.00],
  candidateRevalidation: [0.75, 3.00],
  feeRefreshInterval: [0.20, 1.50],
  stablecoinFocus: [0.75, 2.50],
  makerProbe: [0.50, 2.20],
  inventoryRefreshInterval: [0.20, 1.50],
  executionPrewarm: [0.75, 3.00],
  expiryUrgency: [0.75, 2.50],
  providerFailover: [0.75, 2.50],
  bookPrewarm: [0.75, 2.50],
};

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function matches(input: ExecutionReadinessProfitabilityInput, rule: ExecutionReadinessRule): boolean {
  const value = finite(input[rule.metric]);
  if (value === null) return false;
  return rule.direction === 'lte' ? value <= rule.threshold : value >= rule.threshold;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function buildExecutionReadinessProfitabilityPlan(input: ExecutionReadinessProfitabilityInput): ExecutionReadinessProfitabilityPlan {
  const factors = Object.fromEntries((Object.keys(BOUNDS) as ExecutionReadinessLever[]).map(lever => [lever, 1])) as Record<ExecutionReadinessLever, number>;
  const active: ExecutionReadinessRule[] = [];
  for (const rule of EXECUTION_READINESS_PROFITABILITY_RULES) {
    if (!matches(input, rule)) continue;
    active.push(rule);
    factors[rule.lever] *= rule.factor;
  }
  for (const lever of Object.keys(factors) as ExecutionReadinessLever[]) {
    const [min, max] = BOUNDS[lever];
    factors[lever] = clamp(factors[lever], min, max);
  }
  return {
    catalogSize: 200,
    activeRuleCount: active.length,
    activeRuleIds: active.map(rule => rule.id),
    activeRuleKeys: active.map(rule => rule.key),
    edgeRetentionMultiplier: factors.edgeRetention,
    candidateRevalidationMultiplier: factors.candidateRevalidation,
    feeRefreshIntervalMultiplier: factors.feeRefreshInterval,
    stablecoinFocusMultiplier: factors.stablecoinFocus,
    makerProbeMultiplier: factors.makerProbe,
    inventoryRefreshIntervalMultiplier: factors.inventoryRefreshInterval,
    executionPrewarmMultiplier: factors.executionPrewarm,
    expiryUrgencyMultiplier: factors.expiryUrgency,
    providerFailoverMultiplier: factors.providerFailover,
    bookPrewarmMultiplier: factors.bookPrewarm,
    authority: 'measured_execution_readiness_optimization_only',
    executionAuthority: false,
    bypassGovernanceAllowed: false,
    bypassInventoryAllowed: false,
    bypassPositiveNetAllowed: false,
    syntheticEvidenceAllowed: false,
  };
}
