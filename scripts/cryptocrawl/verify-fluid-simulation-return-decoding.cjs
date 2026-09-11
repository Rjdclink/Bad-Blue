const fs = require('node:fs');

const source = fs.readFileSync('server/services/cryptocrawl/execution/adapters/protocol-anchor-adapter.ts', 'utf8');

for (const fragment of [
  "'function swapIn(bool swap0to1, uint256 amountIn, uint256 amountOutMin, address to) payable returns (uint256 amountOut)'",
  "iface.decodeFunctionResult('swapIn', raw)",
  'decodeFluidSuccessfulSwapResult(iface, returned)',
  'decodeFluidSwapResult(returned)',
  'decodeFluidSwapResult(extractRevertData(error))',
  'Fluid simulation returned neither a standard swapIn result nor FluidDexSwapResult',
]) {
  if (!source.includes(fragment)) throw new Error(`Fluid simulation return verifier missing: ${fragment}`);
}

const successDecode = source.indexOf('decodeFluidSuccessfulSwapResult(iface, returned)');
const forcedFailure = source.indexOf('Fluid simulation returned neither a standard swapIn result nor FluidDexSwapResult');
if (successDecode < 0 || forcedFailure < 0 || successDecode > forcedFailure) {
  throw new Error('Fluid successful ABI return must be decoded before the fallback failure path');
}

console.log('FLUID_SIMULATION_RETURN_DECODING_VERIFIED');
