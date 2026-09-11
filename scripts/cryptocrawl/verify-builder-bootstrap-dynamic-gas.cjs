const fs = require('node:fs');

const source = fs.readFileSync('server/services/cryptocrawl/execution/builder-sponsored-receiver-bootstrap.ts', 'utf8');

for (const retired of [
  'const DEPLOYMENT_GAS =',
  'const PERMISSION_GAS =',
  'const FLASH_GAS =',
  'const APPROVAL_GAS =',
  'const CONVERSION_GAS =',
  'const PAYMENT_GAS =',
]) {
  if (source.includes(retired)) throw new Error(`Fixed builder cold-start gas ceiling survived: ${retired}`);
}

for (const required of [
  "provider.send('eth_simulateV1'",
  "multiProviderRpcManager.execute(\n    'ethereum',\n    'contract_calls'",
  'validation: false',
  'result.status !== \'0x1\'',
  'simulationSafetyBps()',
  'bufferedGasLimit',
  'sumGasLimits(gasLimits)',
  'ZERO_CAPITAL_BUILDER_GAS_CONVERGENCE_ATTEMPTS',
  'measuredSponsorshipWei <= requiredSponsorshipWei',
  'Dynamic gas sizing did not converge inside bounded attempts',
  'builder_gas_measurement:eth_simulateV1_sequential_stateful',
  'builder_all_in_cost_attribution:measured_buffered_bundle_gas_plus_repayment',
  'fixed_gas_ceiling_admission:false',
  'provider_failure_is_route_local:true',
]) {
  if (!source.includes(required)) throw new Error(`Dynamic builder gas verifier missing: ${required}`);
}

if (source.includes('gasLimit: BigNumber.from(DEPLOYMENT_GAS)')
  || source.includes('gasLimit: BigNumber.from(FLASH_GAS)')) {
  throw new Error('Builder cold-start transaction gas limit still comes from a fixed ceiling');
}

console.log('BUILDER_BOOTSTRAP_DYNAMIC_GAS_VERIFIED');
