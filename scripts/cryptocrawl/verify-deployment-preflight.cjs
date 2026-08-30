// Diagnostic isolation: established safety gates plus the batch12 behavior
// verifier. Coinbase-specific verifier is added back after this gate proves clean.

require('./verify-runtime-safety-invariants.cjs');
require('./verify-profitability-recovery-coordinator.cjs');
require('./verify-substantial-profitability-batch9.cjs');
require('./verify-cryptara-sovereign-cortex.cjs');
require('./verify-compute-antenna-monte-carlo-batch11.cjs');
require('./verify-remaining-seventeen-batch12.cjs');

console.log('[deployment-preflight] established safety plus batch12 behavior invariants passed; continuing to downstream prebuild/build');
