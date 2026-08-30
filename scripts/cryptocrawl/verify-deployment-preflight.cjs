// Railway is the production build path, so keep this preflight intentionally
// narrow and deterministic: validate only core trading-safety invariants that
// must never regress, then allow the normal Vite/esbuild production build to
// provide whole-application syntax/module bundling validation.

require('./verify-runtime-safety-invariants.cjs');
require('./verify-profitability-recovery-coordinator.cjs');
require('./verify-substantial-profitability-batch9.cjs');
require('./verify-cryptara-sovereign-cortex.cjs');
require('./verify-compute-antenna-monte-carlo-batch11.cjs');

console.log('[deployment-preflight] targeted runtime safety, substantive profitability, Cryptara sovereign-cortex, and measured compute/Antenna/Monte-Carlo invariants passed; continuing to normal Vite/esbuild production build');
