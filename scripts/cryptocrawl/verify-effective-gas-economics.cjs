const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const oracle = read('server/services/cryptocrawl/bridge/gas-oracle.ts');
const dynamic = read('server/services/cryptocrawl/discovery/dynamic-zero-capital-routes.ts');
const dexAtomic = read('server/services/cryptocrawl/execution/dex-zerox-atomic-executor.ts');

const gasPriceIndex = oracle.indexOf('feeData.gasPrice && feeData.gasPrice.gt(0)');
const maxFeeIndex = oracle.indexOf('feeData.maxFeePerGas && feeData.maxFeePerGas.gt(0)');

const checks = [
  ['Expected gas-price helper exists', oracle.includes('function expectedExecutionGasPriceWei(')],
  ['Suggested/effective gas price is preferred over max-fee ceiling', gasPriceIndex >= 0 && maxFeeIndex > gasPriceIndex],
  ['Base fee plus priority fee is a bounded fallback', oracle.includes('feeData.lastBaseFeePerGas.add(priority)')],
  ['Legacy maxFee-first economics are absent', !oracle.includes('feeData.maxFeePerGas || feeData.gasPrice')],
  ['No zero-price gas evidence is admitted', oracle.includes('No positive live execution gas price available')],
  ['Dynamic discovery retains explicit execution-gas unit envelope', dynamic.includes('ZERO_CAPITAL_DYNAMIC_EXECUTION_GAS_UNITS')],
  ['Dynamic discovery retains gas safety multiplier', dynamic.includes('ZERO_CAPITAL_DYNAMIC_GAS_SAFETY_MULTIPLIER') && dynamic.includes('1.25')],
  ['Exact DEX path still estimates receiver gas before economics', dexAtomic.includes('const estimatedGas = await provider.estimateGas')],
  ['Exact DEX path still scales live gas price by exact gas units', dexAtomic.includes('gas.usdCost * Number(estimatedGas.toString()) / DEFAULT_GAS_LIMIT')],
  ['Terminal execution still records receipt effective gas price', dexAtomic.includes('effectiveGasPriceWei = receipt.effectiveGasPrice?.toString()')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`effective-gas-economics verifier failed: ${failed.map(([name]) => name).join('; ')}`);
  process.exit(1);
}

console.log('[effective-gas-economics] expected execution price, exact gas-unit scaling, safety envelope, and receipt reconciliation invariants passed');
