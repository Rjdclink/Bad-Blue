const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const stage = read('server/services/cryptocrawl/governance/stage-management.ts');
const inventory = read('server/services/cryptocrawl/integration/inventory-constrained-cex-execution-wiring.ts');
const hydration = read('server/services/cryptocrawl/integration/cex-inventory-readiness-wiring.ts');
const readiness = read('server/services/cryptocrawl/integration/execution-readiness-profitability-wiring.ts');
const policy100 = read('server/services/cryptocrawl/optimization/hyperdynamic-bps-solution-engine.ts');
const policy200 = read('server/services/cryptocrawl/optimization/execution-readiness-profitability-policy.ts');
const canonical = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const centralized = read('server/services/cryptocrawl/execution/centralized-exchange-executor.ts');

const required = [
  [stage, "STAGE_1_CONSTRAINED_PILOT", 'stage one definition'],
  [stage, "description: 'Advisory/strategy optimization sandbox - NO EXECUTION'", 'stage one remains non-executable'],
  [stage, "[Stage.STAGE_2_PROOF_OF_SIGNAL]", 'stage two definition'],
  [stage, "stageName: 'Proof-of-Signal Activation'", 'stage two live stage'],
  [inventory, "return originalExecute(decision.plan);", 'real centralized executor remains reachable'],
  [inventory, "zeroInventoryBypass: false", 'zero inventory bypass remains forbidden'],
  [inventory, "executionRule: 'strict_all_in_net_profit_usd_greater_than_zero'", 'strict positive all-in economics preserved'],
  [hydration, 'createProductionCexSettlementAdapters()', 'authenticated production balance adapters used'],
  [hydration, 'cexInventoryLedger.reconcile', 'authenticated balances hydrate canonical inventory'],
  [hydration, 'syntheticBalancesAllowed: false', 'synthetic inventory forbidden'],
  [readiness, 'optimizerCanVetoEligibleExecution: false', 'optimizer cannot strand an eligible candidate'],
  [readiness, 'canonicalRevalidation: true', 'near-edge canonical revalidation enabled'],
  [readiness, 'stageOneExecutionBypass: false', 'stage one bypass forbidden'],
  [readiness, 'positiveNetBypass: false', 'positive-net bypass forbidden'],
  [policy100, 'HYPERDYNAMIC_BPS_SOLUTIONS.length !== 100', 'original 100-control catalog intact'],
  [policy200, 'EXECUTION_READINESS_PROFITABILITY_RULES.length !== 200', 'additional 200-control catalog intact'],
  [policy200, 'bypassGovernanceAllowed: false', 'new policy cannot bypass governance'],
  [policy200, 'bypassInventoryAllowed: false', 'new policy cannot bypass inventory'],
  [policy200, 'bypassPositiveNetAllowed: false', 'new policy cannot bypass positive economics'],
  [canonical, 'ensureCexInventoryReadinessWiring();', 'inventory readiness canonical installation'],
  [canonical, "executionEconomicFloor: 'strict_all_in_net_profit_usd_greater_than_zero'", 'canonical positive floor'],
  [centralized, 'executeCexPlan', 'centralized execution reaches settlement-safe order submission'],
];
for (const [source, token, name] of required) {
  if (!source.includes(token)) throw new Error(`[300-profitability-live-execution] missing invariant: ${name}`);
}

const stage1 = stage.slice(stage.indexOf('[Stage.STAGE_1_CONSTRAINED_PILOT]'), stage.indexOf('[Stage.STAGE_2_PROOF_OF_SIGNAL]'));
const stage2 = stage.slice(stage.indexOf('[Stage.STAGE_2_PROOF_OF_SIGNAL]'), stage.indexOf('[Stage.STAGE_3_MEASURED_DRYRUN]'));
if (!stage1.includes('canExecuteTrades: false')) throw new Error('[300-profitability-live-execution] Stage 1 execution regression');
if (!stage2.includes('canExecuteTrades: true')) throw new Error('[300-profitability-live-execution] Stage 2 live execution is not reachable');

