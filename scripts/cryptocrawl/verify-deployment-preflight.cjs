// Railway is the production build path, so keep this preflight intentionally
// narrow and deterministic: validate only core trading-safety invariants that
// must never regress, then allow the normal Vite/esbuild production build to
// provide whole-application syntax/module bundling validation.

require('./verify-runtime-safety-invariants.cjs');
require('./verify-profitability-recovery-coordinator.cjs');
require('./verify-substantial-profitability-batch9.cjs');

console.log('[deployment-preflight] targeted runtime safety and substantive profitability invariants passed; continuing to normal Vite/esbuild production build');
