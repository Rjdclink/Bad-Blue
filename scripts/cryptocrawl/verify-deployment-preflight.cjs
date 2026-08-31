// Established safety gates plus current measured-profitability/resource behavior verifiers.

require('./verify-runtime-safety-invariants.cjs');
require('./verify-profitability-recovery-coordinator.cjs');
require('./verify-substantial-profitability-batch9.cjs');
require('./verify-cryptara-sovereign-cortex.cjs');
require('./verify-compute-antenna-monte-carlo-batch11.cjs');
require('./verify-remaining-seventeen-batch12.cjs');
require('./verify-300-profitability-live-execution-controls.cjs');
require('./verify-aave-balancer-provider-mesh.cjs');
require('./verify-cex-websocket-rpi-modernization.cjs');
require('./verify-cross-chain-funding-route-truth.cjs');
require('./verify-canonical-execution-family-completion.cjs');
require('./verify-resource-bps-authority.cjs');

console.log('[deployment-preflight] safety, measured-profitability, canonical execution-family, resource/BPS authority, provider-mesh, CEX websocket/RPI, cross-chain/funding, and Stage-2+ live-execution reachability invariants passed; continuing to downstream prebuild/build');