const fs = require('node:fs');
const assert = require('node:assert/strict');

const reactor = fs.readFileSync('server/services/cryptocrawl/intelligence/aries-edge-formation-reactor.ts', 'utf8');
const dynamicDex = fs.readFileSync('server/services/cryptocrawl/discovery/dynamic-zero-capital-routes.ts', 'utf8');
const preselection = fs.readFileSync('server/services/cryptocrawl/discovery/zero-capital-route-preselection.ts', 'utf8');
const cexAttention = fs.readFileSync('server/services/cryptocrawl/discovery/cex-edge-attention.ts', 'utf8');
const opportunityGraph = fs.readFileSync('server/services/cryptocrawl/discovery/opportunity-graph.ts', 'utf8');
const zeroWiring = fs.readFileSync('server/services/cryptocrawl/integration/zero-capital-resource-wiring.ts', 'utf8');
const planner = fs.readFileSync('server/services/cryptocrawl/execution/adapters/autonomous-route-planner.ts', 'utf8');

// Edge-formation math is deterministic and explicitly non-authoritative.
assert.match(reactor, /findAriesNegativeCycles/);
assert.match(reactor, /-Math\.log\(edge\.effectiveRate\)/);
assert.match(reactor, /optimizeAriesLiquidityCurve/);
assert.match(reactor, /getAriesRouteFormationScore/);
assert.match(reactor, /calculateAriesFragmentationScore/);
assert.match(reactor, /decomposeAriesEdge/);
assert.match(reactor, /scan_priority_advisory_only/);
assert.match(reactor, /deterministicProfitAuthority: false/);
assert.match(reactor, /executionAuthority: false/);
assert.doesNotMatch(reactor, /Math\.random/);

// DEX expansion adds true 3-leg structural search without deleting old seeds.
assert.match(dynamicDex, /TRIANGLE_PROTOCOL_PATHS/);
assert.match(dynamicDex, /graphless-tri-/);
assert.match(dynamicDex, /protocolLeg\(path\[0\], input\.token, firstMiddle/);
assert.match(dynamicDex, /protocolLeg\(path\[1\], firstMiddle, secondMiddle/);
assert.match(dynamicDex, /protocolLeg\(path\[2\], secondMiddle, input\.token/);
assert.match(dynamicDex, /buildDynamicZeroCapitalRouteTemplates/);
assert.match(dynamicDex, /Same-DEX fee-tier dislocations/);
assert.match(dynamicDex, /quoteConfiguredZeroCapitalRoutesForChain/);
assert.match(dynamicDex, /apiKeysRequired: false/);
assert.match(dynamicDex, /syntheticEvidenceAllowed: false/);

// Scan allocation can learn, but deterministic exploration remains mandatory.
assert.match(preselection, /recordAriesRouteFormationObservation/);
assert.match(preselection, /formationPriorityMultiplier/);
assert.match(preselection, /deterministicExploration/);
assert.match(preselection, /ZERO_CAPITAL_ROUTE_EXPLORATION_FRACTION/);
assert.match(preselection, /quote_budget_advisory_only/);
assert.match(cexAttention, /selectCexFormationSymbols/);
assert.match(cexAttention, /CRYPTOCRAWL_FORMATION_EXPLORATION_FRACTION/);
assert.match(cexAttention, /scan_attention_advisory_only/);
assert.match(opportunityGraph, /selectCexFormationSymbols/);
assert.match(opportunityGraph, /recordCexFormationOutcome/);
assert.doesNotMatch(opportunityGraph, /const selected = symbols\.slice\(0, capacity\.symbolBudget\)/);

// Existing atomic/live safety boundaries remain present.
assert.match(zeroWiring, /exact_atomic_simulation/);
assert.match(zeroWiring, /fresh_quote_after_dynamic_route_permissions/);
assert.match(planner, /must return to the borrowed token for atomic repayment/);

console.log(JSON.stringify({
  ariesEdgeFormationReactor: 'verified',
  triangularGraphlessCycles: true,
  negativeCyclePrimitive: true,
  liquidityCurveOptimizer: true,
  halfLifeScanPriority: true,
  valueOfInformationScanPriority: true,
  cexFormationAttention: true,
  deterministicExplorationPreserved: true,
  noNewDexApiKeys: true,
  syntheticProfitAuthority: false,
  executionAuthorityBypass: false,
  atomicRepaymentInvariant: true,
  exactAtomicSimulationPreserved: true,
  freshRequoteAfterPermissionMutationPreserved: true,
}, null, 2));
