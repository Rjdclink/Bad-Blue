// Diagnostic isolation: established gates plus full resource/schema/product verifier group.

require('./verify-runtime-safety-invariants.cjs');
require('./verify-profitability-recovery-coordinator.cjs');
require('./verify-substantial-profitability-batch9.cjs');
require('./verify-cryptara-sovereign-cortex.cjs');
require('./verify-compute-antenna-monte-carlo-batch11.cjs');
require('./verify-remaining-seventeen-batch12.cjs');
require('./verify-300-profitability-live-execution-controls.cjs');
require('./verify-aave-balancer-provider-mesh.cjs');
require('./verify-cex-websocket-rpi-modernization.cjs');
require('./verify-resource-bps-coordination.cjs');
require('./verify-migration-authority-runtime.cjs');
require('./verify-product-discovery-coverage.cjs');
require('./verify-cross-chain-funding-route-truth.cjs');

console.log('[deployment-preflight] diagnostic group A restored: established gates plus resource/BPS, migration authority, product discovery, and cross-chain/funding verified; downstream prebuild/build continues unchanged');
