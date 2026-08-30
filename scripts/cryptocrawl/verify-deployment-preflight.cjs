// Diagnostic isolation only: retain the established safety gates while Railway
// identifies whether the current failure is in the newly added batch12 verifier
// layer or in the normal downstream production build. The full batch12 gates are
// restored before merge.

require('./verify-runtime-safety-invariants.cjs');
require('./verify-profitability-recovery-coordinator.cjs');
require('./verify-substantial-profitability-batch9.cjs');
require('./verify-cryptara-sovereign-cortex.cjs');
require('./verify-compute-antenna-monte-carlo-batch11.cjs');

console.log('[deployment-preflight] diagnostic established safety gates passed; continuing to downstream prebuild/build');
