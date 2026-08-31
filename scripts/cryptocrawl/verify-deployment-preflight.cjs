// DIAGNOSTIC ONLY — first quarter of deployment preflight for Railway binary isolation.
require('./verify-runtime-safety-invariants.cjs');
require('./verify-profitability-recovery-coordinator.cjs');
require('./verify-substantial-profitability-batch9.cjs');
require('./verify-cryptara-sovereign-cortex.cjs');
console.log('[deployment-preflight-diag] first-quarter PASS');
