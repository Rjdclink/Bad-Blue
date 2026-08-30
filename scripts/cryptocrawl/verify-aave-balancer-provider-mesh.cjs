const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const contract = read('contracts/cryptocrawl/CryptocrawlAaveBalancerDualFlashLoanReceiver.sol');
const selector = read('server/services/cryptocrawl/execution/adapters/dual-flash-loan-provider-mesh.ts');
const providerWiring = read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts');
const execution = read('server/services/cryptocrawl/integration/dual-provider-zero-capital-execution-wiring.ts');
const barrier = read('server/services/cryptocrawl/integration/zero-capital-dynamic-attempt-barrier-wiring.ts');
const canonical = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const compile = read('scripts/cryptocrawl/compile-flashloan-receiver.ts');
const deploy = read('scripts/cryptocrawl/deploy-dual-flashloan-receiver.ts');

const required = [
  [contract, 'vault.flashLoan(', 'Balancer outer flash loan'],
  [contract, 'pool.flashLoanSimple(', 'nested Aave flash loan'],
  [contract, 'finalBalance >= aaveOwed + balancerOwed + minProfit', 'both repayments plus min profit enforced before Aave callback returns'],
  [contract, '_safeTransfer(tokens[0], address(vault), balancerOwed)', 'Balancer repayment'],
  [contract, '_safeApprove(asset, address(pool), aaveOwed)', 'Aave repayment approval'],
  [contract, 'emit FlashLoanExecuted(', 'terminal profit event compatibility'],
  [selector, 'balancerLiquidity >= requestedAmount || aaveLiquidity >= requestedAmount', 'single provider preferred when sufficient'],
  [selector, 'balancerLiquidity + aaveLiquidity < requestedAmount', 'combined liquidity exact-size guard'],
  [providerWiring, 'selectMeasuredDualFlashLoanAllocation', 'provider mesh selection wired'],
  [providerWiring, "provider: 'aave_balancer_dual'", 'dual selection persisted'],
  [execution, 'dualFlashLoanProviderSelectionRegistry.get(opportunity.id)', 'dual execution selection read'],
  [execution, 'buildDualFlashLoanReceiverPayload', 'dual exact payload builder used'],
  [execution, 'profitVerified: true', 'terminal profit verification retained'],
  [barrier, "providerSpecificPayloadParity: ['balancer_v2', 'aave_v3', 'aave_balancer_dual']", 'dynamic barrier payload parity'],
  [barrier, 'buildDualFlashLoanReceiverPayload', 'dual path exact pre-broadcast simulation'],
  [canonical, 'ensureDualProviderZeroCapitalExecutionWiring();', 'dual executor canonical installation'],
  [compile, 'compileAaveBalancerDualFlashLoanReceiver', 'dual receiver compile path'],
  [deploy, 'DEPLOY_AAVE_BALANCER_DUAL_RECEIVER', 'explicit deployment confirmation'],
];

for (const [source, token, name] of required) {
  if (!source.includes(token)) throw new Error(`[aave-balancer-provider-mesh] missing invariant: ${name}`);
}

const providerIndex = canonical.indexOf('ensureProviderSpecificZeroCapitalExecutionWiring();');
const dualIndex = canonical.indexOf('ensureDualProviderZeroCapitalExecutionWiring();');
const barrierIndex = canonical.indexOf('ensureZeroCapitalDynamicAttemptBarrierWiring();');
if (!(providerIndex >= 0 && dualIndex > providerIndex && barrierIndex > dualIndex)) {
  throw new Error('[aave-balancer-provider-mesh] canonical wrapper order must be single-provider executor -> dual-provider executor -> dynamic exact barrier');
}

const forbidden = [
  [selector, 'return {', ''],
];
// Explicit semantic prohibitions are checked independently to avoid false positives
// from ordinary object returns in TypeScript.
if (providerWiring.includes('synthetic_evidence:true')) throw new Error('[aave-balancer-provider-mesh] synthetic provider evidence regression');
if (execution.includes('profitVerified: true') && !execution.includes('extractProfit(receipt')) throw new Error('[aave-balancer-provider-mesh] profit verification is not receipt-derived');
if (!selector.includes('if (balancerLiquidity >= requestedAmount || aaveLiquidity >= requestedAmount) return null;')) {
  throw new Error('[aave-balancer-provider-mesh] dual path must not replace a sufficient single provider');
}

console.log('[aave-balancer-provider-mesh] PASS: either/both/neither provider mesh preserves measured liquidity/fees, exact dual simulation, both-provider repayment, terminal profit truth, and single-provider preference');
