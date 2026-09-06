const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const contract = read('contracts/cryptocrawl/CryptocrawlAaveBalancerDualFlashLoanReceiver.sol');
const selector = read('server/services/cryptocrawl/execution/adapters/dual-flash-loan-provider-mesh.ts');
const providerWiring = read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts');
const executor = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');
const barrier = read('server/services/cryptocrawl/integration/zero-capital-dynamic-attempt-barrier-wiring.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const compile = read('scripts/cryptocrawl/compile-flashloan-receiver.ts');
const deploy = read('scripts/cryptocrawl/deploy-dual-flashloan-receiver.ts');

const required = [
  [contract, 'vault.flashLoan(', 'Balancer outer flash loan'],
  [contract, 'pool.flashLoanSimple(', 'nested Aave flash loan'],
  [contract, 'finalBalance >= aaveOwed + balancerOwed + minProfit', 'both repayments plus min profit enforced'],
  [contract, '_safeTransfer(tokens[0], address(vault), balancerOwed)', 'Balancer repayment'],
  [contract, '_safeApprove(asset, address(pool), aaveOwed)', 'Aave repayment approval'],
  [contract, 'emit FlashLoanExecuted(', 'terminal profit event'],
  [selector, 'balancerLiquidity + aaveLiquidity < requestedAmount', 'combined liquidity exact-size guard'],
  [selector, 'bestSingleProviderFee', 'best executable single-provider fee comparison'],
  [selector, "'fee_split_beats_single_provider'", 'partial low-fee liquidity can compress provider BPS'],
  [providerWiring, 'selectMeasuredDualFlashLoanAllocation', 'provider mesh selection wired'],
  [providerWiring, "provider: 'aave_balancer_dual'", 'dual selection persisted'],
  [executor, 'flashLoanProviderSelectionRegistry.get(opportunity.id)', 'single provider-selection registry read'],
  [executor, "selection.kind === 'dual'", 'dual selection handled by canonical executor'],
  [executor, 'buildDualFlashLoanReceiverPayload', 'dual exact payload builder used'],
  [executor, 'extractProfit(receipt', 'terminal profit is receipt-derived'],
  [executor, 'evaluateZeroCapitalDynamicAttemptBarrier', 'exact pre-broadcast barrier is inside canonical route'],
  [executor, 'getProvenZeroCapitalGasFundingDecision', 'strict gas provenance is required'],
  [scheduler, 'executeCanonicalZeroCapitalOpportunity', 'canonical parent scheduler owns invocation'],
  [compile, 'compileAaveBalancerDualFlashLoanReceiver', 'dual receiver compile path'],
  [deploy, 'DEPLOY_AAVE_BALANCER_DUAL_RECEIVER', 'explicit deployment confirmation'],
];
for (const [source, token, name] of required) {
  if (!source.includes(token)) throw new Error(`[aave-balancer-provider-mesh] missing invariant: ${name}`);
}
if (providerWiring.includes('synthetic_evidence:true')) throw new Error('[aave-balancer-provider-mesh] synthetic provider evidence regression');
if (!selector.includes('if (balancerAmount <= 0n || aaveAmount <= 0n) return null;')) throw new Error('[aave-balancer-provider-mesh] dual path must not add a second provider when one provider funds the whole exact size');
if (!selector.includes('if (bestSingleProviderFee !== null && totalFee >= bestSingleProviderFee) return null;')) throw new Error('[aave-balancer-provider-mesh] dual path must not replace an equal-or-cheaper executable single-provider fee surface');
if (barrier.includes('executeAndRecord =')) throw new Error('[aave-balancer-provider-mesh] pre-broadcast validation must not monkeypatch execution');

console.log('[aave-balancer-provider-mesh] PASS: measured single/dual provider selection, exact canonical pre-broadcast validation, atomic repayment, terminal receipt profit truth, and single-parent-scheduler execution invariants passed');