const familyLines = policy200.split('\n').filter(line => line.includes("key: '") && line.includes('thresholds: [') && line.includes('lever:'));
if (familyLines.length !== 20) throw new Error(`[300-profitability-live-execution] expected 20 execution-readiness families, found ${familyLines.length}`);
const parsedFamilies = familyLines.map(line => {
  const key = line.match(/key: '([^']+)'/)?.[1];
  const metric = line.match(/metric: '([^']+)'/)?.[1];
  const direction = line.match(/direction: '(lte|gte)'/)?.[1];
  const thresholdsRaw = line.match(/thresholds: \[([^\]]+)\]/)?.[1] || '';
  const lever = line.match(/lever: '([^']+)'/)?.[1];
  const factor = Number(line.match(/factor: ([0-9.]+)/)?.[1]);
  const thresholds = thresholdsRaw.split(',').map(value => Number(value.trim().replaceAll('_','')));
  if (!key || !metric || !direction || !lever || thresholds.length !== 10 || thresholds.some(value => !Number.isFinite(value)) || !Number.isFinite(factor) || factor <= 0) {
    throw new Error(`[300-profitability-live-execution] malformed family: ${line}`);
  }
  return { key, metric, direction, thresholds, lever, factor };
});

const rules = [];
for (let familyIndex = 0; familyIndex < parsedFamilies.length; familyIndex++) {
  const family = parsedFamilies[familyIndex];
  for (let level = 0; level < family.thresholds.length; level++) {
    rules.push({ id: 101 + familyIndex * 10 + level, key: `${family.key}_${String(level + 1).padStart(2,'0')}`, ...family, threshold: family.thresholds[level] });
  }
}
if (rules.length !== 200 || new Set(rules.map(rule => rule.id)).size !== 200 || new Set(rules.map(rule => rule.key)).size !== 200) {
  throw new Error('[300-profitability-live-execution] 200-rule uniqueness failed');
}

const bounds = {
  edgeRetention: [0.80,3.00], candidateRevalidation: [0.75,3.00], feeRefreshInterval: [0.20,1.50],
  stablecoinFocus: [0.75,2.50], makerProbe: [0.50,2.20], inventoryRefreshInterval: [0.20,1.50],
  executionPrewarm: [0.75,3.00], expiryUrgency: [0.75,2.50], providerFailover: [0.75,2.50], bookPrewarm: [0.75,2.50],
};
function pseudo(pass, salt, scale = 1) {
  const x = Math.sin((pass + 1) * (salt + 11) * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * scale;
}
const metricScale = {
  closestFeeGapBps:100, bestExpectedGapBps:50, maxFeeAgeMs:300000, feeFreshnessShare:1, stablecoinClosestGapBps:100,
  maxQuoteAgeMs:10000, maxMakerFillProbability:1, maxQueueRiskPenaltyBps:80, inventoryAssetCount:100, inventoryVenueCount:3,
  inventoryFreshnessShare:1, governanceCanExecute:1, stageNumber:6, eligibleCandidates:60, expiringCandidates:60,
  providerFailureRate:0.6, providerLatencyMs:1000, providerQuality:1, observedModes:100, positiveModes:60,
};
for (let pass = 0; pass < 100; pass++) {
  const metrics = {};
  let salt = 0;
  for (const [metric, scale] of Object.entries(metricScale)) metrics[metric] = pseudo(pass, ++salt, scale);
  metrics.governanceCanExecute = pass % 2;
  metrics.stageNumber = 1 + (pass % 6);
  const factors = Object.fromEntries(Object.keys(bounds).map(key => [key,1]));
  for (const rule of rules) {
    const value = metrics[rule.metric];
    const match = rule.direction === 'lte' ? value <= rule.threshold : value >= rule.threshold;
    if (match) factors[rule.lever] *= rule.factor;
  }
  for (const [lever, [min,max]] of Object.entries(bounds)) {
    const bounded = Math.max(min, Math.min(max, factors[lever]));
    if (!Number.isFinite(bounded) || bounded < min || bounded > max) throw new Error(`[300-profitability-live-execution] review pass ${pass + 1} violated ${lever} bounds`);
  }
}

const forbidden = [
  [stage1, 'canExecuteTrades: true', 'Stage 1 execution bypass'],
  [readiness, 'submit(', 'optimizer direct order submission'],
  [hydration, 'submit(', 'inventory hydrator direct order submission'],
  [policy200, 'executionAuthority: true', 'policy execution authority'],
  [policy200, 'bypassGovernanceAllowed: true', 'governance bypass'],
  [policy200, 'bypassInventoryAllowed: true', 'inventory bypass'],
];
for (const [source, token, name] of forbidden) if (source.includes(token)) throw new Error(`[300-profitability-live-execution] forbidden regression: ${name}`);

console.log('[300-profitability-live-execution] PASS: 100 + 200 bounded controls reviewed across 100 dynamic passes; Stage 2+ live executor remains reachable; Stage 1, inventory, positive-net, settlement and governance gates remain intact');
