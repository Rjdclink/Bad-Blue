// Established safety gates plus current measured-profitability behavior verifiers.

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
require('./verify-railway-config-compatibility.cjs');
require('./verify-startup-database-admission.cjs');
require('./verify-cryptara-supabase-admission-worker.cjs');
require('./verify-runtime-initialization-efficiency.cjs');
require('./verify-product-discovery-coverage.cjs');
require('./verify-dex-atomic-profit-path.cjs');
require('./verify-aave-liquidation-profit-integrity.cjs');
require('./verify-topology-execution-integrity.cjs');
require('./verify-cross-chain-funding-route-truth.cjs');

console.log('[deployment-preflight] safety, measured-profitability, provider-mesh, CEX modernization, resource/BPS coordination, migration authority, Railway config compatibility, startup database admission, Cryptara adaptive Supabase admission, duplicate-free runtime initialization, live product discovery, DEX atomic profitability, exact Aave liquidation/terminal profit integrity, topology integrity, cross-chain/funding route truth, and Stage-2+ live-execution reachability invariants passed; continuing to downstream prebuild/build');
