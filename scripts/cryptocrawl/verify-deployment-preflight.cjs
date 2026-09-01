// Established safety gates plus current measured-profitability behavior verifiers.

const { execFileSync } = require('node:child_process');
const path = require('node:path');

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
require('./verify-cryptara-resource-intelligence.cjs');
require('./verify-cryptara-super-worker.cjs');
require('./verify-supabase-background-pressure.cjs');
require('./verify-runtime-initialization-efficiency.cjs');
require('./verify-product-discovery-coverage.cjs');
require('./verify-dex-atomic-profit-path.cjs');
require('./verify-aave-liquidation-profit-integrity.cjs');
require('./verify-topology-execution-integrity.cjs');
require('./verify-cross-chain-funding-route-truth.cjs');

// Runtime proof is deliberately data-only: importing the Super Worker does not
// install its DB arm or start provider/network work. This verifies real single-
// flight, lease, TTL and ACL behavior during build without touching Supabase.
const tsx = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
execFileSync(tsx, ['scripts/cryptocrawl/verify-cryptara-super-worker-runtime.ts'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: { ...process.env, NO_EXECUTION: 'true', NO_INTERVALS: 'true', CRYPTARA_MODE: 'SILENT_WATCHER_ONLY' },
});

console.log('[deployment-preflight] safety, measured-profitability, provider-mesh, CEX modernization, resource/BPS coordination, migration authority, Railway config compatibility, startup database admission, Cryptara adaptive Supabase admission, unified Cryptara Super Worker static+runtime shared-information/QuantiComp proxy control, Antenna+QuantiComp resource intelligence, adaptive background pressure control, duplicate-free runtime initialization, live product discovery, DEX atomic profitability, exact Aave liquidation/terminal profit integrity, topology integrity, cross-chain/funding route truth, and Stage-2+ live-execution reachability invariants passed; continuing to downstream prebuild/build');