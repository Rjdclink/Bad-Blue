// Established safety gates plus current measured-profitability/resource behavior verifiers.

require('./verify-overflow-complete-runtime-authority.cjs');
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
require('./verify-free-tier-startup-gate.cjs');
require('./verify-cryptara-supabase-admission-worker.cjs');
require('./verify-cryptara-supabase-comp-switch.cjs');
require('./verify-cryptara-supabase-overflow.cjs');
require('./verify-cryptara-supabase-hyper-bridge.cjs');
require('./verify-cryptara-hyper-bridge-bootstrap.cjs');
require('./verify-cryptara-resource-intelligence.cjs');
require('./verify-cryptara-super-worker.cjs');
require('./verify-supabase-background-pressure.cjs');
require('./verify-runtime-initialization-efficiency.cjs');
require('./verify-product-discovery-coverage.cjs');
require('./verify-dex-atomic-profit-path.cjs');
require('./verify-aave-liquidation-profit-integrity.cjs');
require('./verify-topology-execution-integrity.cjs');
require('./verify-cross-chain-funding-route-truth.cjs');
require('./verify-canonical-execution-family-completion.cjs');
require('./verify-resource-bps-authority.cjs');

console.log('[deployment-preflight] complete Overflow runtime authority, safety, measured-profitability, canonical execution-family, resource/BPS authority, provider-mesh, CEX websocket/RPI, cross-chain/funding, and Stage-2+ live-execution reachability invariants passed; continuing to downstream prebuild/build');
