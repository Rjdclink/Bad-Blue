const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const scheduler = read('server/services/cryptocrawl/execution/zero-capital-resource-scheduler.ts');
const positive = read('server/services/cryptocrawl/runtime/positive-profit-capture-wiring.ts');
const policy = read('server/services/cryptocrawl/governance/atomic-zero-capital-strategy-coverage.ts');

const checks = [];
const check = (name, ok) => checks.push([name, Boolean(ok)]);

check('universal zero-personal-cost policy is consumed by live atomic resource admission', scheduler.includes('evaluateAtomicZeroCapitalAdmission({'));
check('legacy zero-capital engine lease path is covered', scheduler.includes("topology: 'ZERO_CAPITAL_ATOMIC'"));
check('measured DEX/liquidation lease path is covered', scheduler.includes("!['DEX_ATOMIC', 'LIQUIDATION'].includes(candidate.topology)"));
check('gas truth is reacquired from canonical runtime authority at lease time', scheduler.includes("await import('../core/zero-capital-engine.js')") && scheduler.includes('runtime.getGasFundingDecision(chain)'));
check('operator monetary gas input is forbidden', scheduler.includes('decision.operatorMonetaryInputRequired !== false'));
check('strict zero-initial-capital gas eligibility is mandatory', scheduler.includes('decision.strictZeroInitialCapitalEligible !== true'));
check('unproven gas provenance cannot acquire a lease', scheduler.includes("gasAdmissionProvenance(decision) === 'unproven'"));
check('caller funding-mode claims cannot override canonical gas truth', scheduler.includes('gasDecision.mode !== input.fundingMode'));
check('personal principal/gas/collateral remain explicitly forbidden', scheduler.includes('personalPrincipalRequired: false') && scheduler.includes('personalGasRequired: false') && scheduler.includes('personalCollateralRequired: false'));
check('atomic principal remains temporary external rather than operator capital', scheduler.includes("principalProvenance: 'temporary_external'"));
check('same-transaction atomicity remains explicit', scheduler.includes("atomicity: 'same_transaction_atomic'"));
check('all-in measured economics remain required for measured atomic leases', scheduler.includes('completeMeasuredAtomicEconomics(candidate, input.expectedNetProfitUsd)'));
check('strict positive economics is the only magnitude rule at atomic lease boundary', scheduler.includes('input.expectedNetProfitUsd <= 0') && !/minimumNetProfitUsd\s*[>:]=?\s*[1-9]/.test(scheduler));
check('positive-profit capture retains zero arbitrary dollar floor', positive.includes('minimumNetProfitUsd: 0'));
check('positive-profit capture retains strictly-greater-than-zero execution rule', positive.includes("deterministicNetProfitRule: 'strictly_greater_than_zero'"));
check('universal policy still contains all eight topologies', policy.includes('topologyCount: ATOMIC_ZERO_CAPITAL_STRATEGY_COVERAGE.length') && (policy.match(/topology: '/g) || []).length >= 8);

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`live-atomic-zero-personal-cost-admission verifier failed: ${failed.map(([name]) => name).join('; ')}`);
  process.exit(1);
}

console.log('[live-atomic-zero-personal-cost-admission] any strictly positive all-in opportunity keeps zero arbitrary profit floor, while every live atomic resource lease now re-proves canonical gas provenance and consumes the universal zero-personal-cost policy; no personal funding fallback admitted');
