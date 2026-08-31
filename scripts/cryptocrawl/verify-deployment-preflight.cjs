// Diagnostic isolation: established gates plus migration-authority verifier only.

require('./verify-runtime-safety-invariants.cjs');
require('./verify-profitability-recovery-coordinator.cjs');
require('./verify-substantial-profitability-batch9.cjs');
require('./verify-cryptara-sovereign-cortex.cjs');
require('./verify-compute-antenna-monte-carlo-batch11.cjs');
require('./verify-remaining-seventeen-batch12.cjs');
require('./verify-300-profitability-live-execution-controls.cjs');
require('./verify-aave-balancer-provider-mesh.cjs');
require('./verify-cex-websocket-rpi-modernization.cjs');
require('./verify-migration-authority-runtime.cjs');
require('./verify-cross-chain-funding-route-truth.cjs');

console.log('[deployment-preflight] diagnostic subgroup A2a: established gates plus migration authority and cross-chain/funding verified; downstream prebuild/build continues unchanged');
