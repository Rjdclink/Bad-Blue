// Railway is the production build path, so keep this preflight intentionally
// narrow and deterministic: validate only core trading-safety invariants that
// must never regress, then allow the normal Vite/esbuild production build to
// provide whole-application syntax/module bundling validation.

require('./verify-runtime-safety-invariants.cjs');

console.log('[deployment-preflight] targeted runtime safety invariants passed; continuing to normal Vite/esbuild production build');
