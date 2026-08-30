const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const stage = read('server/services/cryptocrawl/governance/stage-management.ts');
const inventory = read('server/services/cryptocrawl/integration/inventory-constrained-cex-execution-wiring.ts');
const hydration = read('server/services/cryptocrawl/integration/cex-inventory-readiness-wiring.ts');
const readiness = read('server/services/cryptocrawl/integration/execution-readiness-profitability-wiring.ts');
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
  [policy200, 'EXECUTION_READINESS_PROFITABILITY_RULES.length !== 200', 'additional 200-control catalog intact'],
  [policy200, 'bypassGovernanceAllowed: false', 'new policy cannot bypass governance'],
  [policy200, 'bypassInventoryAllowed: false', 'new policy cannot bypass inventory'],
  [policy200, 'bypassPositiveNetAllowed: false', 'new policy cannot bypass positive economics'],
  [canonical, 'ensureCexInventoryReadinessWiring();', 'inventory readiness canonical installation'],
  [canonical, 'ensureExecutionReadinessProfitabilityWiring();', 'execution-readiness optimizer canonical installation'],
  [canonical, "executionEconomicFloor: 'strict_all_in_net_profit_usd_greater_than_zero'", 'canonical positive floor'],
  [centralized, 'executeCexPlan', 'centralized execution reaches settlement-safe order submission'],
];
for (const [source, token, name] of required) {
  if (!source.includes(token)) throw new Error(`[300-required-isolation] missing invariant: ${name}`);
}
console.log('[300-required-isolation] PASS: all required source invariants are present');
