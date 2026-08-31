// Diagnostic isolation only. Do not merge this branch.
// The source tree is PR #484 exact head; Railway should run only the new CEX
// websocket/RPI verifier before the normal downstream build. This distinguishes
// a verifier assertion failure from a TypeScript/application build failure.

require('./verify-cex-websocket-rpi-modernization.cjs');

console.log('[deployment-preflight][diagnostic] CEX websocket/RPI modernization verifier passed; continuing to downstream build');
