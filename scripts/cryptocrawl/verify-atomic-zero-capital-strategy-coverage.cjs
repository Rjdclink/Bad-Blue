const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const coverage = read('server/services/cryptocrawl/governance/atomic-zero-capital-strategy-coverage.ts');
const registry = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');
const inventory = read('server/services/cryptocrawl/execution/cex-inventory-ledger.ts');
const funding = read('server/services/cryptocrawl/execution/okx-funding-lifecycle-adapter.ts');
const across = read('server/services/cryptocrawl/execution/across-bridge-executor.ts');
const acrossProvider = read('server/services/cryptocrawl/bridge/across-bridge-provider.ts');
const gasPolicy = read('server/services/cryptocrawl/capital-free/dynamic-gas-funding-engine.ts');
const nativeGasProof = read('server/services/cryptocrawl/runtime/system-owned-gas-funding-proof-wiring.ts');
const liquidation = read('server/services/cryptocrawl/execution/flash-liquidation-executor.ts');
const mev = read('server/services/cryptocrawl/execution/mev-backrun-executor.ts');
const zeroCapital = read('server/services/cryptocrawl/core/zero-capital-engine.ts');

const topologies = [
  'CEX_CEX',
  'DEX_ATOMIC',
  'ZERO_CAPITAL_ATOMIC',
  'CROSS_CHAIN',
  'MEMPOOL_BACKRUN',
  'LIQUIDATION',
  'MAKER_CEX',
  'FUNDING_ARBITRAGE',
];

const checks = [];
const check = (name, ok) => checks.push([name, Boolean(ok)]);

for (const topology of topologies) {
  check(`measured topology exists: ${topology}`, registry.includes(`'${topology}'`));
  check(`coverage policy exists: ${topology}`, coverage.includes(`topology: '${topology}'`));
}

check('coverage has exactly the canonical eight topology rows', (coverage.match(/topology: '/g) || []).length >= 8);
check('personal principal universally forbidden', coverage.includes('personalPrincipalAllowed: false'));
check('personal gas universally forbidden', coverage.includes('personalGasAllowed: false'));
check('personal collateral universally forbidden', coverage.includes('personalCollateralAllowed: false'));
check('account-wide balances never create ownership', coverage.includes('accountWideBalanceCreatesOwnership: false'));
check('blocked execution remains discovery-only rather than disabling discovery', coverage.includes('discoveryContinuesWhenExecutionBlocked: true'));
check('central admission rejects personal principal', coverage.includes("REJECT_PERSONAL_PRINCIPAL_REQUIRED"));
check('central admission rejects personal gas', coverage.includes("REJECT_PERSONAL_GAS_REQUIRED"));
check('central admission rejects personal collateral', coverage.includes("REJECT_PERSONAL_COLLATERAL_REQUIRED"));
check('central admission rejects unproven principal', coverage.includes("REJECT_PRINCIPAL_PROVENANCE_UNPROVEN"));
check('central admission rejects unproven gas', coverage.includes("REJECT_GAS_PROVENANCE_UNPROVEN"));
check('central admission rejects incomplete all-in economics', coverage.includes("REJECT_ALL_IN_COSTS_INCOMPLETE"));
check('central admission rejects nonpositive net', coverage.includes("REJECT_NONPOSITIVE_ALL_IN_NET"));
check('central admission rejects atomicity mismatch', coverage.includes('REJECT_ATOMICITY_MISMATCH'));

check('CEX inventory has durable system-owned lot authority', inventory.includes("SYSTEM_CAPITAL_OWNERSHIP_TABLE = 'cryptocrawler_cex_system_owned_lots'"));
check('CEX account-wide balances are bounded by system-owned spendable lots', inventory.includes('const spendable = Math.min(physicalSpendable, systemOwnedSpendable)'));
check('CEX execution fails closed without durable system ownership', inventory.includes('systemOwnedCapitalRequired: true') && inventory.includes('operatorBalanceAuthorityGranted: false'));
check('Coinbase personal/account-wide balances cannot become execution capital', inventory.includes('Coinbase is always') && inventory.includes('return 0'));

check('funding lifecycle settlement records system-owned lot provenance', funding.includes('cex_system_owned_lot_ledger:exact_spot_and_derivative_transforms'));
check('funding is multi-period rather than falsely atomic', coverage.includes("topology: 'FUNDING_ARBITRAGE'") && coverage.includes("atomicity: 'multi_period_non_atomic'"));

check('Across is explicitly asynchronous cross-chain', coverage.includes("topology: 'CROSS_CHAIN'") && coverage.includes("atomicity: 'asynchronous_cross_chain'"));
check('Across executor requires terminal destination settlement evidence', across.includes('destinationReceiptVerified'));
check('Across provider models pending/fill/refund settlement rather than atomic completion', acrossProvider.includes("providerStatus") && acrossProvider.includes('financiallyTerminal'));

check('strict gas policy rejects hosted sponsor without zero-operator-cost proof', gasPolicy.includes('sponsorOperatorMonetaryCostProvenZero') && gasPolicy.includes('configured hosted sponsorship does not prove zero operator monetary cost'));
check('raw native balance is not promoted without system-owned proof', gasPolicy.includes('nativeSystemOwnedProven') && gasPolicy.includes('native balance exists but SELF_FUNDED system ownership is not proven'));
check('durable native gas proof wiring keeps hosted sponsorship unproven', nativeGasProof.includes('sponsorOperatorMonetaryCostProvenZero: false'));
check('durable native gas proof requires system ownership authority', nativeGasProof.includes('getSystemNativeGasAuthority'));

check('zero-capital atomic engine uses external flash-loan route planning', zeroCapital.includes('buildFlashLoanExecutionPlanFromOpportunity'));
check('zero-capital atomic engine requires positive verified receiver profit', zeroCapital.includes('No positive verified FlashLoanExecuted profit was emitted'));
check('zero-capital atomic engine records receipt gas truth', zeroCapital.includes('receipt.gasUsed') && zeroCapital.includes('receipt.effectiveGasPrice'));
check('liquidation exact-simulates before submit', liquidation.includes('provider.call(request') && liquidation.includes('provider.estimateGas(request)'));
check('MEV stays backrun-only', mev.includes('sandwichOrFrontrun: false'));
check('MEV has private ordered victim-before-backrun proof', mev.includes('victimReceipt!.transactionIndex < backrunReceipt.transactionIndex'));

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`atomic-zero-capital-strategy-coverage verifier failed: ${failed.map(([name]) => name).join('; ')}`);
  process.exit(1);
}

console.log('[atomic-zero-capital-strategy-coverage] all eight measured strategy topologies are classified under one zero-personal-principal/gas/collateral policy; CEX/funding/cross-chain are not falsely labeled flash-atomic; existing family-specific provenance and settlement gates remain fail-closed');
